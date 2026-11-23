# blank.

[Open blank.](https://blank.crowdmark.workers.dev/) · [Deployment guide](./DEPLOY.md)

**blank.** turns shareable Crowdmark results links into blank assessment PDFs and maintains a searchable Waterloo Assessment Bank.

## What you can do

- **Convert a Crowdmark assessment.** Paste a shareable results link, then select **Prepare PDF**. You can paste multiple links and download the resulting PDFs in one ZIP.
- **Browse the Assessment Bank.** Search by course code, filter assessments, and preview or download PDFs. The bank is public and requires no account.
- **Organize practice material.** Save assessments to lists, share a read-only list link, or use a private sync code to access your lists on another device.
- **Report a problem.** Use the menu on an assessment row to flag incorrect details, student work, or another issue.

## What gets shared

blank. rebuilds the PDF from the original blank booklet pages available in Crowdmark. It keeps the rebuilt PDF and assessment details without saving the results link, grades, or student answers. Conversion depends on Crowdmark providing those original blank pages.

When blank. can identify the course, term, and assessment type, **Prepare PDF** adds the blank copy to the public bank. You can still preview and download a converted PDF when those details are unknown. Only convert assessments you have permission to share.

## Run locally

Use Node.js 22.12 or later and npm.

```sh
git clone https://github.com/Evan-Lowry/blank.git
cd blank
npm ci
npm run db:local
npm run dev
```

Open [http://localhost:8787](http://localhost:8787). Apply local migrations when setting up a fresh checkout or after schema changes. Wrangler runs the Worker with local D1 and R2 storage, so the local bank starts empty.

## Architecture and deployment

The frontend is plain HTML, CSS, and JavaScript in `web/`. The Worker in `worker/` converts assessments and serves the app and its API. Cloudflare D1 stores assessment details, and Cloudflare R2 stores PDFs. Database migrations live in `drizzle/`.

Production runs on **Cloudflare Workers**. Run `npm run build` to build the Worker. Follow [DEPLOY.md](./DEPLOY.md) for Cloudflare setup, database migrations, deployment, and report handling.

blank. is an independent student project. It has no affiliation with the University of Waterloo or Crowdmark.
