/**
 * Rate limiter.
 *
 * - If UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set, uses Upstash
 *   Redis over REST (shared across all serverless instances — works on Vercel).
 * - Otherwise falls back to an in-memory sliding window (fine for local dev /
 *   a single Node process, NOT reliable on serverless).
 *
 * Returns `true` if the request is allowed, `false` if rate-limited.
 * If Upstash is configured but unreachable, it fails OPEN (allows the request)
 * so a Redis outage can't take down checkout; the error is logged.
 */

const store = new Map<string, number[]>();

function memoryLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  const timestamps = (store.get(key) ?? []).filter((t) => t > cutoff);
  if (timestamps.length >= max) {
    store.set(key, timestamps);
    return false;
  }
  timestamps.push(now);
  store.set(key, timestamps);
  // Opportunistic cleanup so the Map can't grow forever.
  if (store.size > 5000) {
    for (const [k, v] of store) {
      if (!v.length || v[v.length - 1] <= cutoff) store.delete(k);
    }
  }
  return true;
}

async function upstashLimit(
  url: string,
  token: string,
  key: string,
  max: number,
  windowMs: number,
): Promise<boolean> {
  // Fixed window: INCR the counter, set expiry on first hit.
  const bucket = Math.floor(Date.now() / windowMs);
  const redisKey = `rl:${key}:${bucket}`;
  const res = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      ["INCR", redisKey],
      ["PEXPIRE", redisKey, String(windowMs * 2), "NX"],
    ]),
    cache: "no-store",
    signal: AbortSignal.timeout(2500),
  });
  if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`);
  const out = (await res.json()) as Array<{ result?: number; error?: string }>;
  const count = Number(out?.[0]?.result);
  if (!Number.isFinite(count)) throw new Error(out?.[0]?.error || "Upstash bad response");
  return count <= max;
}

export async function checkRateLimit(
  key: string,
  max: number,
  windowMs: number,
): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (url && token) {
    try {
      return await upstashLimit(url, token, key, max, windowMs);
    } catch (err) {
      console.error("[rateLimit] Upstash failed, failing open:", err);
      return true;
    }
  }
  return memoryLimit(key, max, windowMs);
}
