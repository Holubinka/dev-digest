import { describe, it, expect } from "vitest";
import { convention } from "@/test/conventions";
import { composeSkillBody, evidenceFiles, skillName } from "./helpers";

/**
 * The merge is the promise the accept/reject buttons make: a rejected rule must
 * not appear in the skill an agent then runs. This is the acceptance criterion
 * the whole screen exists for, so it is tested on the function, not through
 * three clicks.
 */

const ACCEPTED = convention({ id: "a", status: "accepted" });
const REJECTED = convention({
  id: "r",
  status: "rejected",
  rule: "Every module re-exports its public surface from an index.ts.",
  evidence_path: "src/modules/index.ts",
  extra_evidence: [],
});
const PENDING = convention({
  id: "p",
  status: "pending",
  rule: "Tests live beside the file they cover.",
  evidence_path: "src/lib/api.test.ts",
  extra_evidence: [],
});

describe("composeSkillBody", () => {
  it("includes an accepted rule with the code that established it", () => {
    const body = composeSkillBody([ACCEPTED], "Holubinka/dev-digest");
    expect(body).toContain(ACCEPTED.rule);
    expect(body).toContain("`src/modules/skills/routes.ts:74`");
    expect(body).toContain("`src/modules/agents/routes.ts:148`");
  });

  it("leaves out rejected and unjudged rules", () => {
    const body = composeSkillBody([ACCEPTED, REJECTED, PENDING], "Holubinka/dev-digest");
    expect(body).toContain(ACCEPTED.rule);
    expect(body).not.toContain(REJECTED.rule);
    expect(body).not.toContain(PENDING.rule);
  });

  it("groups the rules by category", () => {
    const body = composeSkillBody(
      [
        ACCEPTED,
        convention({ id: "b", status: "accepted", category: "naming", rule: "Files are kebab-case." }),
        convention({
          id: "c",
          status: "accepted",
          category: "error-handling",
          rule: "Never swallow an error.",
        }),
      ],
      "Holubinka/dev-digest",
    );
    expect(body.match(/^## error-handling$/gm)).toHaveLength(1);
    expect(body).toContain("## naming");
  });

  it("names the repo it came from and tells the agent what to do with it", () => {
    const body = composeSkillBody([ACCEPTED], "Holubinka/dev-digest");
    expect(body).toContain("# dev-digest-conventions");
    expect(body).toContain("Holubinka/dev-digest");
    expect(body).toMatch(/cite the offending `file:line`/);
  });

  it("produces a body with no rules when nothing was accepted", () => {
    const body = composeSkillBody([REJECTED, PENDING], "Holubinka/dev-digest");
    expect(body).not.toContain("##");
  });
});

describe("evidenceFiles", () => {
  it("collects the accepted rules’ files, deduplicated", () => {
    const files = evidenceFiles([
      ACCEPTED,
      convention({ id: "b", status: "accepted", extra_evidence: [] }),
      REJECTED,
    ]);
    expect(files).toEqual(["src/modules/skills/routes.ts", "src/modules/agents/routes.ts"]);
  });
});

describe("skillName", () => {
  it("drops the owner", () => {
    expect(skillName("Holubinka/dev-digest")).toBe("dev-digest-conventions");
    expect(skillName("payments-api")).toBe("payments-api-conventions");
  });
});
