export interface OsvQuery {
  package: {
    ecosystem: "npm";
    name: string;
  };
  version: string;
}

export interface OsvBatchItemResult {
  vulns?: Array<{
    id: string;
    modified: string;
  }>;
  next_page_token?: string;
}

export interface OsvBatchResponse {
  results?: OsvBatchItemResult[];
}

export interface OsvAdvisoryDetail {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  modified?: string;
  published?: string;
  withdrawn?: string;
  references?: Array<{
    type?: string;
    url?: string;
  }>;
  severity?: Array<{
    type?: string;
    score?: string;
  }>;
  affected?: Array<{
    package?: {
      ecosystem?: string;
      name?: string;
    };
    ranges?: Array<{
      type?: string;
      events?: Array<{
        introduced?: string;
        fixed?: string;
        last_affected?: string;
        limit?: string;
      }>;
    }>;
    versions?: string[];
    database_specific?: Record<string, unknown>;
    ecosystem_specific?: Record<string, unknown>;
  }>;
  database_specific?: {
    severity?: string;
    cwe_ids?: string[];
    github_reviewed?: boolean;
    github_reviewed_at?: string;
    nvd_published_at?: string;
    [key: string]: unknown;
  };
  ecosystem_specific?: {
    severity?: string;
    [key: string]: unknown;
  };
}

export interface OsvQueryMatch {
  packageName: string;
  version: string;
  advisoryIds: string[];
}

export interface OsvLookupResult {
  matches: OsvQueryMatch[];
  advisories: Map<string, OsvAdvisoryDetail>;
  unhydratedAdvisoryIds: string[];
  failedQueries: Array<{ name: string; version: string; reason: string }>;
  queriedCount: number;
}

const OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch";
const OSV_VULN_URL_PREFIX = "https://api.osv.dev/v1/vulns/";
const CHUNK_SIZE = 100;
const MAX_PAGES_PER_QUERY = 5;

/**
 * Executes batched queries to OSV API with pagination and per-unique-advisory hydration
 */
