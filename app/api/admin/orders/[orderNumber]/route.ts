import { adminGuard } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { writeAudit } from "@/lib/audit";
import { notifyTelegram, escapeHtml } from "@/lib/telegram";
import { notifyCustomer } from "@/lib/telegramShop";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const updateSchema = z.object({
  status: z.enum([
    "PENDING",
    "PAID",
    "PROCESSING",
    "DELIVERED",
    "FAILED",
    "REFUNDED",
    "CANCELLED",
  ]).optional(),
  deliveryNote: z.string().optional(),
  failureReason: z.string().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  const denied = await adminGuard();
  if (denied) return denied;

  const order = await prisma.order.findUnique({
    where: { orderNumber: (await params).orderNumber },
    include: {
      game: true,
      product: true,
    },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(order);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  const denied = await adminGuard();
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { orderNumber: (await params).orderNumber },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: any = { ...parsed.data };
  if (parsed.data.status === "DELIVERED" && !order.deliveredAt) {
    data.deliveredAt = new Date();
  }
  if (parsed.data.status === "PAID" && !order.paidAt) {
    data.paidAt = new Date();
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data,
  });

  if (parsed.data.status && parsed.data.status !== order.status) {
    await writeAudit({
      action: `order.status.${parsed.data.status.toLowerCase()}`,
      targetType: "order",
      targetId: order.orderNumber,
      details: `${order.status} → ${parsed.data.status}`,
    });
    if (parsed.data.status === "DELIVERED" || parsed.data.status === "PAID") {
      await notifyTelegram(
        `✅ <b>Order ${escapeHtml(parsed.data.status)}</b>\n` +
          `#${escapeHtml(order.orderNumber)} — $${order.amountUsd.toFixed(2)}\n` +
          `UID: <code>${escapeHtml(order.playerUid)}</code>`
      );
    }
    // Tell customers who ordered through the Telegram shop bot.
    const customerMsg: Record<string, string> = {
      DELIVERED: `🎉 ការបញ្ជាទិញ <b>${escapeHtml(order.orderNumber)}</b> បាន Top Up ជោគជ័យ! សូមអរគុណ។`,
      FAILED: `❌ ការបញ្ជាទិញ <b>${escapeHtml(order.orderNumber)}</b> បរាជ័យ។ សូមទាក់ទង Admin។`,
      REFUNDED: `↩️ ការបញ្ជាទិញ <b>${escapeHtml(order.orderNumber)}</b> ត្រូវបានសង់ប្រាក់វិញ។`,
      CANCELLED: `🚫 ការបញ្ជាទិញ <b>${escapeHtml(order.orderNumber)}</b> ត្រូវបានលុបចោល។`,
    };
    const m = customerMsg[parsed.data.status];
    if (m) await notifyCustomer(order.telegramChatId, m);
  } else if (parsed.data.deliveryNote || parsed.data.failureReason) {
    await writeAudit({
      action: "order.note",
      targetType: "order",
      targetId: order.orderNumber,
      details: parsed.data.deliveryNote || parsed.data.failureReason,
    });
  }

  return NextResponse.json(updated);
}
