# Running unmarked. on Cloudflare (free plan)

Cloudflare is the only place this project runs: one Worker, a D1 database (`DB`) and an R2 bucket (`BUCKET`),
configured in `wrangler.jsonc`. Commands run from the project root.

## Commands
| Command | What it does |
|---|---|
| `npm run dev` | Builds, then runs the Worker locally at http://localhost:8787 on Cloudflare's local runtime. Local D1 and R2 live in the git-ignored `.wrangler/` folder and never touch live data. |
| `npm run db:local` | Applies the migrations to the local database (run once, answer `y`). |
| `npm run db:remote` | Applies new migrations to the **live** database. |
| `npm run deploy` | Builds and deploys to the live site. |
| `npm run reports` | Lists reported assessments from the live database. |

Set `WRANGLER_SEND_METRICS=false` to turn off Wrangler's telemetry.

## First-time setup
1. Create a free Cloudflare account. In the dashboard open **R2 Object Storage** and enable it (a payment card is
   required on file; the free allowance is not charged).
2. Log in from the terminal: `npx wrangler login` (opens the browser).
3. Create the database: `npx wrangler d1 create blank`, then put the printed `database_id` in `wrangler.jsonc`.
4. Create the bucket: `npx wrangler r2 bucket create blank-assessments`.
5. `npm run db:remote`, then `npm run deploy`. The first deploy asks you to pick a `workers.dev` name and prints the live address.

Live now: https://blank.crowdmark.workers.dev

**Shipping a change:** if it added a file under `drizzle/`, run `npm run db:remote` first, then `npm run deploy`.
Migrations in the repo that are not yet on the live database: check `npx wrangler d1 migrations list blank --remote`.

Secrets are set with `npx wrangler secret put NAME`. Never commit them or put them in `wrangler.jsonc`.

## Admin tasks (there are no accounts or editor screens)
- **Read problem reports:** `npm run reports` shows each reported assessment with its id, the reason and how many reports.
- **Remove an assessment** (for example one that contains student work). Hiding it keeps its fingerprint, so converting
  the same PDF again will not re-publish it:
  ```sh
  npx wrangler d1 execute blank --remote --command "UPDATE exam_bank SET status = 'rejected' WHERE id = '<id>'"
  npx wrangler r2 object delete blank-assessments/exams/<id>.pdf --remote
  ```
- **Find an id:** `npx wrangler d1 execute blank --remote --command "SELECT id, course, term, assessment, assessment_number FROM exam_bank WHERE course = 'MATH137'"`.

## Staying inside the free plan
- Publishing pauses (conversions return a clear error and a `LIMIT_REACHED` line is logged) when stored pages reach
  `MAX_STORED_PAGES` (default 30000, about 4 GB) or new assessments in the last 24 hours reach `MAX_DAILY_PUBLISHES`
  (default 300). `MAX_DAILY_SYNC_PROFILES` (default 500) caps new sync codes per day. All are set under `vars` in
  `wrangler.jsonc`; change them and run `npm run deploy`.
- Workers and D1 stop answering at their free limits instead of billing. R2 is the one service that can bill past its
  10 GB free storage, which the page cap keeps well clear of.
- To be told about it: add a usage or billing notification in the Cloudflare dashboard, and look for `LIMIT_REACHED`
  in Workers > blank > Logs. There is no email alert from the app.

## Abuse protection: rate limits and Turnstile
The public write endpoints (`/api/export`, `/api/bank/report`, `POST /api/sync`) only accept requests whose `Origin` is the
site itself. A script can fake that header, so they are also guarded by per-IP rate limits and, for Prepare PDF and Report a
problem, Cloudflare Turnstile.

### Rate limits
| Endpoint | Limit per IP | Setting in `wrangler.jsonc` |
|---|---|---|
| Prepare PDF (`/api/export`) | 20 per hour | `RATE_EXPORT_PER_HOUR` |
| Report a problem (`/api/bank/report`) | 10 per hour | `RATE_REPORT_PER_HOUR` |
| Turn on sync (`POST /api/sync`) | 5 per hour | `RATE_SYNC_CREATE_PER_HOUR` |

- Over the limit the Worker answers **429** with a `Retry-After` header and a plain message. For `/api/export` the check
  happens before anything is requested from Crowdmark.
- Limits are fixed one-hour windows on the clock hour, so a caller can briefly get up to twice the limit across an hour
  boundary. A setting of `0` turns that limit off. Reading and saving synced lists is not limited.
- Counters live in the D1 table `rate_limits` (migration `0006`). Only a keyed hash of `CF-Connecting-IP` is stored, never
  the address, and the hash differs for every endpoint and hour. For stronger protection against guessing, set a secret salt:
  `npx wrangler secret put RATE_LIMIT_SALT` (any long random string, for example `openssl rand -hex 32`).
- The Workers Rate Limiting binding was not used because it only supports 10 or 60 second periods, not hourly ones.
- If the table is missing or D1 errors, requests are allowed and `Rate limit check failed` is logged. Apply migration `0006`
  first, then deploy.
- Try it locally with a lowered limit: `npm run build && npx wrangler dev --local --var RATE_REPORT_PER_HOUR:3`.

**Status: Turnstile is currently OFF.** `TURNSTILE_SITE_KEY` in `wrangler.jsonc` is empty and there is no `TURNSTILE_SECRET`, so no widget
loads and nothing is verified. Only the rate limits and hard caps protect the public endpoints. A widget named `blank` still
exists in the Cloudflare dashboard, but its allowed hostname is still the old `blank.crowdmark-clean-copy.workers.dev` (edit the widget and
add `blank.crowdmark.workers.dev` before turning it on); its public site key was
`0x4AAAAAAGOiu9HvHz0Tdog-`. To turn Turnstile back on, follow the steps below, using that widget (rotate its secret first,
because it was shown on screen when the widget was created). Set the site key and deploy first, then set the secret,
never the other way round.

### Turnstile setup (do these in order)
1. **Apply the migration:** `npm run db:remote`.
2. **Create the widget** in the Cloudflare dashboard: **Turnstile → Add widget**. Name it `blank`. Add the hostname(s) the
   site is served from (`blank.crowdmark.workers.dev`, plus your own domain later). Widget mode **Managed**. Create it,
   then copy the **Site Key** and the **Secret Key**.
3. **Site key (public):** put it in `wrangler.jsonc` as `vars.TURNSTILE_SITE_KEY`. It is safe to commit.
4. **Secret key (private):** `npx wrangler secret put TURNSTILE_SECRET` and paste it when asked. Never put it in a file.
5. `npm run deploy`.

Behaviour:
- The widget runs only when the Prepare PDF or Report button is used, stays invisible unless Cloudflare wants more proof, and
  its token is checked on the server (and only once) before Crowdmark is contacted.
- **No secret set:** verification is skipped. That is how `npm run dev` works without any Cloudflare setup. If the secret is
  set but `TURNSTILE_SITE_KEY` is empty, every export and report is refused, so set both.
- The page's Content-Security-Policy allows `challenges.cloudflare.com` only when a site key is set.
