import { prisma } from "@/lib/prisma";
import { checkBakongPayment } from "@/lib/payment";
import { placeMobileLegendsTopup } from "@/lib/khmer-topup";
import { notifyTelegram, escapeHtml } from "@/lib/telegram";

export type VerifyResult =
  | { kind: "not_found" }
  | { kind: "not_ready" }
  | { kind: "expired" }
  | { kind: "pending" }
  | { kind: "mismatch" }
  | { kind: "state"; paid: boolean; status: string }
  | { kind: "paid"; status: "PAID" | "PROCESSING" | "DELIVERED"; fulfilment?: "manual_review"; resellerOrder?: string | null; justClaimed: boolean };

/**
 * Checks Bakong for the order's payment, and (once) marks it PAID and tries to auto-fulfil.
 * Shared by POST /api/payment/verify (website) and the Telegram shop bot.
 * The atomic updateMany claim guarantees only one caller processes a payment.
 */
export async function verifyAndFulfil(orderNumber: string): Promise<VerifyResult> {
  const order = await prisma.order.findUnique({
    where: { orderNumber },
    include: { game: true, product: true },
  });
  if (!order) return { kind: "not_found" };
  if (order.status !== "PENDING") {
    return { kind: "state", paid: ["PAID", "PROCESSING", "DELIVERED"].includes(order.status), status: order.status };
  }
  if (!order.paymentRef || !order.qrString) return { kind: "not_ready" };
  if (order.paymentExpiresAt && order.paymentExpiresAt.getTime() < Date.now()) return { kind: "expired" };

  const tx = await checkBakongPayment(order.paymentRef);
  if (!tx) return { kind: "pending" };

  const expectedAccount = process.env.BAKONG_ACCOUNT_ID?.trim();
  const paidAmount = Number(tx.amount);
  const correct =
    tx.currency === "USD" &&
    Number.isFinite(paidAmount) && Math.abs(paidAmount - order.amountUsd) < 0.005 &&
    !!expectedAccount && tx.toAccountId?.toLowerCase() === expectedAccount.toLowerCase();
  if (!correct) {
    console.error("Bakong transaction did not match order", { orderNumber, currency: tx.currency, amount: paidAmount, toAccountId: tx.toAccountId });
    return { kind: "mismatch" };
  }

  const claimed = await prisma.order.updateMany({
    where: { id: order.id, status: "PENDING" },
    data: { status: "PAID", paidAt: new Date(), paymentRef: tx.hash, currency: "USD", amountKhr: null },
  });
  if (claimed.count === 0) return { kind: "paid", status: "PAID", justClaimed: false };

  // Auto-submit only if the local package name exactly matches the live provider catalog.
  if (order.game.slug === "mobile-legends" && order.serverId) {
    try {
      const result = await placeMobileLegendsTopup({
        packageName: order.product.name,
        playerId: order.playerUid,
        serverId: order.serverId,
        reference: order.orderNumber,
      });
      const status = result.status === "completed" ? "DELIVERED" : "PROCESSING";
      await prisma.order.update({
        where: { id: order.id },
        data: {
          status,
          deliveryNote: `Khmer Topup order ${result.order_code || "submitted"}`,
          deliveredAt: result.status === "completed" ? new Date() : null,
        },
      });
      return { kind: "paid", status, resellerOrder: result.order_code || null, justClaimed: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Reseller submission failed";
      await prisma.order.update({ where: { id: order.id }, data: { status: "PAID", failureReason: `Paid; manual fulfilment required: ${message}` } });
      await notifyAdminManual(order.orderNumber, order.amountUsd, order.game.name, order.product.name, order.playerUid, order.serverId, message);
      return { kind: "paid", status: "PAID", fulfilment: "manual_review", justClaimed: true };
    }
  }

  await notifyAdminManual(order.orderNumber, order.amountUsd, order.game.name, order.product.name, order.playerUid, order.serverId);
  return { kind: "paid", status: "PAID", fulfilment: "manual_review", justClaimed: true };
}

async function notifyAdminManual(
  orderNumber: string, amount: number, game: string, product: string,
  uid: string, serverId: string | null, reason?: string,
) {
  await notifyTelegram(
    `💰 <b>PAID — manual top-up needed</b>\n` +
      `#${escapeHtml(orderNumber)} — $${amount.toFixed(2)}\n` +
      `${escapeHtml(game)} · ${escapeHtml(product)}\n` +
      `UID: <code>${escapeHtml(uid)}</code>${serverId ? ` (${escapeHtml(serverId)})` : ""}` +
      (reason ? `\n⚠️ ${escapeHtml(reason)}` : "")
  );
}
