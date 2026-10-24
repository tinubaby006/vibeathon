import { URL } from "node:url";

export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  canonicalUrl: string;
}

export interface ResolvedRepoRef {
  owner: string;
  repo: string;
  defaultBranch: string;
  resolvedCommitSha: string;
  isPrivate: boolean;
}

export interface FetchedManifests {
  packageJsonRaw: string;
  packageLockRaw: string;
  packageJsonPath: string;
  packageLockPath: string;
  resolvedCommitSha: string;
  canonicalRepoUrl: string;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    public code:
      | "MALFORMED_URL"
      | "REPO_NOT_FOUND_OR_INACCESSIBLE"
      | "TOKEN_INVALID"
      | "PERMISSION_DENIED"
      | "RATE_LIMITED"
      | "REF_NOT_FOUND"
      | "PATH_INVALID"
      | "FILE_NOT_FOUND"
      | "FILE_TOO_LARGE"
      | "UNEXPECTED_CONTENT"
      | "UPSTREAM_UNAVAILABLE",
    public retryable: boolean = false
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

const GITHUB_REPO_SEGMENT_REGEX = /^[a-zA-Z0-9_.-]+$/;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MiB limit

/**
 * Validates and parses a GitHub repository URL strictly
 */
export function parseGitHubUrl(input: string): ParsedGitHubUrl {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new GitHubError(
      "Invalid URL syntax. Please provide a full HTTPS URL like https://github.com/owner/repo",
      "MALFORMED_URL"
    );
  }

  if (url.protocol !== "https:") {
    throw new GitHubError("Only HTTPS GitHub URLs are allowed", "MALFORMED_URL");
  }

  if (url.hostname !== "github.com") {
    throw new GitHubError("Only github.com repository URLs are supported", "MALFORMED_URL");
  }

  if (url.username || url.password || url.port || url.search || url.hash) {
    throw new GitHubError(
      "GitHub URL must not include credentials, ports, query parameters, or fragments",
      "MALFORMED_URL"
    );
  }

  const cleanPath = url.pathname.replace(/^\/+|\/+$/g, "");
  const parts = cleanPath.split("/");

  if (parts.length > 2 && (parts[2] === "tree" || parts[2] === "blob")) {
    throw new GitHubError(
      "Direct tree or blob URLs are not supported. Provide the base repository URL (https://github.com/owner/repo) and specify the branch or path in the separate fields.",
      "MALFORMED_URL"
    );
  }

  if (parts.length !== 2) {
    throw new GitHubError(
      "Expected URL format: https://github.com/owner/repo",
      "MALFORMED_URL"
    );
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");

  if (!GITHUB_REPO_SEGMENT_REGEX.test(owner) || !GITHUB_REPO_SEGMENT_REGEX.test(repo)) {
    throw new GitHubError(
      "Repository owner and name must contain only alphanumeric characters, underscores, periods, and hyphens",
      "MALFORMED_URL"
    );
  }

  return {
    owner,
    repo,
    canonicalUrl: `https://github.com/${owner}/${repo}`,
  };
}

/**
 * Normalizes and validates relative project path inside repository
 */
export function validateProjectPath(rawPath?: string | null): string {
  if (!rawPath) return "";
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed === "." || trimmed === "./") return "";

  if (trimmed.includes("\\")) {
    throw new GitHubError("Project path must use forward slashes only", "PATH_INVALID");
  }

  // Check for traversal or empty segments
  const segments = trimmed.split("/");
  for (const seg of segments) {
    if (!seg || seg === "." || seg === "..") {
      throw new GitHubError(
        "Project path cannot contain directory traversal (..), leading/trailing slashes, or empty segments",
        "PATH_INVALID"
      );
    }
    if (/[\0\r\n\t]/.test(seg)) {
      throw new GitHubError("Project path contains invalid control characters", "PATH_INVALID");
    }
  }

  return segments.join("/");
}

function getGitHubHeaders(token?: string): HeadersInit {
  const headers: Record<string, string> = {
    "User-Agent": "Vulnerability-Response-Console/1.0",
    Accept: "application/vnd.github+json",
  };
  const effectiveToken = token || process.env.GITHUB_TOKEN;
  if (effectiveToken && effectiveToken.trim()) {
    headers.Authorization = `Bearer ${effectiveToken.trim()}`;
  }
  return headers;
}

/**
 * Resolves repository existence, default branch, and requested reference to an immutable commit SHA
 */
