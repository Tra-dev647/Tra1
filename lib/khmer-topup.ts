const BASE = (process.env.KHMER_TOPUP_API_URL || "https://khmer-topup.com/api/v1").replace(/\/$/, "");

function apiKey() {
  const key = process.env.KHMER_TOPUP_API_KEY?.trim();
  if (!key) throw new Error("KHMER_TOPUP_API_KEY is not configured");
  return key;
}

export async function khmerTopupRequest<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path.startsWith("/") ? path : `/${path}`}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(15000),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof json?.error === "string" ? json.error : `Khmer Topup API HTTP ${response.status}`;
    throw new Error(`${message} (HTTP ${response.status})`);
  }
  return json as T;
}

export interface KhmerTopupPackage {
  package_id: number;
  name: string;
  price: number;
  tag?: string | null;
}
export interface KhmerTopupGame {
  slug: string;
  name: string;
  id_label: string;
  server_label: string | null;
  packages: KhmerTopupPackage[];
}

export async function getKhmerTopupBalance() {
  return khmerTopupRequest<{ username: string; role: string; balance: number; currency: string }>("/me");
}

export async function getKhmerTopupGames() {
  const data = await khmerTopupRequest<{ games: KhmerTopupGame[] }>("/games");
  return Array.isArray(data.games) ? data.games : [];
}

export async function getMobileLegendsCatalog() {
  const games = await getKhmerTopupGames();
  const game = games.find((g) => g.slug === "mobile-legends");
  if (!game) throw new Error("Mobile Legends (mobile-legends) is not available in Khmer Topup catalog");
  return game;
}

export async function verifyMobileLegendsAccount(playerId: string, serverId: string) {
  const query = new URLSearchParams({ slug: "mobile-legends", player_id: playerId });
  if (serverId.trim()) query.set("server_id", serverId.trim());
  return khmerTopupRequest<{ result: "valid" | "invalid" | "incomplete" | "unknown"; nickname?: string; message?: string }>(`/check?${query.toString()}`);
}

export async function placeMobileLegendsTopup(input: {
  packageId?: number | null;
  packageName: string;
  playerId: string;
  serverId: string;
  reference: string;
}) {
  const game = await getMobileLegendsCatalog();
  const wanted = input.packageName.trim().toLowerCase().replace(/\s+/g, " ");
  const pack = input.packageId
    ? game.packages.find((p) => p.package_id === input.packageId)
    : game.packages.find((p) => p.name.trim().toLowerCase().replace(/\s+/g, " ") === wanted);
  if (!pack) throw new Error(`Package not found in live Khmer Topup catalog: ${input.packageName}. Sync the catalog before enabling fulfilment.`);
  return khmerTopupRequest<{ order_code: string; status: string; price: number; balance?: number }>("/orders", {
    method: "POST",
    body: JSON.stringify({
      package_id: pack.package_id,
      player_id: input.playerId,
      ...(input.serverId.trim() ? { server_id: input.serverId.trim() } : {}),
      reference: input.reference,
    }),
  });
}

export async function getKhmerTopupOrder(orderCode: string) {
  return khmerTopupRequest<{ order_code: string; status: string; price?: number }>(`/orders/${encodeURIComponent(orderCode)}`);
}
