import { adminGuard } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { checkBakongPayment } from "@/lib/payment";
import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ orderNumber: string }> }) {
  const denied = await adminGuard();
  if (denied) return denied;

  const order = await prisma.order.findUnique({ where: { orderNumber: (await params).orderNumber.toUpperCase() } });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!order.paymentRef || order.status !== "PENDING") return NextResponse.json({ error: "No pending Bakong payment" }, { status: 400 });
  const remote = await checkBakongPayment(order.paymentRef);
  const expectedAccount = process.env.BAKONG_ACCOUNT_ID?.trim();
  const valid = remote && remote.currency === "USD" && Math.abs(Number(remote.amount) - order.amountUsd) < 0.005 && remote.toAccountId?.toLowerCase() === expectedAccount?.toLowerCase();
  let updated = order;
  if (valid) updated = await prisma.order.update({ where: { id: order.id }, data: { status: "PAID", paidAt: new Date(), paymentRef: remote.hash, currency: "USD", amountKhr: null } });
  await writeAudit({ action: "order.bakong_refresh", targetType: "order", targetId: order.id, details: { paymentRef: order.paymentRef, paid: !!valid } });
  return NextResponse.json({ paid: !!valid, order: updated });
}
