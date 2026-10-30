import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { getMobileLegendsCatalog } from "@/lib/khmer-topup";

export const dynamic = "force-dynamic";

// Retail price = live reseller cost + configurable USD markup.
function retailPrice(cost: number) {
  const configured = Number(process.env.KHMER_TOPUP_RETAIL_MARKUP_USD ?? "0.15");
  const markup = Number.isFinite(configured) && configured >= 0 ? configured : 0.15;
  return Math.round((cost + markup) * 100) / 100;
}

export async function POST() {
  try {
    await requireAdmin();
    const catalog = await getMobileLegendsCatalog();
    if (!Array.isArray(catalog.packages) || catalog.packages.length === 0) {
      return NextResponse.json({ error: "Khmer Topup returned an empty package list; no local packages were changed." }, { status: 502 });
    }

    const game = await prisma.game.findUnique({ where: { slug: "mobile-legends" } });
    if (!game) return NextResponse.json({ error: "Create the mobile-legends game in the admin dashboard first" }, { status: 404 });

    const packages = catalog.packages.filter((item) =>
      Number.isInteger(item.package_id) && Number.isFinite(item.price) && item.price > 0 &&
      typeof item.name === "string" && item.name.trim().length > 0
    );
    if (!packages.length) {
      return NextResponse.json({ error: "Khmer Topup returned no valid packages; no local packages were changed." }, { status: 502 });
    }

    const synced = await prisma.$transaction(async (tx) => {
      const activeIds: string[] = [];
      for (let index = 0; index < packages.length; index++) {
        const item = packages[index];
        const cost = Math.round(item.price * 100) / 100;
        const amountMatch = item.name.match(/\d+/);
        const data = {
          name: item.name.trim(),
          providerPackageId: item.package_id,
          amount: amountMatch ? Number(amountMatch[0]) : 0,
          providerCostUsd: cost,
          priceUsd: retailPrice(cost),
          badge: item.tag || null,
          active: true,
          sortOrder: index,
        };
        const existing = await tx.product.findFirst({ where: { gameId: game.id, providerPackageId: item.package_id } });
        const product = existing
          ? await tx.product.update({ where: { id: existing.id }, data })
          : await tx.product.create({ data: { ...data, gameId: game.id, bonus: 0 } });
        activeIds.push(product.id);
      }

      // Disable provider packages removed from the live catalog, retaining order history.
      await tx.product.updateMany({
        where: { gameId: game.id, providerPackageId: { not: null }, id: { notIn: activeIds } },
        data: { active: false },
      });
      await tx.game.update({
        where: { id: game.id },
        data: { requiresServer: catalog.server_label !== null, uidLabel: catalog.id_label || "User ID" },
      });
      return activeIds.length;
    });

    const configured = Number(process.env.KHMER_TOPUP_RETAIL_MARKUP_USD ?? "0.15");
    return NextResponse.json({
      ok: true, game: catalog.name, synced, currency: "USD",
      markupUsd: Number.isFinite(configured) && configured >= 0 ? configured : 0.15,
      message: "Live package IDs, names and reseller costs synced. Retail prices use live cost plus configured USD markup.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Catalogue sync failed";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 502 });
  }
}
