import { NextRequest, NextResponse } from "next/server";
import { verifyAccount } from "@/lib/khmer-topup";
import { checkRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// TEMPORARY diagnostics: open
//   /api/lookup-uid/debug?slug=free-fire&uid=PLAYER_ID
// in a browser to see what each provider answers. Delete this file when done.
export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(`uid-debug:${ip}`, 5, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const slug = req.nextUrl.searchParams.get("slug") ?? "free-fire";
  const uid = req.nextUrl.searchParams.get("uid") ?? "";
  const server = req.nextUrl.searchParams.get("server") ?? undefined;
  if (!/^\d{5,20}$/.test(uid)) {
    return NextResponse.json({ error: "uid must be 5-20 digits" }, { status: 400 });
  }

  const out: Record<string, unknown> = { slug, uid };

  try {
    out.khmerTopup = await verifyAccount(slug, uid, server);
  } catch (e) {
    out.khmerTopupError = e instanceof Error ? e.message : String(e);
  }

  if (slug === "free-fire") {
    try {
      const r = await fetch(
        `https://v1.camrapidx.com/validate_user/FreeFire_LevelUpPass.php?UserID=${encodeURIComponent(uid)}`,
        { cache: "no-store", signal: AbortSignal.timeout(6000) },
      );
      out.camrapid = { status: r.status, body: (await r.text()).slice(0, 300) };
    } catch (e) {
      out.camrapidError = e instanceof Error ? e.message : String(e);
    }
  }

  return NextResponse.json(out);
}
