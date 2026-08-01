# Deploying to a public URL

Gets you a real link where signup, login, and the database actually work.
Both services below are free at this size. Budget ~15 minutes.

You need: a GitHub account (you have one), and the repo pushed (it is).

---

## 1. Create the database — Neon

Neon is Postgres with `pgvector` available, and its free tier is enough here.

1. Go to <https://neon.tech> and sign up with GitHub.
2. Create a project. Any name; pick the region closest to you.
3. Neon shows you a connection string. Copy it — it looks like:

   ```
   postgresql://user:password@ep-something-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

Nothing else to do in the dashboard — the first migration runs
`CREATE EXTENSION IF NOT EXISTS vector` itself.

> Supabase works identically if you prefer it. Use the **session pooler**
> connection string, not the direct one.

---

## 2. Give the connection string to GitHub

Do this before deploying, because it is also what the ingestion cron uses.

In the repo: **Settings → Secrets and variables → Actions → New repository
secret**. Name it `DATABASE_URL`, paste the Neon string, save.

Keep the string out of chat logs, commits, and screenshots — it contains the
database password in plain text. GitHub masks it in workflow output.

Then run the setup workflow: **Actions → Set up database → Run workflow**, type
`setup` to confirm. It applies migrations, embeds the interest catalog with the
real model, and does a first ingest. Takes a few minutes on the first run while
the model downloads.

Read the **Verify** step's output when it finishes. It prints the similarity
distributions that topic tagging and story clustering depend on, and those
thresholds are still provisional — see the note at the end of this file.

---

## 3. Deploy — Vercel

1. Go to <https://vercel.com> and sign up with GitHub.
2. **Add New → Project**, and import `aaryanghcodes/project2`.
3. Before clicking Deploy, open **Environment Variables** and add three:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the Neon connection string from step 1 |
   | `AUTH_SECRET` | run `openssl rand -base64 32` and paste the output |
   | `AUTH_TRUST_HOST` | `true` |

4. Set **Build Command** to:

   ```
   npm run vercel-build
   ```

   That runs `prisma migrate deploy && next build`, so your tables are created
   on the first deploy automatically. (Vercel may detect this already — set it
   explicitly to be sure.)

5. Deploy. You get a URL like `project2-xyz.vercel.app`.

Signup and login now work against the same database the setup workflow
prepared, and the interest catalog is already populated.

---

## 4. Confirm ingestion is running

The `Ingest articles` workflow runs every 30 minutes on its own once
`DATABASE_URL` is set. Check the Actions tab after the first hour: each run
logs how many articles were fetched, how many were new, and how many were
duplicates. A healthy steady state is a large `fetched` and a small `new` —
that means dedupe is doing its job.

A run where every feed fails is treated as a failure rather than a quiet no-op,
so a blanket block or a DNS problem turns the workflow red instead of leaving
the database silently stale.

---

## What works after this

- Landing page, account creation, sign in and out
- Session-protected routes
- 44 interests with real embeddings in a live database

## What does not work yet

- **No articles.** RSS ingestion is Phase 1, so the feed count stays at 0.
- **No interest picker or calibration.** Phase 2.
- **No ranking.** Phase 3.

So this link demos the foundation, not the product. If you want something that
*looks* like the finished product for a demo, say so — a clickable prototype of
the full flow is a different and much faster piece of work than building
Phases 1-3.

---

## Redeploying

Vercel redeploys automatically on every push to the branch you connected. To
point it at `main` later, change the Production Branch in
**Settings → Git**.

## Costs

Free. Neon's free tier covers this comfortably; Vercel's Hobby tier is free for
non-commercial use. If this becomes a real commercial product you'll need
Vercel Pro (~$20/mo). Embeddings run on your own machine or in CI, so they cost
nothing either way.
