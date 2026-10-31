/**
 * Game-specific UID → in-game nickname lookup.
 *
 * Uses the community API at api.isan.eu.org (no auth, best-effort).
 * Every function has a 5 s timeout and catches all errors → returns null.
 */

import { verifyMobileLegendsAccount, verifyGameAccount } from "@/lib/khmer-topup";

// ---------- helpers ----------

// Khmer Topup response shape can vary; look for a nickname in common places.
function pickName(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const keys = ["nickname", "username", "user_name", "player_name", "playerName", "name", "ign"];
  const queue: unknown[] = [payload];
  for (let depth = 0; depth < 3 && queue.length; depth++) {
    const next: unknown[] = [];
    for (const item of queue) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      for (const k of keys) {
        const v = obj[k];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
      for (const k of ["data", "result", "account", "player", "user"]) {
        if (obj[k]) next.push(obj[k]);
      }
    }
    queue.length = 0;
    queue.push(...next);
  }
  return null;
}

interface IsanResponse {
  success?: boolean;
  name?: string;
  message?: string;
}

async function fetchIsan(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);

    const data: IsanResponse = await res.json();
    if (data.success && data.name) return data.name;
    return null;
  } catch {
    return null;
  }
}

// ---------- per-game lookups ----------

export async function lookupMobileLegends(
  uid: string,
  zone: string,
): Promise<string | null> {
  // 1) Khmer Topup reseller check (uses KHMER_TOPUP_API_KEY on the server)
  try {
    const data = await verifyMobileLegendsAccount(uid, zone);
    const name = pickName(data);
    if (name) return name;
    console.warn("[uidLookup] Khmer Topup check returned no name, keys:", Object.keys((data as object) ?? {}));
  } catch (err) {
    console.warn("[uidLookup] Khmer Topup check failed:", err instanceof Error ? err.message : err);
  }
  // 2) Fallback: community API
  return fetchIsan(
    `https://api.isan.eu.org/nickname/ml/${encodeURIComponent(uid)}/${encodeURIComponent(zone)}`,
  );
}

async function lookupFreeFireLegacy(uid: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(
      `https://v1.camrapidx.com/validate_user/FreeFire_LevelUpPass.php?UserID=${encodeURIComponent(uid)}`,
      {
        headers: { Accept: "application/json", "User-Agent": "TRATOPUP/1.0" },
        cache: "no-store",
        signal: controller.signal,
      },
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data || data.status !== "APPROVED") return null;
    return typeof data.username === "string" && data.username ? data.username : null;
  } catch {
    return null;
  }
}

export async function lookupFreeFire(uid: string): Promise<string | null> {
  // 1) Khmer Topup reseller check (same API key as Mobile Legends)
  for (const slug of ["free-fire-kh-sg", "freefire-sg", "freefire-sgmy", "freefire-global"]) {
    try {
      const data = await verifyGameAccount(slug, uid);
      const name = pickName(data);
      if (name) return name;
    } catch (err) {
      console.warn(`[uidLookup] FF Khmer Topup (${slug}) failed:`, err instanceof Error ? err.message : err);
    }
  }
  // 2) Community API
  const isan = await fetchIsan(`https://api.isan.eu.org/nickname/ff/${encodeURIComponent(uid)}`);
  if (isan) return isan;
  console.warn("[uidLookup] FF isan returned no name");
  // 3) Old validator (kept as last resort)
  return lookupFreeFireLegacy(uid);
}

export async function lookupGenshin(
  _uid: string,
  _server?: string,
): Promise<string | null> {
  // Stub — upstream doesn't reliably return names for Genshin
  return null;
}

export async function lookupHonkaiStarRail(
  _uid: string,
  _server?: string,
): Promise<string | null> {
  // Stub — upstream doesn't reliably return names for HSR
  return null;
}

// ---------- router ----------

/**
 * Looks up the in-game nickname for a given game + UID + optional server.
 * Returns the nickname string or null if lookup is unsupported / fails.
 */
export async function lookupNickname(
  gameSlug: string,
  uid: string,
  server?: string,
): Promise<string | null> {
  switch (gameSlug) {
    case "mobile-legends":
      return server ? lookupMobileLegends(uid, server) : null;
    case "free-fire":
      return lookupFreeFire(uid);
    case "free-fire-bonus":
      return lookupFreeFireBonus(uid);
    case "genshin-impact":
      return lookupGenshin(uid, server);
    case "honkai-star-rail":
      return lookupHonkaiStarRail(uid, server);
    default:
      return null;
  }
}

export async function lookupFreeFireBonus(uid: string): Promise<string | null> {
  try {
    const data = await verifyGameAccount("free-fire-bonuse", uid);
    const name = pickName(data);
    if (name) return name;
    console.warn("[uidLookup] FF Bonus returned no name, keys:", Object.keys((data as object) ?? {}));
  } catch (err) {
    console.warn("[uidLookup] FF Bonus check failed:", err instanceof Error ? err.message : err);
  }
  return fetchIsan(`https://api.isan.eu.org/nickname/ff/${encodeURIComponent(uid)}`);
}
