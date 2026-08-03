import { describe, it, expect } from "vitest";
import { githubBlobUrl, githubPrUrl } from "./github-urls";

const REPO = "acme/payments-api";
const SHA = "a1b2c3d";

describe("githubBlobUrl", () => {
  it("pins the blob to the head sha and the line range", () => {
    expect(githubBlobUrl(REPO, SHA, "src/api/users.ts", 45, 52)).toBe(
      "https://github.com/acme/payments-api/blob/a1b2c3d/src/api/users.ts#L45-L52",
    );
  });

  it("emits a single anchor when the range covers one line", () => {
    expect(githubBlobUrl(REPO, SHA, "src/config.ts", 12, 12)).toBe(
      "https://github.com/acme/payments-api/blob/a1b2c3d/src/config.ts#L12",
    );
  });

  it("encodes a path segment without eating the separators", () => {
    expect(githubBlobUrl(REPO, SHA, "client/src/app/repos/[repoId]/page.tsx")).toBe(
      "https://github.com/acme/payments-api/blob/a1b2c3d/client/src/app/repos/%5BrepoId%5D/page.tsx",
    );
  });

  // `findings.file` is plain text written by an agent, so it is treated as hostile.
  describe("a hostile file path", () => {
    // The host is a literal prefix and `file` is appended to an already-absolute
    // URL, so no value can introduce an origin. Encoding is what keeps a scheme
    // from surviving as one.
    it.each([
      ["//evil.com", "https://github.com/acme/payments-api/blob/a1b2c3d///evil.com"],
      ["https://phishing.com", "https://github.com/acme/payments-api/blob/a1b2c3d/https%3A//phishing.com"],
      ["javascript:alert(1)", "https://github.com/acme/payments-api/blob/a1b2c3d/javascript%3Aalert(1)"],
      ["a?x=1#frag", "https://github.com/acme/payments-api/blob/a1b2c3d/a%3Fx%3D1%23frag"],
    ])("keeps %s inside github.com as a path segment", (file, expected) => {
      const url = githubBlobUrl(REPO, SHA, file)!;
      expect(url).toBe(expected);
      expect(new URL(url).origin).toBe("https://github.com");
    });

    // Encoding does NOT neutralise these: the browser resolves them before it
    // sends the request, so the link would open a repo the citation never named.
    it.each([
      "../../../../attacker/repo/blob/main/README.md",
      "../secrets.ts",
      "./src/config.ts",
      "src/../../../evil.ts",
      "..",
    ])("refuses to link %s rather than resolving it elsewhere", (file) => {
      expect(githubBlobUrl(REPO, SHA, file, 1, 1)).toBeUndefined();
    });

    it("leaves a dot inside a filename alone — only whole segments count", () => {
      expect(githubBlobUrl(REPO, SHA, "src/..config.ts")).toBe(
        "https://github.com/acme/payments-api/blob/a1b2c3d/src/..config.ts",
      );
      expect(githubBlobUrl(REPO, SHA, "src/foo..bar/x.ts")).toBe(
        "https://github.com/acme/payments-api/blob/a1b2c3d/src/foo..bar/x.ts",
      );
    });
  });

  it("refuses a repo name or sha that would climb out of the blob path", () => {
    expect(githubBlobUrl("../../evil", SHA, "src/config.ts")).toBeUndefined();
    expect(githubBlobUrl(REPO, "..", "src/config.ts")).toBeUndefined();
  });
});

describe("githubPrUrl", () => {
  it("builds the PR permalink", () => {
    expect(githubPrUrl(REPO, 482)).toBe("https://github.com/acme/payments-api/pull/482");
  });

  it("encodes the repo name while keeping owner/repo apart", () => {
    expect(githubPrUrl("acme/pay?ments", 1)).toBe("https://github.com/acme/pay%3Fments/pull/1");
  });

  // Same rule as `githubBlobUrl`, for the same reason: encoding leaves `.` and
  // `..` alone and the browser resolves them, so the link would open a PR on a
  // repo the caller never named. Not reachable from today's data — the server
  // builds `repoFullName` — but the builder no longer relies on that.
  it.each(["../../evil", "acme/../../evil", "./acme/repo", "..", "acme/.."])(
    "refuses %s rather than building a PR link that climbs out",
    (repo) => {
      expect(githubPrUrl(repo, 482)).toBeUndefined();
    },
  );

  it("leaves a dot inside a repo name alone — only whole segments count", () => {
    expect(githubPrUrl("acme/pay.ments", 1)).toBe("https://github.com/acme/pay.ments/pull/1");
  });
});
