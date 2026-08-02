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
3. Before clicking Deploy, open **Environment Variables** and add two:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the same Neon connection string from step 1 |
   | `AUTH_SECRET` | run `openssl rand -base64 32` and paste the output |

   `AUTH_TRUST_HOST` is **not** needed here — Auth.js trusts Vercel's host
   automatically. It is only for self-hosting.

   Use the same `DATABASE_URL` the ingest cron uses. Pointing Vercel at a
   different database is the one mistake that produces a working site with a
   permanently empty feed, because the articles land somewhere the app cannot
   see.

4. Set **Build Command** to:

   ```
   npm run vercel-build
   ```

   That runs `prisma migrate deploy && next build`. The setup workflow already
   applied the migrations, so this is a no-op on the first deploy — it is here
   so future schema changes ship with the code that needs them.

5. Deploy. You get a URL like `project2-xyz.vercel.app`.

Sign up on the deployed site and you will land in the interest picker, then
calibration, then your ranked feed — against the articles the cron has been
collecting.

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

The whole loop, end to end:

- Sign up, sign in, session-protected routes
- Interest picker over a 44-interest catalog with real embeddings
- Calibration deck built for information rather than relevance
- A taste profile clustered from your ratings
- A ranked feed with story dedupe, exploration slots, and like/dislike that
  moves the profile immediately
- Articles refreshed every 30 minutes by the ingest cron

Two accounts that answer onboarding differently get measurably different
feeds — verified at 0% overlap between opposed profiles.

## Known rough edges

Real, and worth knowing before you show anyone:

- **The "why am I seeing this" chip is sometimes wrong.** It names the nearest
  tagged interest, and the catalog is thin in places — golf and athletics both
  land on "Soccer" because there is no better option in the catalog.
- **A narrow profile produces a monotonous feed.** Ranking is working as
  specified, but a soccer-only profile gets a page of nothing but soccer. The
  calibration deck applies MMR for variety; the feed does not yet.
- **Relevance only outweighs recency by about 1.25x.** Two users with *similar*
  interests may see more overlap than the 0% headline suggests.

## Not built yet

Phase 4 and 5 from PLAN.md: "why am I seeing this" as a real explanation,
editing interests, reset profile, saved articles, email digest, PWA.

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
