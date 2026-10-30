import { NextRequest, NextResponse } from "next/server";
import { verifyMobileLegendsAccount } from "@/lib/khmer-topup";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    const playerId = req.nextUrl.searchParams.get("player_id") || "";
    const serverId = req.nextUrl.searchParams.get("server_id") || "";
    if (!/^\d{5,20}$/.test(playerId) || !/^\d{1,8}$/.test(serverId)) return NextResponse.json({ error: "Valid User ID and Zone ID are required" }, { status: 400 });
    return NextResponse.json(await verifyMobileLegendsAccount(playerId, serverId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Account check failed" }, { status: 502 });
  }
}
