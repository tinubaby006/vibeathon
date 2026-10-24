import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseGitHubUrl,
  validateProjectPath,
  fetchProjectManifests,
  GitHubError,
} from "../lib/github";

describe("GitHub URL and Path Validation", () => {
  it("parses valid GitHub repository URLs", () => {
    const res1 = parseGitHubUrl("https://github.com/facebook/react");
    assert.equal(res1.owner, "facebook");
    assert.equal(res1.repo, "react");
    assert.equal(res1.canonicalUrl, "https://github.com/facebook/react");

    const res2 = parseGitHubUrl("https://github.com/vercel/next.js.git");
    assert.equal(res2.owner, "vercel");
    assert.equal(res2.repo, "next.js");
  });

  it("rejects lookalike hosts, non-HTTPS, credentials, query parameters, and tree/blob URLs", () => {
    assert.throws(() => parseGitHubUrl("http://github.com/foo/bar"), (err: unknown) => {
      return (err as GitHubError).code === "MALFORMED_URL";
    });

    assert.throws(() => parseGitHubUrl("https://gitlab.com/foo/bar"), (err: unknown) => {
      return (err as GitHubError).code === "MALFORMED_URL";
    });

    assert.throws(() => parseGitHubUrl("https://user:pass@github.com/foo/bar"), (err: unknown) => {
      return (err as GitHubError).code === "MALFORMED_URL";
    });

    assert.throws(() => parseGitHubUrl("https://github.com/foo/bar?branch=main"), (err: unknown) => {
      return (err as GitHubError).code === "MALFORMED_URL";
    });

    assert.throws(() => parseGitHubUrl("https://github.com/foo/bar/tree/main"), (err: unknown) => {
      return (err as GitHubError).code === "MALFORMED_URL";
    });

    assert.throws(() => parseGitHubUrl("https://github.com/foo/bar/blob/main/package.json"), (err: unknown) => {
      return (err as GitHubError).code === "MALFORMED_URL";
    });
  });

  it("validates project path and rejects directory traversal", () => {
    assert.equal(validateProjectPath(""), "");
    assert.equal(validateProjectPath("."), "");
    assert.equal(validateProjectPath("apps/web"), "apps/web");
    assert.equal(validateProjectPath("packages/core/sub"), "packages/core/sub");

    assert.throws(() => validateProjectPath("../outside"), (err: unknown) => {
      return (err as GitHubError).code === "PATH_INVALID";
    });

    assert.throws(() => validateProjectPath("apps/../secret"), (err: unknown) => {
      return (err as GitHubError).code === "PATH_INVALID";
    });

    assert.throws(() => validateProjectPath("apps\\web"), (err: unknown) => {
      return (err as GitHubError).code === "PATH_INVALID";
    });
  });

  it("pins commit SHA consistently across repository and file reads even if mocked branch changes", async () => {
    const fixedSha = "1234567890abcdef1234567890abcdef12345678";
    const requestedUrls: string[] = [];

    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = url.toString();
      requestedUrls.push(urlStr);

      if (urlStr.includes("/repos/test-owner/test-repo/commits/main")) {
        return new Response(JSON.stringify({ sha: fixedSha }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (urlStr.includes("/repos/test-owner/test-repo/contents/package.json?ref=" + fixedSha)) {
        return new Response(JSON.stringify({ name: "pinned-app" }), {
          status: 200,
          headers: { "Content-Type": "application/vnd.github.raw+json" },
        });
      }

      if (urlStr.includes("/repos/test-owner/test-repo/contents/package-lock.json?ref=" + fixedSha)) {
        return new Response(JSON.stringify({ name: "pinned-app", lockfileVersion: 3, packages: {} }), {
          status: 200,
          headers: { "Content-Type": "application/vnd.github.raw+json" },
        });
      }

      return new Response("Not found", { status: 404 });
    };

    const manifests = await fetchProjectManifests(
      "test-owner",
      "test-repo",
      "",
      fixedSha,
      mockFetch as unknown as typeof fetch
    );

    assert.equal(manifests.resolvedCommitSha, fixedSha);
    assert.ok(requestedUrls.some((u) => u.includes(`package.json?ref=${fixedSha}`)));
    assert.ok(requestedUrls.some((u) => u.includes(`package-lock.json?ref=${fixedSha}`)));
  });
});
