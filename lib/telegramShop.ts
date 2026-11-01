import { escapeHtml } from "@/lib/telegram";

/** Low-level helpers for the customer-facing Telegram shop bot (TELEGRAM_SHOP_BOT_TOKEN). */

export type InlineButton = { text: string; callback_data?: string; url?: string };
export type Keyboard = InlineButton[][];

function token(): string {
  const t = process.env.TELEGRAM_SHOP_BOT_TOKEN?.trim();
  if (!t) throw new Error("TELEGRAM_SHOP_BOT_TOKEN is not configured");
  return t;
}

export function isShopBotConfigured(): boolean {
  return !!process.env.TELEGRAM_SHOP_BOT_TOKEN?.trim();
}

async function call(method: string, payload: Record<string, unknown>): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    throw new Error(`Telegram ${method} failed: ${res.status} ${json?.description || ""}`);
  }
  return json.result;
}

export function sendMessage(chatId: string, text: string, keyboard?: Keyboard) {
  return call("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

/** Edit the message the user just tapped; if Telegram refuses (too old / unchanged) send a fresh one. */
export async function showMessage(chatId: string, messageId: number | undefined, text: string, keyboard?: Keyboard) {
  if (messageId) {
    try {
      await call("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: keyboard ?? [] },
      });
      return;
    } catch {
      /* fall through */
    }
  }
  await sendMessage(chatId, text, keyboard);
}

export function answerCallback(id: string, text?: string, alert = false) {
  return call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text, show_alert: alert } : {}) }).catch(() => {});
}

export async function sendPhoto(chatId: string, png: Buffer, caption: string, keyboard?: Keyboard) {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("photo", new Blob([new Uint8Array(png)], { type: "image/png" }), "khqr.png");
  form.append("caption", caption);
  form.append("parse_mode", "HTML");
  if (keyboard) form.append("reply_markup", JSON.stringify({ inline_keyboard: keyboard }));
  const res = await fetch(`https://api.telegram.org/bot${token()}/sendPhoto`, {
    method: "POST",
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(`Telegram sendPhoto failed: ${res.status} ${json?.description || ""}`);
}

/** Message a customer from server code (e.g. when admin marks an order delivered). Never throws. */
export async function notifyCustomer(chatId: string | null | undefined, text: string): Promise<void> {
  if (!chatId || !isShopBotConfigured()) return;
  try {
    await sendMessage(chatId, text);
  } catch (err) {
    console.warn("[telegram-shop] notifyCustomer failed:", err);
  }
}

export { escapeHtml };
