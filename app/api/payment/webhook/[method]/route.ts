import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
export async function POST(_req: NextRequest, { params }: { params: Promise<{ method: string }> }) {
  return NextResponse.json({ error: "This payment webhook is not used. Verify Bakong payments through /api/payment/verify." }, { status: 410 });
}
