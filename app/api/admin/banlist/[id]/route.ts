import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { writeAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await prisma.blockedIdentity.delete({ where: { id: (await params).id } });
  await writeAudit({ action: "banlist.remove", targetType: "banlist", targetId: (await params).id });
  return NextResponse.json({ ok: true });
}
