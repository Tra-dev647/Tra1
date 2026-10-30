# TRATOPUP — Bakong USD + Khmer Topup API

This archive has server-side integration code for:
- Dynamic KHQR generation using the official `bakong-khqr` npm SDK.
- Bakong Open API transaction verification by MD5.
- Khmer Topup reseller catalog and Mobile Legends account-check endpoints.
- USD-only storefront display.

## Environment variables
Copy `.env.example` to `.env.local` for local development, then fill the values yourself. Do not upload `.env.local` to GitHub. The uploaded `Flie.env` was intentionally NOT copied into this ZIP because it contains credentials.

Required:
- `DATABASE_URL`
- `JWT_SECRET`
- `BAKONG_API_TOKEN`
- `BAKONG_ACCOUNT_ID`
- `KHMER_TOPUP_API_KEY`

## Install / run

```bash
npm install
npx prisma generate
npx prisma db push
npm run db:seed
npm run dev
```

## API routes added
- `GET /api/reseller/catalog` — current Mobile Legends packages and reseller prices.
- `GET /api/reseller/check?player_id=...&server_id=...` — verify MLBB ID.
- `POST /api/payment/verify` with `{ "orderNumber": "..." }` — checks the QR MD5 against Bakong and checks USD amount + receiver account before marking an order paid.

Order creation now generates a fixed-amount USD KHQR on the server. The Bakong token and Khmer Topup key are never sent to the browser.

## Important before real sales
1. The Khmer Topup package is submitted only when the local product name exactly matches a live provider package name. If it does not match, the order remains PAID for admin/manual review; it will not guess a package ID.
2. Review and map your local MLBB products to the live `/api/v1/games` package names and prices before enabling automatic fulfilment. Your current seed data is demo data and does not match every provider catalogue.
3. Test using a small transaction first. Confirm your Bakong account is approved for dynamic USD KHQR.
4. This archive has not been deployed or verified against your live credentials. Run `npm run build` and test the Bakong sandbox/live account before taking payments.
5. Rotate credentials previously shared in chat, then enter the new values in Vercel → Settings → Environment Variables.

## Vercel
Set the same variables in Vercel Project → Settings → Environment Variables for Production, Preview and Development. Keep `PAYMENT_SIMULATION_MODE=false`. Run Prisma schema setup against Neon from a trusted local environment, then redeploy.


## Khmer Topup live catalogue (TRATOPUP)

1. Set `KHMER_TOPUP_API_URL=https://khmer-topup.com/api/v1` and `KHMER_TOPUP_API_KEY` in Vercel Environment Variables. Keep the key server-side; never use a `NEXT_PUBLIC_` variable for it.
2. Deploy the project, then run `npx prisma db push` (or the project's database schema deployment step) so `Product.providerPackageId` and `Product.providerCostUsd` exist in Neon.
3. Sign in to the admin dashboard, then send an authenticated `POST` request to `/api/admin/reseller/sync`. This imports the live `mobile-legends` packages and exact provider package IDs. Old unmatched Mobile Legends demo products are deactivated.
4. Set each retail `priceUsd` above its `providerCostUsd` in Admin → Products. Sync preserves existing retail prices and refreshes provider costs.
5. Test with a small-value order. The server verifies the MLBB User ID + Zone ID before creating a Bakong QR. After Bakong payment is confirmed, the server submits the exact provider `package_id` using the TRATOPUP order number as an idempotency reference. Checkout verification polls Khmer Topup until `completed` or `refunded`.

API endpoints used: `GET /me`, `GET /games`, `GET /check`, `POST /orders`, and `GET /orders/{order_code}`. API calls run only on the server. A Khmer Topup `unknown` account-check result is not treated as an invalid ID; the provider may still accept or automatically refund the order.
