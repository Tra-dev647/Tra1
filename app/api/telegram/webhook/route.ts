import crypto from "node:crypto";
import { NextRequest, NextResponse, after } from "next/server";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rateLimit";
import { isValidUid, isValidServerId, formatUsd } from "@/lib/utils";
import { lookupNickname } from "@/lib/uidLookup";
import { createOrder, OrderError } from "@/lib/orderService";
import { verifyAndFulfil, type VerifyResult } from "@/lib/fulfil";
import {
  answerCallback, escapeHtml, isShopBotConfigured, sendMessage, sendPhoto, showMessage,
  type Keyboard,
} from "@/lib/telegramShop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const SESSION_TTL_MS = 30 * 60 * 1000;
const ZONE_ID_SLUGS = new Set(["mobile-legends"]); // games that need a text Zone/Server ID

const STATUS_LABEL: Record<string, string> = {
  PENDING: "⏳ រង់ចាំបង់ប្រាក់",
  PAID: "✅ បានបង់ — កំពុងរៀបចំ",
  PROCESSING: "⚙️ កំពុងដំណើរការ",
  DELIVERED: "🎉 បានដឹកជញ្ជូន",
  FAILED: "❌ បរាជ័យ",
  REFUNDED: "↩️ បានសង់ប្រាក់វិញ",
  CANCELLED: "🚫 បានលុបចោល",
};

// ───────────────────────── session helpers ─────────────────────────
type SessionData = { productId?: string; uid?: string; serverId?: string; nickname?: string | null };

async function getSession(chatId: string): Promise<{ step: string; data: SessionData }> {
  const row = await prisma.telegramSession.findUnique({ where: { chatId } });
  if (!row || Date.now() - row.updatedAt.getTime() > SESSION_TTL_MS) return { step: "idle", data: {} };
  try { return { step: row.step, data: JSON.parse(row.data) }; } catch { return { step: "idle", data: {} }; }
}
async function setSession(chatId: string, step: string, data: SessionData = {}) {
  await prisma.telegramSession.upsert({
    where: { chatId },
    update: { step, data: JSON.stringify(data) },
    create: { chatId, step, data: JSON.stringify(data) },
  });
}

// ───────────────────────── views ─────────────────────────
async function showMenu(chatId: string, messageId?: number) {
  const games = await prisma.game.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const st = await prisma.settings.findUnique({ where: { id: 1 } }).catch(() => null);
  const site = escapeHtml(st?.siteName || "TRATOPUP");
  const kb: Keyboard = games.map((g) => [{ text: `🎮 ${g.name}`, callback_data: `g:${g.slug}` }]);
  kb.push([{ text: "📦 ការបញ្ជាទិញរបស់ខ្ញុំ", callback_data: "o" }]);
  const text = games.length
    ? `👋 សូមស្វាគមន៍មកកាន់ <b>${site}</b>\nជ្រើសរើសហ្គេមដែលអ្នកចង់ Top Up៖`
    : `👋 សូមស្វាគមន៍មកកាន់ <b>${site}</b>\nមិនទាន់មានហ្គេមសម្រាប់លក់ទេ។`;
  await showMessage(chatId, messageId, text, kb);
}

async function showProducts(chatId: string, slug: string, messageId?: number) {
  const game = await prisma.game.findUnique({
    where: { slug },
    include: { products: { where: { active: true }, orderBy: [{ sortOrder: "asc" }, { priceUsd: "asc" }] } },
  });
  if (!game || !game.active) return showMenu(chatId, messageId);
  const kb: Keyboard = game.products.map((p) => [{ text: `${p.name} — ${formatUsd(p.priceUsd)}`, callback_data: `p:${p.id}` }]);
  kb.push([{ text: "⬅️ ត្រឡប់ក្រោយ", callback_data: "m" }]);
  await showMessage(chatId, messageId, `🎮 <b>${escapeHtml(game.name)}</b>\nជ្រើសរើសកញ្ចប់៖`, game.products.length ? kb : [[{ text: "⬅️ ត្រឡប់ក្រោយ", callback_data: "m" }]]);
}

