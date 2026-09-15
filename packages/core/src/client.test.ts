import { test, expect } from "vitest";
import { createClient } from "./client.js";

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

/** A scripted fetch: each call pops the next handler off the queue. */
function scriptedFetch(handlers: Array<() => Response | Promise<Response>>): typeof fetch {
  let i = 0;
  return (async () => {
    if (i >= handlers.length) throw new Error("scriptedFetch: ran out of scripted responses");
    return handlers[i++]!();
  }) as unknown as typeof fetch;
}

const instantSleep = async () => {};

function testClient(fetchImpl: typeof fetch, overrides: Partial<Parameters<typeof createClient>[1]> = {}) {
  return createClient("test-key", { fetchImpl, sleep: instantSleep, maxRetries: 3, baseDelayMs: 1, ...overrides });
}

// ---- pagination ----

test("paginate: follows next_page across multiple pages and concatenates rows", async () => {
  const fetchImpl = scriptedFetch([
    () => jsonResponse({ data: [{ id: 1 }], next_page: "p2" }),
    () => jsonResponse({ data: [{ id: 2 }], next_page: null }),
  ]);
  const client = testClient(fetchImpl);
  const rows = await client.getUserActivity("2026-06-01");
  expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
});

test("paginate: a looping cursor is capped at maxPages with a descriptive error, not an infinite loop", async () => {
  const fetchImpl = (async () =>
    jsonResponse({ data: [{ id: 1 }], next_page: "always-more" })) as unknown as typeof fetch;
  const client = testClient(fetchImpl, { maxPages: 3 });
  await expect(client.getUserActivity("2026-06-01")).rejects.toThrow(/exceeded 3 pages/);
});

// ---- retry / backoff ----

test("get: a 429 followed by success succeeds overall, honouring Retry-After", async () => {
  const fetchImpl = scriptedFetch([
    () => jsonResponse({ error: "rate limited" }, { status: 429, headers: { "retry-after": "0" } }),
    () => jsonResponse({ summaries: [{ starting_at: "2026-06-01T00:00:00Z" } as never] }),
  ]);
  const client = testClient(fetchImpl);
  const summaries = await client.getSummaries("2026-06-01", "2026-06-02");
  expect(summaries).toHaveLength(1);
});

test("get: a 500 is retried and eventually succeeds", async () => {
  const fetchImpl = scriptedFetch([
    () => jsonResponse({ error: "boom" }, { status: 500 }),
    () => jsonResponse({ error: "boom" }, { status: 502 }),
    () => jsonResponse({ summaries: [] }),
  ]);
  const client = testClient(fetchImpl);
  await expect(client.getSummaries("2026-06-01", "2026-06-02")).resolves.toEqual([]);
});

test("get: exhausting all retries on a persistent 5xx still throws", async () => {
  const fetchImpl = (async () => jsonResponse({ error: "down" }, { status: 503 })) as unknown as typeof fetch;
  const client = testClient(fetchImpl, { maxRetries: 2 });
  await expect(client.getSummaries("2026-06-01", "2026-06-02")).rejects.toThrow(/failed \(503\)/);
});

test("get: a 400 is not retried at all (not a transient failure)", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return jsonResponse({ error: "bad request" }, { status: 400 });
  }) as unknown as typeof fetch;
  const client = testClient(fetchImpl);
  await expect(client.getSummaries("2026-06-01", "2026-06-02")).rejects.toThrow(/failed \(400\)/);
  expect(calls).toBe(1);
});

// ---- timeout ----

test("get: a request that never resolves times out via AbortSignal rather than hanging forever", async () => {
  const fetchImpl = ((_url: unknown, init?: { signal?: AbortSignal }) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation timed out.", "TimeoutError"));
      });
    })) as unknown as typeof fetch;
  const client = testClient(fetchImpl, { timeoutMs: 5, maxRetries: 0 });
  await expect(client.getSummaries("2026-06-01", "2026-06-02")).rejects.toThrow(/timed out after 5ms/);
});
