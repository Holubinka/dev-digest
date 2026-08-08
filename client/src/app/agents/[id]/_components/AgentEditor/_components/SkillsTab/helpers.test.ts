import { describe, it, expect } from "vitest";
import type { AgentSkillLink, SkillListItem } from "@devdigest/shared";
import { moveAt, partitionSkills, toggleId } from "./helpers";

const skill = (id: string): SkillListItem => ({
  id,
  name: id,
  description: "",
  type: "rubric",
  source: "manual",
  enabled: true,
  version: 1,
  evidence_files: null,
  agents: 0,
  injection: [],
});

const link = (skill_id: string, order: number): AgentSkillLink => ({
  agent_id: "ag1",
  skill_id,
  order,
});

describe("partitionSkills", () => {
  it("returns bound skills in binding order, not in list order", () => {
    const { linked } = partitionSkills([skill("a"), skill("b"), skill("c")], [
      link("c", 0),
      link("a", 1),
    ]);
    expect(linked.map((sk) => sk.id)).toEqual(["c", "a"]);
  });

  it("leaves everything else available", () => {
    const { unlinked } = partitionSkills([skill("a"), skill("b")], [link("a", 0)]);
    expect(unlinked.map((sk) => sk.id)).toEqual(["b"]);
  });

  it("ignores a link to a skill that is not in the list", () => {
    const { linked } = partitionSkills([skill("a")], [link("ghost", 0), link("a", 1)]);
    expect(linked.map((sk) => sk.id)).toEqual(["a"]);
  });
});

describe("moveAt", () => {
  it("moves an item up and down", () => {
    expect(moveAt(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveAt(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  });

  it("passes through a no-op or an out-of-range move", () => {
    expect(moveAt(["a", "b"], 1, 1)).toEqual(["a", "b"]);
    expect(moveAt(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    expect(moveAt(["a", "b"], -1, 0)).toEqual(["a", "b"]);
  });

  it("does not mutate its input", () => {
    const xs = ["a", "b"];
    moveAt(xs, 0, 1);
    expect(xs).toEqual(["a", "b"]);
  });
});

describe("toggleId", () => {
  it("appends a new id at the end, so a fresh binding lands last in the prompt", () => {
    expect(toggleId(["a"], "b")).toEqual(["a", "b"]);
  });

  it("removes an id that is already there", () => {
    expect(toggleId(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
});