async function startOrder(chatId: string, productId: string, messageId?: number) {
  const product = await prisma.product.findUnique({ where: { id: productId }, include: { game: true } });
  if (!product || !product.active || !product.game.active) return showMenu(chatId, messageId);
  await setSession(chatId, "uid", { productId });
  const g = product.game;
  await showMessage(
    chatId, messageId,
    `🛒 <b>${escapeHtml(g.name)}</b> — ${escapeHtml(product.name)} (${formatUsd(product.priceUsd)})\n\n` +
      `សូមផ្ញើ <b>${escapeHtml(g.uidLabel)}</b> របស់អ្នក` + (g.uidExample ? ` (ឧ. <code>${escapeHtml(g.uidExample)}</code>)` : "") + "៖",
    [[{ text: "❌ បោះបង់", callback_data: "x" }]],
  );
}

function parseServers(raw: string): string[] {
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
}

async function askConfirm(chatId: string, data: SessionData) {
  const product = await prisma.product.findUnique({ where: { id: data.productId! }, include: { game: true } });
  if (!product) return showMenu(chatId);
  let nickname: string | null = null;
  try { nickname = await lookupNickname(product.game.slug, data.uid!, data.serverId); } catch { /* optional */ }
  await setSession(chatId, "confirm", { ...data, nickname });
  await sendMessage(
    chatId,
    `🧾 <b>សូមពិនិត្យព័ត៌មាន</b>\n` +
      `ហ្គេម៖ ${escapeHtml(product.game.name)}\n` +
      `កញ្ចប់៖ ${escapeHtml(product.name)}\n` +
      `${escapeHtml(product.game.uidLabel)}៖ <code>${escapeHtml(data.uid!)}</code>${data.serverId ? ` (${escapeHtml(data.serverId)})` : ""}\n` +
      (nickname ? `ឈ្មោះក្នុងហ្គេម៖ <b>${escapeHtml(nickname)}</b>\n` : "") +
      `តម្លៃ៖ <b>${formatUsd(product.priceUsd)}</b>\n\n` +
      `ត្រូវប្រាកដថា ID ត្រឹមត្រូវ — Top Up រួចមិនអាចដកវិញបានទេ។`,
    [[{ text: "✅ បញ្ជាក់ & បង់ប្រាក់", callback_data: "ok" }], [{ text: "❌ បោះបង់", callback_data: "x" }]],
  );
}

