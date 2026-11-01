# TRATOPUP — Deploy to Vercel + Neon

## 1. Neon database
Create a project at https://neon.tech (region: Singapore) and copy the connection string.

## 2. Push to GitHub
```bash
git add -A && git commit -m "update" && git push
```

## 3. Install new packages (once, regenerates package-lock.json)
```bash
npm install @vercel/blob qrcode
npm install -D @types/qrcode
```
Commit `package.json` and `package-lock.json`. Vercel's `npm ci` fails if the lockfile is out of sync.

## 4. Create the database tables and admin (run locally / Termux)
Create a temporary `.env` (never commit it):
```
DATABASE_URL="<neon connection string>"
JWT_SECRET="<random, 32+ chars>"
ADMIN_EMAIL="you@example.com"
ADMIN_PASSWORD="<12+ chars, strong>"
```
```bash
npx prisma db push
npm run db:seed
```

## 5. Vercel project → Environment Variables
| Name | Notes |
|---|---|
| `DATABASE_URL` | Neon string |
| `JWT_SECRET` | same random 32+ char secret |
| `BAKONG_API_TOKEN`, `BAKONG_ACCOUNT_ID`, `BAKONG_MERCHANT_NAME`, `MERCHANT_CITY` | Bakong KHQR |
| `KHMER_TOPUP_API_KEY` (+ optional `KHMER_TOPUP_API_URL`) | reseller API |
| `PAYMENT_SIMULATION_MODE` | **`false` in production** (`true` lets anyone mark orders as paid) |
| `NEXT_PUBLIC_BASE_URL` | your live URL |
| `BLOB_READ_WRITE_TOKEN` | Vercel → Storage → Create Blob store → connect to project |
| `TELEGRAM_SHOP_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | Telegram shop bot (see below) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | free Redis at https://upstash.com (shared rate limiting) |

`ADMIN_EMAIL` / `ADMIN_PASSWORD` are only needed for seeding; they don't have to be set on Vercel.

## 6. Deploy
Push to GitHub; Vercel builds automatically. Admin login: `/admin/login`.

## Telegram shop bot
1. Create a bot with @BotFather → copy the token → set `TELEGRAM_SHOP_BOT_TOKEN` and a random `TELEGRAM_WEBHOOK_SECRET` (16+ chars) on Vercel, then redeploy.
2. Create the new tables: `npx prisma db push` (adds `Order.telegramChatId` and `TelegramSession`).
3. Register the webhook (from Termux, with the same two values in your shell):
```bash
export TELEGRAM_SHOP_BOT_TOKEN="..." TELEGRAM_WEBHOOK_SECRET="..."
npm run tg:webhook -- set https://YOUR-APP.vercel.app
npm run tg:webhook -- info     # check: url set, no last_error_message
```
4. Open your bot → `/start`.
- Admin notifications (new PAID order needing manual top-up) use the *separate* bot token + chat id in Admin → Settings.
- Banning a Telegram user: Admin → Banlist → type `ip`, value `tg:<their chat id>` (the chat id is stored in the order's IP field).

## Security checklist
- All `/api/admin/*` routes require the admin session cookie (middleware + `adminGuard()` in each handler). New admin routes MUST call `adminGuard()`.
- Rotate any token that was ever exposed (Telegram bot token, Bakong token, reseller key).
- Never commit `.env*`.
