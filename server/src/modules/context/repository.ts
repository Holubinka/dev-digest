import { and, asc, eq, sql } from 'drizzle-orm';
import type { ContextDocKind } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type {
  BoundSkillDocs,
  ContextAttachment,
  ContextDocRecord,
  ContextRepo,
  ContextRepoRef,
  ContextScanRecord,
  ScannedDoc,
} from './types.js';

/**
 * context — the ONLY layer here touching the DB.
 *
 * Every list read states its `ORDER BY` explicitly. An aggregate without one is
 * free to come back in whatever order the plan produced, and for this feature
 * order is not cosmetic: `position` IS the order the documents take in the
 * assembled prompt (`server/INSIGHTS.md`, "an aggregate without a stated ORDER
 * BY reshuffles").
 *
 * The class implements `ContextRepo`, which is declared as an interface in
 * `types.ts` rather than being inferred from this class: an object literal
 * cannot satisfy a class with a `private db`, so a test fake would need a lying
 * cast, and that is why three services in this repo have no hermetic tests.
 */
export class ContextRepository implements ContextRepo {
  constructor(private db: Db) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async repoById(workspaceId: string, repoId: string): Promise<ContextRepoRef | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        workspaceId: t.repos.workspaceId,
        owner: t.repos.owner,
        name: t.repos.name,
        clonePath: t.repos.clonePath,
        defaultBranch: t.repos.defaultBranch,
      })
      .from(t.repos)
      .where(and(eq(t.repos.id, repoId), eq(t.repos.workspaceId, workspaceId)));
    return row;
  }

  async scanFor(repoId: string): Promise<ContextScanRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repoDocScans)
      .where(eq(t.repoDocScans.repoId, repoId));
    if (!row) return undefined;
    return {
      roots: row.roots,
      fileCount: row.fileCount,
      bounded: row.bounded,
      scannedAt: row.scannedAt,
      scanningAt: row.scanningAt,
      lastError: row.lastError,
      lastErrorAt: row.lastErrorAt,
    };
  }

  /**
   * A repo's scanned documents, each with the number of ENABLED agents whose
   * effective set holds it — directly, or through an enabled bound skill.
   *
   * The count is one statement over a UNION rather than two round trips: an
   * agent that attaches a document AND binds a skill that attaches the same
   * document is ONE agent, and `COUNT(DISTINCT agent_id)` over the union is the
   * only shape that says so. Two counts added together would say two.
   *
   * `skills.enabled` is filtered as well as `agents.enabled`, because a
   * disabled skill's body never becomes a prompt block, so neither do its
   * documents — the same rule `linkedSkills` already applies.
   *
   * Fully parameterised on `repoId`; nothing is interpolated as text.
   */
  async docsFor(repoId: string): Promise<ContextDocRecord[]> {
    const [docs, usage] = await Promise.all([
      this.db
        .select({
          row: t.repoDocs,
          editedHash: t.repoDocEdits.contentHash,
          createdHere: t.repoDocEdits.createdHere,
        })
        .from(t.repoDocs)
        // LEFT, because the overwhelming majority of documents were never
        // written by DevDigest and must still appear.
        .leftJoin(
          t.repoDocEdits,
          and(
            eq(t.repoDocEdits.repoId, t.repoDocs.repoId),
            eq(t.repoDocEdits.path, t.repoDocs.path),
          ),
        )
        .where(eq(t.repoDocs.repoId, repoId))
        .orderBy(asc(t.repoDocs.path)),
      this.db.execute<{ path: string; agents: number }>(sql`
        SELECT u.path AS path, COUNT(DISTINCT u.agent_id)::int AS agents
        FROM (
          SELECT acd.path AS path, a.id AS agent_id
            FROM agent_context_docs acd
            JOIN agents a ON a.id = acd.agent_id AND a.enabled
           WHERE acd.repo_id = ${repoId}
          UNION
          SELECT scd.path AS path, a.id AS agent_id
            FROM skill_context_docs scd
            JOIN skills s ON s.id = scd.skill_id AND s.enabled
            JOIN agent_skills ask ON ask.skill_id = s.id
            JOIN agents a ON a.id = ask.agent_id AND a.enabled
           WHERE scd.repo_id = ${repoId}
        ) u
        GROUP BY u.path
        ORDER BY u.path
      `),
    ]);

    const byPath = new Map<string, number>();
    for (const row of usage as unknown as { path: string; agents: number }[]) {
      byPath.set(row.path, Number(row.agents));
    }

    return docs.map((joined) =>
      toRecord(joined, byPath.get(joined.row.path) ?? 0),
    );
  }

  /**
   * One document's row, with the same three derived facts the list carries.
   *
   * The usage count is a real query and not a hard-coded zero, because this read
   * now serves a WRITE response as well as the reading pane: `AC-62` puts a
   * saved document straight into the list, and a row rendered from a response
   * claiming "used by 0 agents" would disagree with the list beside it until the
   * next refetch.
   */
  async docByPath(repoId: string, path: string): Promise<ContextDocRecord | undefined> {
    const [joined] = await this.db
      .select({
        row: t.repoDocs,
        editedHash: t.repoDocEdits.contentHash,
        createdHere: t.repoDocEdits.createdHere,
      })
      .from(t.repoDocs)
      .leftJoin(
        t.repoDocEdits,
        and(
          eq(t.repoDocEdits.repoId, t.repoDocs.repoId),
          eq(t.repoDocEdits.path, t.repoDocs.path),
        ),
      )
      .where(and(eq(t.repoDocs.repoId, repoId), eq(t.repoDocs.path, path)));
    if (!joined) return undefined;
    return toRecord(joined, await this.usedByAgents(repoId, path));
  }

  /**
   * Enabled agents whose effective set holds ONE path — the same UNION, and the
   * same `COUNT(DISTINCT)`, that `docsFor` runs for a whole repo. An agent
   * reaching the document both directly and through a skill is one agent, and
   * two counts added together would say two.
   */
  private async usedByAgents(repoId: string, path: string): Promise<number> {
    const rows = await this.db.execute<{ agents: number }>(sql`
      SELECT COUNT(DISTINCT u.agent_id)::int AS agents
      FROM (
        SELECT a.id AS agent_id
          FROM agent_context_docs acd
          JOIN agents a ON a.id = acd.agent_id AND a.enabled
         WHERE acd.repo_id = ${repoId} AND acd.path = ${path}
        UNION
        SELECT a.id AS agent_id
          FROM skill_context_docs scd
          JOIN skills s ON s.id = scd.skill_id AND s.enabled
          JOIN agent_skills ask ON ask.skill_id = s.id
          JOIN agents a ON a.id = ask.agent_id AND a.enabled
         WHERE scd.repo_id = ${repoId} AND scd.path = ${path}
      ) u
    `);
    const [row] = rows as unknown as { agents: number }[];
    return Number(row?.agents ?? 0);
  }

  /**
   * Just the paths this repo's scan holds — the deny-by-default gate on the RUN
   * path.
   *
   * Deliberately not `docsFor`: that one carries the "used by N agents"
   * aggregate over a four-table union, which a review run has no use for and
   * would pay for on every one.
   */
  async scannedPaths(repoId: string): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.repoDocs.path })
      .from(t.repoDocs)
      .where(eq(t.repoDocs.repoId, repoId))
      .orderBy(asc(t.repoDocs.path));
    return rows.map((row) => row.path);
  }

  async agentAttachments(agentId: string, repoId: string): Promise<ContextAttachment[]> {
    return this.db
      .select({ path: t.agentContextDocs.path, position: t.agentContextDocs.position })
      .from(t.agentContextDocs)
      .where(
        and(eq(t.agentContextDocs.agentId, agentId), eq(t.agentContextDocs.repoId, repoId)),
      )
      .orderBy(asc(t.agentContextDocs.position), asc(t.agentContextDocs.path));
  }

  /**
   * How many documents this agent attaches across EVERY repo.
   *
   * Read beside the per-repo set so the run path can tell "this agent attaches
   * nothing" from "this agent attaches documents, but of a different
   * repository". The two produce different answers — silence in the first case,
   * a run-log line naming both repos in the second.
   */
  async agentAttachmentTotal(agentId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(t.agentContextDocs)
      .where(eq(t.agentContextDocs.agentId, agentId));
    return Number(row?.total ?? 0);
  }

  async skillAttachments(skillId: string, repoId: string): Promise<ContextAttachment[]> {
    return this.db
      .select({ path: t.skillContextDocs.path, position: t.skillContextDocs.position })
      .from(t.skillContextDocs)
      .where(
        and(eq(t.skillContextDocs.skillId, skillId), eq(t.skillContextDocs.repoId, repoId)),
      )
      .orderBy(asc(t.skillContextDocs.position), asc(t.skillContextDocs.path));
  }

  /**
   * The agent's ENABLED bound skills in binding order, each with the documents it
   * attaches for this repo.
   *
   * A skill with no attachment for this repo still comes back, with an empty
   * list: the agent editor's inherited group counts skills, and a skill that
   * contributes nothing is a fact the reader can act on.
   *
   * The join to `agents` carries no data — it exists so the skill can be required
   * to live in the same workspace as the agent that binds it. `agent_skills.skill_id`
   * is a foreign key, and a foreign key proves the skill EXISTS, not that it belongs
   * here (`server/INSIGHTS.md`). No route can write a cross-workspace link today —
   * `AgentsService.setSkills` refuses one — so this re-check is what keeps a stray
   * row invisible rather than load-bearing, and it is the same shape
   * `AgentsRepository.linkedSkills` already uses for the same table.
   */
  async boundSkillDocs(agentId: string, repoId: string): Promise<BoundSkillDocs[]> {
    const links = await this.db
      .select({ id: t.skills.id, name: t.skills.name, order: t.agentSkills.order })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.skills.id, t.agentSkills.skillId))
      .innerJoin(t.agents, eq(t.agents.id, t.agentSkills.agentId))
      .where(
        and(
          eq(t.agentSkills.agentId, agentId),
          eq(t.skills.enabled, true),
          eq(t.skills.workspaceId, t.agents.workspaceId),
        ),
      )
      .orderBy(asc(t.agentSkills.order), asc(t.skills.name));
    if (links.length === 0) return [];

    const rows = await this.db
      .select({
        skillId: t.skillContextDocs.skillId,
        path: t.skillContextDocs.path,
        position: t.skillContextDocs.position,
      })
      .from(t.skillContextDocs)
      .where(eq(t.skillContextDocs.repoId, repoId))
      .orderBy(asc(t.skillContextDocs.position), asc(t.skillContextDocs.path));

    const bySkill = new Map<string, ContextAttachment[]>();
    for (const row of rows) {
      const list = bySkill.get(row.skillId) ?? [];
      list.push({ path: row.path, position: row.position });
      bySkill.set(row.skillId, list);
    }
    return links.map((link) => ({
      skillId: link.id,
      skillName: link.name,
      order: link.order,
      paths: bySkill.get(link.id) ?? [],
    }));
  }

  async agentInWorkspace(workspaceId: string, agentId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(and(eq(t.agents.id, agentId), eq(t.agents.workspaceId, workspaceId)));
    return row !== undefined;
  }

  async skillInWorkspace(workspaceId: string, skillId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.id, skillId), eq(t.skills.workspaceId, workspaceId)));
    return row !== undefined;
  }

  async repoInWorkspace(workspaceId: string, repoId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.repos.id })
      .from(t.repos)
      .where(and(eq(t.repos.id, repoId), eq(t.repos.workspaceId, workspaceId)));
    return row !== undefined;
  }

  // -------------------------------------------------------------------------
  // Writes — every one replaces a whole set, inside one transaction.
  // -------------------------------------------------------------------------

  /**
   * Replace this agent's whole ordered set for one repo.
   *
   * Delete-then-insert inside one transaction, because the write is set
   * semantics: attaching, detaching and reordering are the same request, and a
   * partial apply would leave an order nobody asked for. `position` is the array
   * index, so the order that comes back is the order that was sent.
   */
  async setAgentAttachments(agentId: string, repoId: string, paths: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(t.agentContextDocs)
        .where(
          and(eq(t.agentContextDocs.agentId, agentId), eq(t.agentContextDocs.repoId, repoId)),
        );
      if (paths.length === 0) return;
      await tx
        .insert(t.agentContextDocs)
        .values(paths.map((path, position) => ({ agentId, repoId, path, position })));
    });
  }

  async setSkillAttachments(skillId: string, repoId: string, paths: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(t.skillContextDocs)
        .where(
          and(eq(t.skillContextDocs.skillId, skillId), eq(t.skillContextDocs.repoId, repoId)),
        );
      if (paths.length === 0) return;
      await tx
        .insert(t.skillContextDocs)
        .values(paths.map((path, position) => ({ skillId, repoId, path, position })));
    });
  }

  /**
   * A completed scan: the repo's documents and the scan state, together.
   *
   * One transaction, because a count that disagrees with the rows behind it is
   * the one output of this feature nobody can debug. `lastError` is cleared here
   * and ONLY here — a success is what retires a previous failure.
   */
  async replaceDocs(
    workspaceId: string,
    repoId: string,
    docs: ScannedDoc[],
    scan: { roots: string[]; bounded: boolean },
  ): Promise<void> {
    const scannedAt = new Date();
    await this.db.transaction(async (tx) => {
      await tx.delete(t.repoDocs).where(eq(t.repoDocs.repoId, repoId));
      if (docs.length > 0) {
        await tx.insert(t.repoDocs).values(
          docs.map((doc) => ({
            workspaceId,
            repoId,
            path: doc.path,
            root: doc.root,
            kind: doc.kind,
            sizeBytes: doc.sizeBytes,
            tokens: doc.tokens,
            modifiedAt: doc.modifiedAt,
            contentHash: doc.contentHash,
            scannedAt,
          })),
        );
      }
      const values = {
        roots: scan.roots,
        fileCount: docs.length,
        bounded: scan.bounded,
        scannedAt,
        scanningAt: null,
        lastError: null,
        lastErrorAt: null,
      };
      await tx
        .insert(t.repoDocScans)
        .values({ repoId, ...values })
        .onConflictDoUpdate({ target: t.repoDocScans.repoId, set: values });
    });
  }

  /**
   * A failed scan writes ONLY the failure columns.
   *
   * `scannedAt`, `fileCount`, `bounded` and the document rows are left exactly
   * as the last success left them. That untouched-ness is the requirement — the
   * page shows the previous result with the failed attempt beside it — and it is
   * why failure is a different set of columns rather than a status value.
   */
  async recordScanFailure(repoId: string, roots: string[], message: string): Promise<void> {
    const failure = { lastError: message, lastErrorAt: new Date(), scanningAt: null };
    await this.db
      .insert(t.repoDocScans)
      .values({ repoId, roots, ...failure })
      .onConflictDoUpdate({ target: t.repoDocScans.repoId, set: failure });
  }

  /**
   * Claim the scan row before the job runs, so a second read of the page does
   * not enqueue a second scan, and so a RESCAN of an already-scanned repo
   * reports itself.
   *
   * `onConflictDoUpdate`, not `onConflictDoNothing`: an existing row is the
   * normal case for every scan after the first, and declining to write left
   * `scanState()` answering `'scanned'` while a scan was running — which stopped
   * the page polling and left the Rescan button live. Only `scanningAt` and
   * `roots` move; the previous count, time and documents stay exactly where the
   * last success left them.
   */
  async markScanning(repoId: string, roots: string[]): Promise<void> {
    const claim = { scanningAt: new Date() };
    await this.db
      .insert(t.repoDocScans)
      .values({ repoId, roots, ...claim })
      .onConflictDoUpdate({ target: t.repoDocScans.repoId, set: { roots, ...claim } });
  }

  /**
   * ONE document written by hand, and the scan count that has to agree with it.
   *
   * The conflict target is `repo_docs_repo_path_uq`, the unique index that
   * already exists on `(repo_id, path)` — an `ON CONFLICT` target without a
   * matching unique index is a runtime error, not a type error.
   *
   * `file_count` is recomputed from `COUNT(*)` rather than incremented, because
   * a save of an EXISTING document must not move it while a create must. Reading
   * the count back inside the same transaction is what makes "the footer never
   * disagrees with the list" true even when a scan lands between the two.
   *
   * `scannedAt` is left exactly as the last scan set it: this is not a scan, and
   * claiming the repo was scanned just now would relabel the whole page.
   */
  async upsertDoc(workspaceId: string, repoId: string, doc: ScannedDoc): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = {
        path: doc.path,
        root: doc.root,
        kind: doc.kind,
        sizeBytes: doc.sizeBytes,
        tokens: doc.tokens,
        modifiedAt: doc.modifiedAt,
        contentHash: doc.contentHash,
        scannedAt: new Date(),
      };
      await tx
        .insert(t.repoDocs)
        .values({ workspaceId, repoId, ...row })
        .onConflictDoUpdate({
          target: [t.repoDocs.repoId, t.repoDocs.path],
          set: row,
        });
      const [counted] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(t.repoDocs)
        .where(eq(t.repoDocs.repoId, repoId));
      const fileCount = Number(counted?.total ?? 0);
      // UPDATE and not an upsert. A repo with no scan row has never had its
      // documents read, and inserting one here would give it a `scanned_at` of
      // null with no claim behind it — which `scanState` reads as `failed` and
      // which would stop `docsPage` from ever enqueuing the lazy FIRST scan.
      // No row means there is no count to keep honest yet.
      await tx
        .update(t.repoDocScans)
        .set({ fileCount })
        .where(eq(t.repoDocScans.repoId, repoId));
    });
  }

  /**
   * What DevDigest wrote to a path.
   *
   * `createdHere` is written with an OR against the existing row rather than
   * with the argument: a save of a document created here arrives with
   * `createdHere: false` — it is a save, not a create — and letting that
   * overwrite the column would quietly turn a local-only document into one the
   * page claims the repository carries.
   */
  async recordEdit(
    repoId: string,
    path: string,
    edit: { createdHere: boolean; contentHash: string },
  ): Promise<void> {
    await this.db
      .insert(t.repoDocEdits)
      .values({ repoId, path, createdHere: edit.createdHere, contentHash: edit.contentHash })
      .onConflictDoUpdate({
        target: [t.repoDocEdits.repoId, t.repoDocEdits.path],
        set: {
          contentHash: edit.contentHash,
          savedAt: new Date(),
          createdHere: sql`${t.repoDocEdits.createdHere} OR ${edit.createdHere}`,
        },
      });
  }
}

/**
 * The joined row → the module's record, with `local` and `stale` derived in ONE
 * place so the list and the single-document read cannot answer differently.
 *
 * `stale` needs the edit row to exist AND the hashes to differ. A document with
 * no edit row was never written here, so there is nothing for the disk to have
 * lost; `IS DISTINCT FROM` semantics are reproduced with an explicit null check
 * rather than left to `!==`, because a `repo_docs.content_hash` of null is
 * "unknown", not "different".
 */
function toRecord(
  joined: {
    row: typeof t.repoDocs.$inferSelect;
    editedHash: string | null;
    createdHere: boolean | null;
  },
  usedByAgents: number,
): ContextDocRecord {
  const { row } = joined;
  return {
    path: row.path,
    root: row.root,
    kind: row.kind as ContextDocKind,
    sizeBytes: row.sizeBytes,
    tokens: row.tokens,
    modifiedAt: row.modifiedAt,
    usedByAgents,
    local: joined.createdHere ?? false,
    stale: joined.editedHash !== null && row.contentHash !== joined.editedHash,
  };
}