function baseUrl(): string | null {
  const b = (process.env.NEXT_PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  return /^https:\/\//i.test(b) ? b : null;
}

async function placeOrder(chatId: string) {
  const s = await getSession(chatId);
  if (s.step !== "confirm" || !s.data.productId || !s.data.uid) {
    return sendMessage(chatId, "ការបញ្ជាទិញផុតកំណត់។ សូមចាប់ផ្ដើមម្ដងទៀត /start");
  }
  const product = await prisma.product.findUnique({ where: { id: s.data.productId } });
  if (!product) return showMenu(chatId);

  // Anti-spam: at most 3 unpaid orders per chat in the last 15 minutes.
  const recentPending = await prisma.order.count({
    where: { telegramChatId: chatId, status: "PENDING", createdAt: { gt: new Date(Date.now() - 15 * 60 * 1000) } },
  });
  if (recentPending >= 3) {
    await setSession(chatId, "idle");
    return sendMessage(chatId, "⚠️ អ្នកមានការបញ្ជាទិញមិនទាន់បង់ច្រើនពេក។ សូមបង់ ឬរង់ចាំ ១៥ នាទី។ /orders");
  }

  let created;
  try {
    created = await createOrder(
      {
        gameId: product.gameId,
        productId: product.id,
        playerUid: s.data.uid,
        serverId: s.data.serverId,
        playerNickname: s.data.nickname ?? undefined,
        telegramChatId: chatId,
      },
      { ipAddress: `tg:${chatId}`, userAgent: "telegram-shop-bot" },
    );
  } catch (err) {
    await setSession(chatId, "idle");
    if (err instanceof OrderError) return sendMessage(chatId, `⚠️ ${escapeHtml(err.message)}`);
    console.error("[tg] createOrder failed:", err);
    return sendMessage(chatId, "⚠️ មិនអាចបង្កើតការបញ្ជាទិញបានទេ សូមព្យាយាមម្ដងទៀតពេលក្រោយ។");
  }
  await setSession(chatId, "idle");

  const { order, game } = created;
  const caption =
    `🧾 <b>${escapeHtml(order.orderNumber)}</b>\n` +
    `${escapeHtml(game.name)} — ${escapeHtml(created.product.name)}\n` +
    `UID៖ <code>${escapeHtml(order.playerUid)}</code>${order.serverId ? ` (${escapeHtml(order.serverId)})` : ""}\n` +
    `ទឹកប្រាក់៖ <b>${formatUsd(order.amountUsd)}</b>\n\n` +
    `📲 ស្កេន KHQR ជាមួយកម្មវិធីធនាគារណាមួយ (ABA, ACLEDA, Wing, …)។ QR មានសុពលភាព ១០ នាទី។ ` +
    `ប្រព័ន្ធនឹងផ្ទៀងផ្ទាត់ដោយស្វ័យប្រវត្តិ ឬចុចប៊ូតុងខាងក្រោមបន្ទាប់ពីបង់។`;
  const kb: Keyboard = [[{ text: "✅ ខ្ញុំបានបង់ហើយ", callback_data: `v:${order.orderNumber}` }]];
  const web = baseUrl();
  if (web) kb.push([{ text: "🌐 បើកតាមគេហទំព័រ", url: `${web}/checkout/${order.orderNumber}` }]);

  try {
    const png = await QRCode.toBuffer(order.qrString!, { width: 640, margin: 2, errorCorrectionLevel: "M" });
    await sendPhoto(chatId, png, caption, kb);
  } catch (err) {
    console.error("[tg] QR send failed:", err);
    await sendMessage(chatId, caption + (web ? "" : "\n\n(មិនអាចបង្ហាញ QR បានទេ)"), kb);
  }

  // Best-effort auto-confirmation for ~50s after the response, so most people don't need to tap anything.
  const orderNumber = order.orderNumber;
  after(async () => {
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const r = await verifyAndFulfil(orderNumber);
        if (r.kind === "paid") { if (r.justClaimed) await announcePaid(chatId, orderNumber, r); return; }
        if (r.kind !== "pending") return; // expired / state / mismatch → stop; the button still works
      } catch (err) { console.warn("[tg] auto-poll error:", err); }
    }
  });
}

async function announcePaid(chatId: string, orderNumber: string, r: Extract<VerifyResult, { kind: "paid" }>) {
  const head = `✅ ទទួលបានការបង់ប្រាក់ <b>${escapeHtml(orderNumber)}</b>\n`;
  if (r.status === "DELIVERED") return sendMessage(chatId, head + "🎉 Top Up ជោគជ័យ! សូមអរគុណ។");
  if (r.status === "PROCESSING") return sendMessage(chatId, head + "⚙️ កំពុងដំណើរការ — អ្នកនឹងទទួលបានសារនៅពេលរួចរាល់។");
  return sendMessage(chatId, head + "👨‍💻 Admin កំពុងបញ្ចូលឲ្យអ្នក ហើយនឹងផ្ញើសារជូនដំណឹងនៅពេលរួចរាល់។");
}

