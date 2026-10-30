# TRATOPUP runtime upgrade notes

Prepared for the current stable framework line:

- Node.js 24 LTS
- Next.js 16.4.3
- React / React DOM 19.3.1
- ESLint 9 flat configuration
- Updated Next.js external package configuration for PDFKit

## Install and validate

```bash
npm install
npx prisma generate
npm run lint
npm run build
```

The dependency lockfile is not included because this environment could not reach the npm registry to resolve a fresh lockfile. Generate it with `npm install` in an environment with registry access and commit the resulting `package-lock.json`.

Next.js major upgrades can surface async request API and route type errors. Resolve all build/lint errors before deploying; this archive has not been built against the upgraded dependencies in this environment.

Do not place Bakong API tokens or other secrets in client-side code. Configure them through deployment environment variables.
