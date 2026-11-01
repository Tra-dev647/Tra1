import { adminGuard } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { put } from "@vercel/blob";

export const runtime = "nodejs";

// Max upload size: 5 MB
const MAX_BYTES = 5 * 1024 * 1024;

// Strict whitelist of allowed image types + their file extensions.
const ALLOWED: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function POST(req: NextRequest) {
  const denied = await adminGuard();
  if (denied) return denied;

  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size === 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large. Max ${MAX_BYTES / 1024 / 1024}MB.` },
        { status: 413 }
      );
    }

    const ext = ALLOWED[file.type];
    if (!ext) {
      return NextResponse.json(
        { error: `Unsupported type "${file.type}". Use PNG, JPG, WEBP, or GIF.` },
        { status: 415 }
      );
    }

    // Generate a safe random filename — ignore the client-supplied name
    // entirely to prevent path traversal and collisions.
    const name = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    // Production (Vercel): the filesystem is read-only/ephemeral, so store in Vercel Blob.
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const blob = await put(`uploads/${name}`, buffer, {
        access: "public",
        contentType: file.type,
        addRandomSuffix: false,
      });
      return NextResponse.json({ url: blob.url, size: file.size, type: file.type });
    }

    // Local dev fallback: write to public/uploads.
    if (process.env.VERCEL) {
      return NextResponse.json(
        { error: "BLOB_READ_WRITE_TOKEN is not configured (create a Vercel Blob store)" },
        { status: 500 }
      );
    }
    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(path.join(uploadsDir, name), buffer);

    return NextResponse.json({
      url: `/uploads/${name}`,
      size: file.size,
      type: file.type,
    });
  } catch (err) {
    console.error("[upload] error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