export async function queryOsvBatch(
  pairs: Array<{ name: string; version: string }>,
  options: {
    deadlineMs?: number;
    fetchFn?: typeof fetch;
  } = {}
): Promise<OsvLookupResult> {
  const fetchFn = options.fetchFn || fetch;
  const startTime = Date.now();
  const maxDuration = options.deadlineMs || 100000; // 100s default within 120s scan limit

  const matches: OsvQueryMatch[] = [];
  const failedQueries: Array<{ name: string; version: string; reason: string }> = [];
  const uniqueAdvisoryIds = new Set<string>();
  let queriedCount = 0;

  // Chunk pairs into batches of at most 100
  for (let i = 0; i < pairs.length; i += CHUNK_SIZE) {
    if (Date.now() - startTime > maxDuration) {
      // Remaining pairs marked as failed due to scan deadline
      for (let j = i; j < pairs.length; j++) {
        failedQueries.push({
          name: pairs[j].name,
          version: pairs[j].version,
          reason: "Scan deadline exceeded before query chunk could be sent",
        });
      }
      break;
    }

    const chunk = pairs.slice(i, i + CHUNK_SIZE);
    const queryPayload = {
      queries: chunk.map((p) => ({
        package: { ecosystem: "npm" as const, name: p.name },
        version: p.version,
      })),
    };

    try {
      const batchResp = await postWithRetry(
        OSV_BATCH_URL,
        queryPayload,
        Math.min(15000, Math.max(1000, maxDuration - (Date.now() - startTime))),
        fetchFn
      );

      if (!batchResp.ok) {
        throw new Error(`OSV querybatch HTTP error: ${batchResp.status}`);
      }

      const body = (await batchResp.json()) as OsvBatchResponse;
      const results = body.results || [];

      // Match positions back to input pairs
      for (let idx = 0; idx < chunk.length; idx++) {
        const pair = chunk[idx];
        queriedCount++;
        const itemResult = results[idx];

        if (!itemResult) {
          failedQueries.push({
            name: pair.name,
            version: pair.version,
            reason: "OSV batch result missing corresponding item position",
          });
          continue;
        }

        const foundAdvisories = new Set<string>();
        if (itemResult.vulns) {
          for (const v of itemResult.vulns) {
            if (v.id) {
              foundAdvisories.add(v.id);
              uniqueAdvisoryIds.add(v.id);
            }
          }
        }

        // Check pagination if next_page_token exists
        let pageToken = itemResult.next_page_token;
        let pageCount = 1;

        while (pageToken && pageCount < MAX_PAGES_PER_QUERY) {
          if (Date.now() - startTime > maxDuration) break;
          pageCount++;
          try {
            const pageQuery = {
              queries: [
                {
                  package: { ecosystem: "npm" as const, name: pair.name },
                  version: pair.version,
                },
              ],
              page_token: pageToken,
            };
            const pageResp = await postWithRetry(
              OSV_BATCH_URL,
              pageQuery,
              Math.min(15000, Math.max(1000, maxDuration - (Date.now() - startTime))),
              fetchFn
            );
            if (pageResp.ok) {
              const pageBody = (await pageResp.json()) as OsvBatchResponse;
              const pItem = pageBody.results?.[0];
              if (pItem?.vulns) {
                for (const v of pItem.vulns) {
                  if (v.id) {
                    foundAdvisories.add(v.id);
                    uniqueAdvisoryIds.add(v.id);
                  }
                }
              }
              pageToken = pItem?.next_page_token;
            } else {
              break;
            }
          } catch {
            break;
          }
        }

        matches.push({
          packageName: pair.name,
          version: pair.version,
          advisoryIds: Array.from(foundAdvisories),
        });
      }
    } catch (err) {
      for (const pair of chunk) {
        failedQueries.push({
          name: pair.name,
          version: pair.version,
          reason: (err as Error).message || "OSV batch lookup failed",
        });
      }
    }
  }

  // Hydrate unique advisory details with concurrency limit of 4
  const advisoryMap = new Map<string, OsvAdvisoryDetail>();
  const unhydratedAdvisoryIds: string[] = [];
  const idList = Array.from(uniqueAdvisoryIds);
  const CONCURRENCY = 4;

  for (let i = 0; i < idList.length; i += CONCURRENCY) {
    if (Date.now() - startTime > maxDuration) {
      for (let j = i; j < idList.length; j++) {
        unhydratedAdvisoryIds.push(idList[j]);
      }
      break;
    }

    const batch = idList.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (advId) => {
        try {
          const detailUrl = `${OSV_VULN_URL_PREFIX}${encodeURIComponent(advId)}`;
          const resp = await fetchWithRetry(
            detailUrl,
            Math.min(15000, Math.max(1000, maxDuration - (Date.now() - startTime))),
            fetchFn
          );
          if (resp.ok) {
            const detail = (await resp.json()) as OsvAdvisoryDetail;
            advisoryMap.set(advId, detail);
          } else {
            unhydratedAdvisoryIds.push(advId);
          }
        } catch {
          unhydratedAdvisoryIds.push(advId);
        }
      })
    );
  }

  return {
    matches,
    advisories: advisoryMap,
    unhydratedAdvisoryIds,
    failedQueries,
    queriedCount,
  };
}

async function postWithRetry(
  url: string,
  body: unknown,
  timeoutMs: number,
  fetchFn: typeof fetch
): Promise<Response> {
  let attempt = 0;
  const maxAttempts = 3;

  while (attempt < maxAttempts) {
    attempt++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "Vulnerability-Response-Console/1.0",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (res.status === 429 || res.status >= 500) {
        if (attempt < maxAttempts) {
          const retryAfter = res.headers.get("retry-after");
          const delay = retryAfter ? Math.min(Number(retryAfter) * 1000, 3000) : 500 * attempt;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }

      return res;
    } catch (err: unknown) {
      if (attempt >= maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("Maximum retry attempts exceeded for OSV request");
}

async function fetchWithRetry(
  url: string,
  timeoutMs: number,
  fetchFn: typeof fetch
): Promise<Response> {
  let attempt = 0;
  const maxAttempts = 3;

  while (attempt < maxAttempts) {
    attempt++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetchFn(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "Vulnerability-Response-Console/1.0",
        },
        signal: controller.signal,
      });

      if (res.status === 429 || res.status >= 500) {
        if (attempt < maxAttempts) {
          const delay = 500 * attempt;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }

      return res;
    } catch (err: unknown) {
      if (attempt >= maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("Maximum retry attempts exceeded for OSV advisory request");
}
