// Usage (Termux/any shell):
//   TELEGRAM_SHOP_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/telegram-webhook.mjs set https://YOUR-APP.vercel.app
//   TELEGRAM_SHOP_BOT_TOKEN=... node scripts/telegram-webhook.mjs info
//   TELEGRAM_SHOP_BOT_TOKEN=... node scripts/telegram-webhook.mjs delete
const [cmd = "info", baseUrl] = process.argv.slice(2);
const token = process.env.TELEGRAM_SHOP_BOT_TOKEN;
if (!token) { console.error("Set TELEGRAM_SHOP_BOT_TOKEN"); process.exit(1); }
const api = (m, body) => fetch(`https://api.telegram.org/bot${token}/${m}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}),
}).then((r) => r.json());

if (cmd === "set") {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!baseUrl?.startsWith("https://")) { console.error("Give your https:// site URL"); process.exit(1); }
  if (!secret || secret.length < 16 || !/^[A-Za-z0-9_-]+$/.test(secret)) { console.error("TELEGRAM_WEBHOOK_SECRET: 16+ chars of A-Z a-z 0-9 _ -"); process.exit(1); }
  console.log(await api("setWebhook", {
    url: `${baseUrl.replace(/\/$/, "")}/api/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  }));
  console.log(await api("setMyCommands", { commands: [
    { command: "start", description: "ម៉ឺនុយ / Menu" },
    { command: "orders", description: "ការបញ្ជាទិញរបស់ខ្ញុំ" },
    { command: "cancel", description: "បោះបង់" },
    { command: "help", description: "ជំនួយ" },
  ] }));
} else if (cmd === "delete") {
  console.log(await api("deleteWebhook", { drop_pending_updates: true }));
} else {
  console.log(JSON.stringify(await api("getWebhookInfo"), null, 2));
}
