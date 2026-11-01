import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/utils";
import { verifyAndFulfil } from "@/lib/fulfil";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const orderNumber = String(body?.orderNumber || "").trim().toUpperCase();
    if (!/^[A-Z0-9-]{5,40}$/.test(orderNumber)) {
      return NextResponse.json({ error: "Invalid order number" }, { status: 400 });
    }

    const ip = getClientIp(req.headers);
    if (!(await checkRateLimit(`verify:${ip}:${orderNumber}`, 30, 60_000))) {
      return NextResponse.json({ error: "Too many requests — try again shortly" }, { status: 429 });
    }

    const r = await verifyAndFulfil(orderNumber);
    switch (r.kind) {
      case "not_found": return NextResponse.json({ error: "Order not found" }, { status: 404 });
      case "not_ready": return NextResponse.json({ error: "Payment QR is not ready" }, { status: 409 });
      case "expired": return NextResponse.json({ paid: false, expired: true, status: "PENDING" });
      case "pending": return NextResponse.json({ paid: false, status: "PENDING" });
      case "mismatch": return NextResponse.json({ error: "Payment details do not match this order" }, { status: 409 });
      case "state": return NextResponse.json({ paid: r.paid, status: r.status });
      case "paid":
        return NextResponse.json({
          paid: true,
          status: r.status,
          ...(r.fulfilment ? { fulfilment: r.fulfilment } : {}),
          ...(r.resellerOrder !== undefined ? { resellerOrder: r.resellerOrder } : {}),
        });
    }
  } catch (error) {
    console.error("Bakong verify error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Verification failed" }, { status: 500 });
  }
}
