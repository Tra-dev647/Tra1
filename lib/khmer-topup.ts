const BASE = (process.env.KHMER_TOPUP_API_URL || "https://khmer-topup.com/api/v1").replace(/\/$/, "");

function apiKey() {
  const key = process.env.KHMER_TOPUP_API_KEY?.trim();
  if (!key) throw new Error("KHMER_TOPUP_API_KEY is not configured");
  return key;
}

export async function khmerTopupRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...init.headers,
    },
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(15000),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error || `Khmer Topup API HTTP ${response.status}`);
  return json;
}

export async function getMobileLegendsCatalog() {
  const data = await khmerTopupRequest("/games");
  const game = (data.games || []).find((g: any) => g.slug === "mobile-legends");
  if (!game) throw new Error("Mobile Legends is not available in Khmer Topup catalog");
  return game;
}

export async function verifyMobileLegendsAccount(playerId: string, serverId: string) {
  const query = new URLSearchParams({ slug: "mobile-legends", player_id: playerId, server_id: serverId });
  return khmerTopupRequest(`/check?${query.toString()}`);
}

// Find the exact provider package name; never guess a package ID from its diamond count.
export async function placeMobileLegendsTopup(input: {
  packageName: string;
  playerId: string;
  serverId: string;
  reference: string;
}) {
  const game = await getMobileLegendsCatalog();
  const wanted = input.packageName.trim().toLowerCase().replace(/\s+/g, " ");
  const pack = (game.packages || []).find((p: any) => String(p.name).trim().toLowerCase().replace(/\s+/g, " ") === wanted);
  if (!pack) throw new Error(`Provider package not mapped: ${input.packageName}. Configure matching package names before enabling auto-fulfilment.`);
  return khmerTopupRequest("/orders", {
    method: "POST",
    body: JSON.stringify({
      package_id: pack.package_id,
      player_id: input.playerId,
      server_id: input.serverId,
      reference: input.reference,
    }),
  });
}
