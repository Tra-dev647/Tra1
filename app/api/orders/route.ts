import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { getClientIp } from "@/lib/utils";
import { createOrder, OrderError } from "@/lib/orderService";
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
    const { paymentMethod: _pm, ...data } = parsed.data;

    const { order } = await createOrder(data, {
      ipAddress: getClientIp(req.headers),
      userAgent: req.headers.get("user-agent") ?? "unknown",
    });

    return NextResponse.json({
      orderNumber: order.orderNumber,
      redirectUrl: `/checkout/${order.orderNumber}`,
    });
  } catch (err) {
    if (err instanceof OrderError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Order create error:", err);
    const msg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