export async function resolveRepositoryCommit(
  owner: string,
  repo: string,
  requestedRef?: string | null,
  fetchFn: typeof fetch = fetch
): Promise<ResolvedRepoRef> {
  const encOwner = encodeURIComponent(owner);
  const encRepo = encodeURIComponent(repo);
  const repoApiUrl = `https://api.github.com/repos/${encOwner}/${encRepo}`;

  const repoResp = await fetchWithTimeout(repoApiUrl, {
    headers: getGitHubHeaders(),
  }, 15000, fetchFn);

  if (repoResp.status === 401) {
    throw new GitHubError("Configured GITHUB_TOKEN is invalid or unauthorized", "TOKEN_INVALID");
  }

  if (repoResp.status === 403 || repoResp.status === 429) {
    const rateLimitRemaining = repoResp.headers.get("x-ratelimit-remaining");
    const rateLimitReset = repoResp.headers.get("x-ratelimit-reset");

    // If unauthenticated rate limit hit, try public Git Smart HTTP fallback
    if (!process.env.GITHUB_TOKEN && (rateLimitRemaining === "0" || repoResp.status === 429)) {
      const fallbackRef = await resolveViaGitSmartHttp(owner, repo, requestedRef, fetchFn);
      if (fallbackRef) {
        return fallbackRef;
      }
    }

    let resetHint = "";
    if (rateLimitReset && !isNaN(Number(rateLimitReset))) {
      const resetTime = new Date(Number(rateLimitReset) * 1000).toLocaleTimeString();
      resetHint = ` (resets at ${resetTime})`;
    }

    if (rateLimitRemaining === "0" || repoResp.status === 429) {
      throw new GitHubError(
        `GitHub API rate limit exceeded${resetHint}. Configure GITHUB_TOKEN in .env.local to raise limit from 60 to 5,000 requests/hour.`,
        "RATE_LIMITED",
        true
      );
    }
    throw new GitHubError("Access to GitHub repository was denied (HTTP 403)", "PERMISSION_DENIED");
  }

  if (repoResp.status === 404) {
    throw new GitHubError("Repository not found or inaccessible with current credentials", "REPO_NOT_FOUND_OR_INACCESSIBLE");
  }
  if (!repoResp.ok) {
    throw new GitHubError(`GitHub API error: HTTP ${repoResp.status}`, "UPSTREAM_UNAVAILABLE", true);
  }

  const repoData = (await repoResp.json()) as { default_branch: string; private: boolean };
  const defaultBranch = repoData.default_branch || "main";
  const refToResolve = requestedRef && requestedRef.trim() ? requestedRef.trim() : defaultBranch;

  // Resolve ref to commit SHA
  const commitApiUrl = `https://api.github.com/repos/${encOwner}/${encRepo}/commits/${encodeURIComponent(refToResolve)}`;
  const commitResp = await fetchWithTimeout(commitApiUrl, {
    headers: getGitHubHeaders(),
  }, 15000, fetchFn);

  if (commitResp.status === 403 || commitResp.status === 429) {
    const rateLimitRemaining = commitResp.headers.get("x-ratelimit-remaining");
    if (!process.env.GITHUB_TOKEN && (rateLimitRemaining === "0" || commitResp.status === 429)) {
      const fallbackRef = await resolveViaGitSmartHttp(owner, repo, requestedRef, fetchFn);
      if (fallbackRef) return fallbackRef;
    }
    throw new GitHubError("GitHub API rate limit exceeded. Configure GITHUB_TOKEN in .env.local to raise limit.", "RATE_LIMITED", true);
  }

  if (commitResp.status === 404) {
    throw new GitHubError(`Requested Git reference '${refToResolve}' was not found in repository`, "REF_NOT_FOUND");
  }
  if (!commitResp.ok) {
    throw new GitHubError(`Failed to resolve commit for '${refToResolve}': HTTP ${commitResp.status}`, "UPSTREAM_UNAVAILABLE", true);
  }

  const commitData = (await commitResp.json()) as { sha: string };
  if (!commitData.sha || !/^[0-9a-fA-F]{40}$/.test(commitData.sha)) {
    throw new GitHubError("Received invalid commit SHA from GitHub API", "UPSTREAM_UNAVAILABLE");
  }

  return {
    owner,
    repo,
    defaultBranch,
    resolvedCommitSha: commitData.sha,
    isPrivate: repoData.private ?? false,
  };
}

/**
 * Resolves repository references using standard Git Smart HTTP protocol when GitHub REST API is rate limited
 */
