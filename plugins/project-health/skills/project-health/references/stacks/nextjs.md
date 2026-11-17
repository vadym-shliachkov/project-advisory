# Stack pack: Next.js

## Where to look

- Routing: `app/` (App Router) or `pages/` (Pages Router); `next.config.*`; `middleware.*`.
- Metadata: `export const metadata` or `generateMetadata` (App Router), `next/head` (Pages Router); `app/sitemap.*` and `app/robots.*`.
- Images: `next/image` versus raw `<img>` elements.
- Environment: `.env*` files. Variables prefixed `NEXT_PUBLIC_` are shipped to the browser.

## Area notes

- security: secrets in `NEXT_PUBLIC_*` variables are public (`security.secret-in-repo`); check the Next.js version against known advisories (`security.vulnerable-dependencies`).
- seo: pages without metadata (`seo.missing-title`, `seo.missing-meta-description`); primary content rendered only in client components (`seo.client-rendered-content`); no sitemap or robots route (`seo.missing-sitemap`).
- performance: `"use client"` at layout level makes large client bundles (`performance.large-bundles`); third-party scripts loaded without `next/script` (`performance.heavy-third-parties`); raw `<img>` instead of `next/image` (`performance.oversized-images`).
- architecture: mixed App and Pages routers, or data fetched in client components where server rendering would remove loading states (`architecture.framework-mismatch`).
- hosting: Vercel (`vercel.json`) or self-hosted (`output: 'standalone'`, Dockerfile); preview deployments as staging (`hosting.no-staging`).
- code-quality: ESLint config and TypeScript `strict` mode (`code-quality.no-linting`, `code-quality.no-type-safety`).