async function checkPayment(chatId: string, cbId: string, orderNumber: string) {
  const owned = await prisma.order.findFirst({ where: { orderNumber, telegramChatId: chatId }, select: { id: true } });
  if (!owned) return answerCallback(cbId, "រកមិនឃើញការបញ្ជាទិញនេះទេ", true);
  const r = await verifyAndFulfil(orderNumber);
  switch (r.kind) {
    case "pending": return answerCallback(cbId, "មិនទាន់ឃើញការបង់ប្រាក់ទេ។ សូមរង់ចាំបន្តិចហើយសាកម្ដងទៀត។", true);
    case "expired":
      await answerCallback(cbId);
      return sendMessage(chatId, `⌛ QR របស់ <b>${escapeHtml(orderNumber)}</b> ផុតកំណត់ហើយ។ បើមិនទាន់បានបង់ សូមបង្កើតការបញ្ជាទិញថ្មី។`, [[{ text: "🛒 ចាប់ផ្ដើមថ្មី", callback_data: "m" }]]);
    case "mismatch": return answerCallback(cbId, "ចំនួនទឹកប្រាក់ ឬគណនីមិនត្រូវគ្នា។ សូមទាក់ទង Admin។", true);
    case "paid":
      await answerCallback(cbId);
      if (r.justClaimed) return announcePaid(chatId, orderNumber, r);
      return sendMessage(chatId, `${STATUS_LABEL[r.status]} — <b>${escapeHtml(orderNumber)}</b>`);
    case "state":
      await answerCallback(cbId);
      return sendMessage(chatId, `${STATUS_LABEL[r.status] ?? r.status} — <b>${escapeHtml(orderNumber)}</b>`);
    default: return answerCallback(cbId, "មានបញ្ហា សូមសាកម្ដងទៀត", true);
  }
}

async function listOrders(chatId: string, messageId?: number) {
  const orders = await prisma.order.findMany({
    where: { telegramChatId: chatId },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { game: { select: { name: true } }, product: { select: { name: true } } },
  });
  if (!orders.length) return showMessage(chatId, messageId, "អ្នកមិនទាន់មានការបញ្ជាទិញទេ។", [[{ text: "🛒 ទិញឥឡូវ", callback_data: "m" }]]);
  const kb: Keyboard = [];
  const lines = orders.map((o) => {
    if (o.status === "PENDING" && (!o.paymentExpiresAt || o.paymentExpiresAt.getTime() > Date.now())) {
      kb.push([{ text: `🔄 ពិនិត្យការបង់ប្រាក់ ${o.orderNumber}`, callback_data: `v:${o.orderNumber}` }]);
    }
    return `<b>${escapeHtml(o.orderNumber)}</b> — ${escapeHtml(o.game.name)} ${escapeHtml(o.product.name)}\n${STATUS_LABEL[o.status] ?? o.status} · ${formatUsd(o.amountUsd)}`;
  });
  kb.push([{ text: "🏠 ម៉ឺនុយ", callback_data: "m" }]);
  await showMessage(chatId, messageId, `📦 <b>ការបញ្ជាទិញចុងក្រោយ</b>\n\n${lines.join("\n\n")}`, kb);
}