async function resolveViaGitSmartHttp(
  owner: string,
  repo: string,
  requestedRef?: string | null,
  fetchFn: typeof fetch = fetch
): Promise<ResolvedRepoRef | null> {
  try {
    const encOwner = encodeURIComponent(owner);
    const encRepo = encodeURIComponent(repo);
    const infoUrl = `https://github.com/${encOwner}/${encRepo}.git/info/refs?service=git-upload-pack`;
    const resp = await fetchWithTimeout(infoUrl, {
      headers: { "User-Agent": "git/2.40.0" },
    }, 15000, fetchFn);

    if (!resp.ok) return null;
    const text = await resp.text();
    const lines = text.split("\n");

    let defaultBranch = "main";
    const headLine = lines.find((l) => l.includes("symref=HEAD:refs/heads/"));
    if (headLine) {
      const match = headLine.match(/symref=HEAD:refs\/heads\/([^\s]+)/);
      if (match) defaultBranch = match[1];
    }

    const targetRefName = requestedRef && requestedRef.trim() ? requestedRef.trim() : defaultBranch;
    let commitSha: string | null = null;

    for (const line of lines) {
      const match = line.match(/^[0-9a-fA-F]{4}([0-9a-fA-F]{40})\s+(.+)$/);
      if (match) {
        const sha = match[1];
        const ref = match[2].trim();
        if (
          ref === `refs/heads/${targetRefName}` ||
          ref === `refs/tags/${targetRefName}` ||
          ref === `refs/tags/${targetRefName}^{}` ||
          (targetRefName === defaultBranch && ref === "HEAD")
        ) {
          commitSha = sha;
          if (ref.endsWith("^{}")) break;
        }
      }
    }

    if (!commitSha && requestedRef && /^[0-9a-fA-F]{40}$/.test(requestedRef.trim())) {
      commitSha = requestedRef.trim();
    }

    if (commitSha) {
      return {
        owner,
        repo,
        defaultBranch,
        resolvedCommitSha: commitSha,
        isPrivate: false,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Reads a single raw text file from GitHub at an exact commit SHA
 */
export async function readRawFileAtCommit(
  owner: string,
  repo: string,
  filePath: string,
  commitSha: string,
  fetchFn: typeof fetch = fetch
): Promise<string> {
  const encOwner = encodeURIComponent(owner);
  const encRepo = encodeURIComponent(repo);
  // Encode each segment of path
  const encPath = filePath.split("/").map(encodeURIComponent).join("/");
  const url = `https://api.github.com/repos/${encOwner}/${encRepo}/contents/${encPath}?ref=${encodeURIComponent(commitSha)}`;

  let resp = await fetchWithTimeout(url, {
    headers: {
      ...getGitHubHeaders(),
      Accept: "application/vnd.github.raw+json",
    },
  }, 15000, fetchFn);

  // Fallback to raw.githubusercontent.com if rate limited on REST contents API without token
  if ((resp.status === 403 || resp.status === 429) && !process.env.GITHUB_TOKEN) {
    const rawFallbackUrl = `https://raw.githubusercontent.com/${encOwner}/${encRepo}/${encodeURIComponent(commitSha)}/${encPath}`;
    try {
      const rawResp = await fetchWithTimeout(rawFallbackUrl, {
        headers: { "User-Agent": "Vulnerability-Response-Console/1.0" },
      }, 15000, fetchFn);
      if (rawResp.ok) {
        resp = rawResp;
      }
    } catch {
      // Keep original response for error handling
    }
  }

  if (resp.status === 403 || resp.status === 429) {
    throw new GitHubError(
      "GitHub API rate limit exceeded. Configure GITHUB_TOKEN in .env.local to raise limit from 60 to 5,000 requests/hour.",
      "RATE_LIMITED",
      true
    );
  }

  if (resp.status === 404) {
    throw new GitHubError(`Required file '${filePath}' was not found at commit ${commitSha.substring(0, 7)}`, "FILE_NOT_FOUND");
  }
  if (!resp.ok) {
    throw new GitHubError(`Failed to read '${filePath}': HTTP ${resp.status}`, "UPSTREAM_UNAVAILABLE", true);
  }

  // Stream read with strict byte cap
  if (!resp.body) {
    const text = await resp.text();
    if (Buffer.byteLength(text, "utf-8") > MAX_FILE_BYTES) {
      throw new GitHubError(`File '${filePath}' exceeds maximum allowed size of 5 MiB`, "FILE_TOO_LARGE");
    }
    return text;
  }

  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      totalBytes += value.length;
      if (totalBytes > MAX_FILE_BYTES) {
        await reader.cancel();
        throw new GitHubError(`File '${filePath}' exceeds maximum allowed size of 5 MiB`, "FILE_TOO_LARGE");
      }
      chunks.push(value);
    }
  }

  const combined = Buffer.concat(chunks);
  const text = combined.toString("utf-8");
  return text;
}

/**
 * Fetches package.json and package-lock.json pinned to the exact resolved commit
 */
export async function fetchProjectManifests(
  owner: string,
  repo: string,
  projectPath: string,
  commitSha: string,
  fetchFn: typeof fetch = fetch
): Promise<FetchedManifests> {
  const normPath = validateProjectPath(projectPath);
  const pkgJsonPath = normPath ? `${normPath}/package.json` : "package.json";
  const pkgLockPath = normPath ? `${normPath}/package-lock.json` : "package-lock.json";

  const [packageJsonRaw, packageLockRaw] = await Promise.all([
    readRawFileAtCommit(owner, repo, pkgJsonPath, commitSha, fetchFn),
    readRawFileAtCommit(owner, repo, pkgLockPath, commitSha, fetchFn),
  ]);

  return {
    packageJsonRaw,
    packageLockRaw,
    packageJsonPath: pkgJsonPath,
    packageLockPath: pkgLockPath,
    resolvedCommitSha: commitSha,
    canonicalRepoUrl: `https://github.com/${owner}/${repo}`,
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchFn: typeof fetch
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      ...init,
      signal: controller.signal,
    });
    return res;
  } catch (err: unknown) {
    if ((err as Error).name === "AbortError") {
      throw new GitHubError(`GitHub API request timed out after ${timeoutMs}ms`, "UPSTREAM_UNAVAILABLE", true);
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
}
