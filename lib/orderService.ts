import { prisma } from "@/lib/prisma";
import { generateOrderNumber, isValidUid } from "@/lib/utils";
import { generateBakongPayment } from "@/lib/payment";

/** Error that carries an HTTP-style status so callers (web API, Telegram bot) can react. */
export class OrderError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface CreateOrderInput {
  gameId: string;
  productId: string;
  playerUid: string;
  serverId?: string;
  customerEmail?: string;
  customerPhone?: string;
  promoCode?: string;
  playerNickname?: string;
  telegramChatId?: string;
}

export interface CreateOrderContext {
  /** Real IP for web orders, or `tg:<chatId>` for Telegram orders (so the banlist can block either). */
  ipAddress: string;
  userAgent: string;
}

/**
 * Single place that creates an order + its Bakong KHQR.
 * Used by POST /api/orders (website) and the Telegram shop bot, so maintenance mode,
 * banlist, price lookup and promo handling behave identically for both.
 */
export async function createOrder(data: CreateOrderInput, ctx: CreateOrderContext) {
  if (!isValidUid(data.playerUid)) throw new OrderError(400, "Invalid UID format");

  const maintSettings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (maintSettings?.maintenanceMode) {
    throw new OrderError(503, maintSettings.maintenanceMessage || "Ordering is temporarily disabled for maintenance.");
  }

  const banCandidates = [
    { type: "email", value: data.customerEmail?.toLowerCase() },
    { type: "phone", value: data.customerPhone?.toLowerCase() },
    { type: "ip", value: ctx.ipAddress.toLowerCase() },
    { type: "uid", value: data.playerUid.toLowerCase() },
  ].filter((c): c is { type: string; value: string } => !!c.value);

  if (banCandidates.length > 0) {
    const blocked = await prisma.blockedIdentity.findFirst({
      where: { OR: banCandidates.map((c) => ({ type: c.type, value: c.value })) },
    });
    if (blocked) {
      throw new OrderError(403, "This order cannot be processed. Contact support if you believe this is a mistake.");
    }
  }

  const [game, product] = await Promise.all([
    prisma.game.findUnique({ where: { id: data.gameId } }),
    prisma.product.findUnique({ where: { id: data.productId } }),
  ]);
  if (!game || !game.active) throw new OrderError(404, "Game not found");
  if (!product || !product.active || product.gameId !== game.id) throw new OrderError(404, "Product not found");
  if (game.requiresServer && !data.serverId) throw new OrderError(400, "Server is required for this game");

  const orderNumber = generateOrderNumber();

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
      await tx.promoCode.update({ where: { id: promoCodeId }, data: { usedCount: { increment: 1 } } });
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
        paymentMethod: "BAKONG",
        status: "PENDING",
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        promoCodeId,
        discountUsd,
        telegramChatId: data.telegramChatId,
      },
    });
  });

  // Fixed-amount USD KHQR generated server-side; the Bakong token never leaves the server.
  try {
    const init = generateBakongPayment({
      orderNumber: order.orderNumber,
      amountUsd: order.amountUsd,
      method: "BAKONG",
      note: `LayzzStore ${game.name} ${product.name}`,
    });
    const updated = await prisma.order.update({
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
    return { order: updated, game, product };
  } catch (paymentErr) {
    await prisma.order.update({ where: { id: order.id }, data: { status: "FAILED", failureReason: "Bakong KHQR generation failed" } });
    throw paymentErr;
  }
}