// ───────────────────────── update handlers ─────────────────────────
async function onText(chatId: string, text: string) {
  const cmd = text.split(/[\s@]/)[0].toLowerCase();
  if (cmd === "/start" || cmd === "/games" || cmd === "/menu") { await setSession(chatId, "idle"); return showMenu(chatId); }
  if (cmd === "/orders") return listOrders(chatId);
  if (cmd === "/cancel") { await setSession(chatId, "idle"); return showMenu(chatId); }
  if (cmd === "/help") {
    const st = await prisma.settings.findUnique({ where: { id: 1 } });
    return sendMessage(chatId, `ℹ️ /start ម៉ឺនុយ · /orders ការបញ្ជាទិញ · /cancel បោះបង់` + (st?.supportTelegram ? `\n💬 ជំនួយ៖ ${escapeHtml(st.supportTelegram)}` : ""));
  }

  const s = await getSession(chatId);
  if (s.step === "uid" && s.data.productId) {
    const uid = text.trim();
    if (!isValidUid(uid)) return sendMessage(chatId, "⚠️ ID មិនត្រឹមត្រូវ (ត្រូវជាលេខ ៥–២០ ខ្ទង់)។ សូមផ្ញើម្ដងទៀត។");
    const product = await prisma.product.findUnique({ where: { id: s.data.productId }, include: { game: true } });
    if (!product) return showMenu(chatId);
    const g = product.game;
    const servers = parseServers(g.servers);
    if (ZONE_ID_SLUGS.has(g.slug)) {
      await setSession(chatId, "server", { ...s.data, uid });
      return sendMessage(chatId, "សូមផ្ញើ <b>Zone ID</b> (លេខក្នុងវង់ក្រចក ឧ. 1234)៖", [[{ text: "❌ បោះបង់", callback_data: "x" }]]);
    }
    if (g.requiresServer) {
      await setSession(chatId, "server", { ...s.data, uid });
      if (servers.length) {
        return sendMessage(chatId, "ជ្រើសរើស Server៖", [
          ...servers.map((sv, i) => [{ text: sv, callback_data: `s:${i}` }]),
          [{ text: "❌ បោះបង់", callback_data: "x" }],
        ]);
      }
      return sendMessage(chatId, "សូមផ្ញើ Server ID៖", [[{ text: "❌ បោះបង់", callback_data: "x" }]]);
    }
    return askConfirm(chatId, { ...s.data, uid });
  }
  if (s.step === "server" && s.data.productId && s.data.uid) {
    const sid = text.trim();
    if (!isValidServerId(sid)) return sendMessage(chatId, "⚠️ Zone/Server ID មិនត្រឹមត្រូវ (លេខ ១–៥ ខ្ទង់)។ សូមផ្ញើម្ដងទៀត។");
    return askConfirm(chatId, { ...s.data, serverId: sid });
  }
  return showMenu(chatId);
}

async function onCallback(chatId: string, messageId: number | undefined, cbId: string, data: string) {
  const colon = data.indexOf(":");
  const kind = colon === -1 ? data : data.slice(0, colon);
  const arg = colon === -1 ? "" : data.slice(colon + 1);
  if (kind === "v") return checkPayment(chatId, cbId, arg.toUpperCase());
  await answerCallback(cbId);
  switch (kind) {
    case "m": await setSession(chatId, "idle"); return showMenu(chatId, messageId);
    case "x": await setSession(chatId, "idle"); return showMenu(chatId, messageId);
    case "o": return listOrders(chatId, messageId);
    case "g": return showProducts(chatId, arg, messageId);
    case "p": return startOrder(chatId, arg, messageId);
    case "ok": return placeOrder(chatId);
    case "s": {
      const s = await getSession(chatId);
      if (s.step !== "server" || !s.data.productId) return showMenu(chatId, messageId);
      const product = await prisma.product.findUnique({ where: { id: s.data.productId }, include: { game: true } });
      const sv = parseServers(product?.game.servers ?? "[]")[Number(arg)];
      if (!sv) return showMenu(chatId, messageId);
      return askConfirm(chatId, { ...s.data, serverId: sv });
    }
  }
}

function secretOk(req: NextRequest): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const got = req.headers.get("x-telegram-bot-api-secret-token") || "";
  if (!expected || expected.length < 16) return false;
  const a = Buffer.from(got), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!isShopBotConfigured()) return NextResponse.json({ error: "Bot not configured" }, { status: 503 });
  if (!secretOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const update = await req.json();
    const msg = update?.message;
    const cb = update?.callback_query;
    const chat = msg?.chat ?? cb?.message?.chat;
    if (!chat || chat.type !== "private") return NextResponse.json({ ok: true });
    const chatId = String(chat.id);

    if (!(await checkRateLimit(`tg:${chatId}`, 40, 60_000))) return NextResponse.json({ ok: true });

    if (typeof msg?.text === "string") await onText(chatId, msg.text.slice(0, 200));
    else if (cb?.data && typeof cb.data === "string") await onCallback(chatId, cb.message?.message_id, String(cb.id), cb.data.slice(0, 64));
  } catch (err) {
    // Always 200 so Telegram doesn't retry-storm; the error is in the Vercel logs.
    console.error("[tg] webhook error:", err);
  }
  return NextResponse.json({ ok: true });
}
