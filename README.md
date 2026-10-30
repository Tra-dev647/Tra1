# TRATOPUP

TRATOPUP is a Next.js + Prisma game top-up storefront configured for Mobile Legends, USD-only display, Bakong KHQR payment verification, and Khmer Topup reseller API integration.

Read **[INTEGRATION-README-KM.md](./INTEGRATION-README-KM.md)** for setup and deployment notes.

## Quick start

```bash
cp .env.example .env.local
# Fill the environment variables in .env.local
npm install
npx prisma generate
npx prisma db push
npm run db:seed
npm run dev
```

Never commit `.env.local` or share API tokens/passwords. Use fresh rotated credentials in Vercel Environment Variables.
