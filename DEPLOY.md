# Deploying to Cloudflare (free plan)

One-time setup. Commands run from the project root.

1. Create a free Cloudflare account. In the dashboard open **R2 Object Storage** and enable it (a payment card is
   required on file; the free allowance is not charged).
2. Log in from the terminal: `npx wrangler login` (opens the browser).
3. Create the database: `npx wrangler d1 create blank`, then put the printed `database_id` in `wrangler.jsonc`.
4. Create the bucket: `npx wrangler r2 bucket create blank-assessments`.
5. Apply the database migrations: `npm run cf:db:remote`.
6. Deploy: `npm run deploy`. The first deploy asks you to pick a `workers.dev` name and prints the live address.

Later deploys are just `npm run deploy`. New migrations: add a file under `drizzle/` and run `npm run cf:db:remote`.

Local test under Cloudflare's runtime: `npm run cf:db:local` once, then `npm run cf:dev` (http://127.0.0.1:8787).
Local data lives in the git-ignored `.wrangler/` folder. Set `WRANGLER_SEND_METRICS=false` to turn off Wrangler telemetry.

Secrets (for example `RESEND_API_KEY` when sign-in is added) are set with `npx wrangler secret put NAME`.
Never commit them or put them in `wrangler.jsonc`.

## Staying inside the free plan
- Publishing pauses (conversions return a clear error and a `LIMIT_REACHED` line is logged) when stored pages reach
  `MAX_STORED_PAGES` (default 30000, about 4 GB) or new assessments in the last 24 hours reach `MAX_DAILY_PUBLISHES`
  (default 300). Both are set under `vars` in `wrangler.jsonc`; change them and run `npm run deploy`.
- Workers and D1 stop answering at their free limits instead of billing. R2 is the one service that can bill past its
  10 GB free storage, which the page cap keeps well clear of.
- To be told about it: in the Cloudflare dashboard add a usage or billing notification, and look for `LIMIT_REACHED`
  in Workers > blank > Logs. Reading the logs is the only built-in signal; there is no email alert from the app.

## Uploading your local assessments to the live site
`npm run cf:push-local` shows what would be uploaded from `.local/` (the local database and PDFs) and changes nothing.
`npm run cf:push-local -- --yes` uploads the PDFs to R2 first and then the database rows to D1. It skips anything already
live (same id or same PDF contents) and anything whose PDF is missing or not a real PDF, so it is safe to run again.
Uploaded assessments become public.

## Sync
Sync needs migration `0005_sync_profiles.sql`, so after pulling this change run `npm run cf:db:remote` before `npm run deploy`.
`MAX_DAILY_SYNC_PROFILES` in `wrangler.jsonc` caps how many new sync codes can be created per day.
