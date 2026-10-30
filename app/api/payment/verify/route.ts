import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkBakongPayment } from "@/lib/payment";
import { getKhmerTopupOrder, placeMobileLegendsTopup } from "@/lib/khmer-topup";
import { checkRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const orderNumber = String(body?.orderNumber || "").trim().toUpperCase();
    if (!/^[A-Z0-9-]{5,40}$/.test(orderNumber)) {
      return NextResponse.json({ error: "Invalid order number" }, { status: 400 });
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!checkRateLimit(`verify:${ip}:${orderNumber}`, 30, 60_000)) {
      return NextResponse.json({ error: "Too many requests — try again shortly" }, { status: 429 });
    }

    const order = await prisma.order.findUnique({
      where: { orderNumber },
      include: { game: true, product: true },
    });
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (order.status === "PROCESSING" && order.deliveryNote) {
      const code = order.deliveryNote.match(/KT-[A-Z0-9]+/i)?.[0];
      if (code) {
        try {
          const remote = await getKhmerTopupOrder(code);
          if (remote.status === "completed") {
            await prisma.order.update({ where: { id: order.id }, data: { status: "DELIVERED", deliveredAt: new Date() } });
            return NextResponse.json({ paid: true, status: "DELIVERED", resellerOrder: code });
          }
          if (remote.status === "refunded") {
            await prisma.order.update({ where: { id: order.id }, data: { status: "FAILED", failureReason: "Khmer Topup refunded the provider order" } });
            return NextResponse.json({ paid: true, status: "FAILED", resellerOrder: code });
          }
        } catch (statusError) {
          console.warn("Khmer Topup status check failed:", statusError instanceof Error ? statusError.message : statusError);
        }
      }
    }
    if (order.status !== "PENDING") {
      return NextResponse.json({ paid: ["PAID", "PROCESSING", "DELIVERED"].includes(order.status), status: order.status });
    }
    if (!order.paymentRef || !order.qrString) {
      return NextResponse.json({ error: "Payment QR is not ready" }, { status: 409 });
    }
    if (order.paymentExpiresAt && order.paymentExpiresAt.getTime() < Date.now()) {
      return NextResponse.json({ paid: false, expired: true, status: "PENDING" });
    }

    const tx = await checkBakongPayment(order.paymentRef);
    if (!tx) return NextResponse.json({ paid: false, status: "PENDING" });

    const expectedAccount = process.env.BAKONG_ACCOUNT_ID?.trim();
    const paidAmount = Number(tx.amount);
    const correct =
      tx.currency === "USD" &&
      Number.isFinite(paidAmount) && Math.abs(paidAmount - order.amountUsd) < 0.005 &&
      !!expectedAccount && tx.toAccountId?.toLowerCase() === expectedAccount.toLowerCase();
    if (!correct) {
      console.error("Bakong transaction did not match order", { orderNumber, currency: tx.currency, amount: paidAmount, toAccountId: tx.toAccountId });
      return NextResponse.json({ error: "Payment details do not match this order" }, { status: 409 });
    }

    // Atomic claim prevents concurrent verification requests from processing twice.
    const claimed = await prisma.order.updateMany({
      where: { id: order.id, status: "PENDING" },
      data: { status: "PAID", paidAt: new Date(), paymentRef: tx.hash, currency: "USD", amountKhr: null },
    });
    if (claimed.count === 0) return NextResponse.json({ paid: true, status: "PAID" });

    // Auto-submit using the exact live provider package ID synced into the local product record.
    // If not mapped, payment remains PAID for admin review; no wallet charge is attempted.
    if (order.game.slug === "mobile-legends" && order.serverId) {
      try {
        const result = await placeMobileLegendsTopup({
          packageId: order.product.providerPackageId,
          packageName: order.product.name,
          playerId: order.playerUid,
          serverId: order.serverId,
          reference: order.orderNumber,
        });
        await prisma.order.update({
          where: { id: order.id },
          data: {
            status: result.status === "completed" ? "DELIVERED" : "PROCESSING",
            deliveryNote: `Khmer Topup order ${result.order_code || "submitted"}`,
            deliveredAt: result.status === "completed" ? new Date() : null,
          },
        });
        return NextResponse.json({ paid: true, status: result.status === "completed" ? "DELIVERED" : "PROCESSING", resellerOrder: result.order_code || null });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Reseller submission failed";
        await prisma.order.update({ where: { id: order.id }, data: { status: "PAID", failureReason: `Paid; manual fulfilment required: ${message}` } });
        return NextResponse.json({ paid: true, status: "PAID", fulfilment: "manual_review" });
      }
    }

    return NextResponse.json({ paid: true, status: "PAID", fulfilment: "manual_review" });
  } catch (error) {
    console.error("Bakong verify error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Verification failed" }, { status: 500 });
  }
}
