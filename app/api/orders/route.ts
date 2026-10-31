import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { generateOrderNumber, isValidUid } from "@/lib/utils";
import { generateBakongPayment } from "@/lib/payment";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const createOrderSchema = z.object({
  gameId: z.string().min(1),
  productId: z.string().min(1),
  playerUid: z.string().min(5).max(20),
  serverId: z.string().optional(),
  customerEmail: z.string().email().optional(),
  customerPhone: z.string().optional(),
  paymentMethod: z.enum(["BAKONG"]).default("BAKONG"),
  promoCode: z.string().optional(),
  playerNickname: z.string().max(100).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = createOrderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const data = parsed.data;

    if (!isValidUid(data.playerUid)) {
      return NextResponse.json({ error: "Invalid UID format" }, { status: 400 });
    }

    // Maintenance mode blocks new orders site-wide.
    const maintSettings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (maintSettings?.maintenanceMode) {
      return NextResponse.json(
        { error: maintSettings.maintenanceMessage || "Ordering is temporarily disabled for maintenance." },
        { status: 503 }
      );
    }

    // Banlist: block orders from flagged emails, phones, IPs or UIDs.
    const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const banCandidates = [
      { type: "email", value: data.customerEmail?.toLowerCase() },
      { type: "phone", value: data.customerPhone?.toLowerCase() },
      { type: "ip", value: ipAddress.toLowerCase() },
      { type: "uid", value: data.playerUid.toLowerCase() },
    ].filter((c): c is { type: string; value: string } => !!c.value);

    if (banCandidates.length > 0) {
      const blocked = await prisma.blockedIdentity.findFirst({
        where: { OR: banCandidates.map((c) => ({ type: c.type, value: c.value })) },
      });
      if (blocked) {
        return NextResponse.json(
          { error: "This order cannot be processed. Contact support if you believe this is a mistake." },
          { status: 403 }
        );
      }
    }

    // Validate game + product match and pricing
    const [game, product, settings] = await Promise.all([
      prisma.game.findUnique({ where: { id: data.gameId } }),
      prisma.product.findUnique({ where: { id: data.productId } }),
      prisma.settings.findUnique({ where: { id: 1 } }),
    ]);

    if (!game || !game.active) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 });
    }
    if (!product || !product.active || product.gameId !== game.id) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    if (game.requiresServer && !data.serverId) {
      return NextResponse.json({ error: "Server is required for this game" }, { status: 400 });
    }

    // Create the order
    const orderNumber = generateOrderNumber();
    const userAgent = req.headers.get("user-agent") ?? "unknown";

    // Promo code handling + order creation in a single transaction to
    // prevent race conditions on the promo usage counter.
    let promoCodeId: string | null = null;
    let discountUsd = 0;
    let finalPrice = product.priceUsd;

    if (data.promoCode) {
      const promo = await prisma.promoCode.findUnique({
        where: { code: data.promoCode.toUpperCase().trim() },
      });
      if (
        promo &&
        promo.active &&
        (!promo.expiresAt || promo.expiresAt >= new Date()) &&
        (promo.maxUses === 0 || promo.usedCount < promo.maxUses) &&
        product.priceUsd >= promo.minOrderUsd
      ) {
        discountUsd =
          promo.discountType === "PERCENT"
            ? (product.priceUsd * promo.discountValue) / 100
            : promo.discountValue;
        discountUsd = Math.min(discountUsd, product.priceUsd);
        discountUsd = Math.round(discountUsd * 100) / 100;
        finalPrice = Math.round((product.priceUsd - discountUsd) * 100) / 100;
        promoCodeId = promo.id;
      }
    }

    const order = await prisma.$transaction(async (tx) => {
      if (promoCodeId) {
        await tx.promoCode.update({
          where: { id: promoCodeId },
          data: { usedCount: { increment: 1 } },
        });
      }
      return tx.order.create({
        data: {
          orderNumber,
          gameId: game.id,
          productId: product.id,
          playerUid: data.playerUid,
          serverId: data.serverId,
          playerNickname: data.playerNickname,
          customerEmail: data.customerEmail,
          customerPhone: data.customerPhone,
          amountUsd: finalPrice,
          amountKhr: null,
          paymentMethod: data.paymentMethod,
          status: "PENDING",
          ipAddress,
          userAgent,
          promoCodeId,
          discountUsd,
        },
      });
    });

    // Generate a fixed-amount USD KHQR on the server. The Bakong token never reaches the browser.
    try {
      const init = generateBakongPayment({
        orderNumber: order.orderNumber,
        amountUsd: order.amountUsd,
        method: "BAKONG",
        note: `LayzzStore ${game.name} ${product.name}`,
      });
      await prisma.order.update({
        where: { id: order.id },
        data: {
          paymentRef: init.paymentRef,
          paymentUrl: null,
          qrString: init.qrString,
          paymentExpiresAt: init.expiresAt,
          currency: "USD",
          amountKhr: null,
          paymentMethod: "BAKONG",
        },
      });
    } catch (paymentErr) {
      await prisma.order.update({ where: { id: order.id }, data: { status: "FAILED", failureReason: "Bakong KHQR generation failed" } });
      throw paymentErr;
    }

    return NextResponse.json({
      orderNumber: order.orderNumber,
      redirectUrl: `/checkout/${order.orderNumber}`,
    });
  } catch (err) {
    console.error("Order create error:", err);
    const msg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
