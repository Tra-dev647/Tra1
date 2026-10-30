# TRATOPUP × Khmer Topup setup (Khmer)

## 1) Vercel Environment Variables

ដាក់ក្នុង Vercel → Project → Settings → Environment Variables:

- `KHMER_TOPUP_API_URL` = `https://khmer-topup.com/api/v1`
- `KHMER_TOPUP_API_KEY` = API Key របស់អ្នកពី Khmer Topup (រក្សាជា Secret; កុំដាក់ `NEXT_PUBLIC_`)
- `DATABASE_URL` = Neon PostgreSQL connection string
- `JWT_SECRET` = secret យ៉ាងតិច 32 តួអក្សរ
- កំណត់ Bakong variables ផ្សេងៗតាម `.env.example`

## 2) Apply database schema

បន្ទាប់ពីកែ code និង deploy សូម run ក្នុង terminal ដែលមាន project:

```bash
npx prisma db push
npx prisma generate
```

Build script ក៏រត់ `prisma generate` ដោយស្វ័យប្រវត្តិផងដែរ។

## 3) Sync live Mobile Legends catalogue

ចូល Admin របស់ TRATOPUP ជាមុនសិន។ បន្ទាប់មកហៅ authenticated endpoint:

```bash
curl -X POST https://YOUR-DOMAIN/api/admin/reseller/sync \
  -H 'Cookie: YOUR_ADMIN_SESSION_COOKIE'
```

Endpoint នេះទាញ `GET /games` ពី Khmer Topup, រក `mobile-legends`, រក្សាទុក package ID ពិត និង reseller cost។ Package demo ដែលមិនមានក្នុង catalogue ថ្មី នឹងត្រូវបិទ។ Retail price ដែលបានកំណត់រួចត្រូវបានរក្សាទុក។

## 4) Retail price

ក្នុង Admin → Products សូមកំណត់ `priceUsd` ឱ្យខ្ពស់ជាង `providerCostUsd` ដើម្បីមានចំណេញ។ ប្រព័ន្ធនឹងបដិសេធការបញ្ជាទិញ ប្រសិនបើ retail price ទាបជាង reseller cost។ Sync លើកក្រោយនឹងធ្វើបច្ចុប្បន្នភាព cost តែមិនសរសេរជាន់ retail price ទេ។

## 5) Order flow

- ពិនិត្យ User ID + Zone ID តាម Khmer Topup មុនបង្កើត KHQR។
- បន្ទាប់ពី Bakong បញ្ជាក់ការទូទាត់ ទើបបញ្ជូន `package_id` ពិតទៅ `POST /orders`។
- `reference` ប្រើ TRATOPUP order number ដើម្បីការពារការកាត់ wallet ពីរដងពេល retry។
- Checkout ពិនិត្យ `GET /orders/{order_code}` រហូតដល់ `completed` ឬ `refunded`។

## Important

កុំដាក់ API key ក្នុង browser ឬ commit `.env.local` ទៅ GitHub។ សាកល្បងជាមួយ package តម្លៃទាបជាមុន ហើយពិនិត្យ Khmer Topup wallet balance (`GET /me`)។

## តម្លៃលក់រាយកញ្ចប់ពេជ្រ

Sync Catalog ទាញយក `package_id`, `name`, និង `price` ពី Khmer Topup ផ្ទាល់។ តម្លៃលក់លើ TRATOPUP គឺតម្លៃ Reseller បូក markup ដែលកំណត់នៅ Vercel៖

```env
KHMER_TOPUP_RETAIL_MARKUP_USD=0.15
```

ឧទាហរណ៍ តម្លៃ Reseller $0.78 + markup $0.15 = តម្លៃលក់ $0.93។ កែ markup តាមគោលការណ៍ហាង រួច Deploy និង Sync Catalog ម្តងទៀត។ កញ្ចប់ដែលលែងមានក្នុង catalog នឹងត្រូវបិទ ខណៈប្រវត្តិ Order ចាស់នៅដដែល។
