import { NextResponse } from "next/server";
import { getMobileLegendsCatalog } from "@/lib/khmer-topup";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const game = await getMobileLegendsCatalog();
    return NextResponse.json({ currency: "USD", game: { slug: game.slug, name: game.name, id_label: game.id_label, server_label: game.server_label, packages: game.packages } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Catalog unavailable" }, { status: 502 });
  }
}
