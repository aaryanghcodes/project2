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

4. Open the **SQL Editor** in the Neon dashboard and run:

   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

   This must happen before the first deploy — the migration creates
   `vector(384)` columns and will fail if the extension is missing.

> Supabase works identically if you prefer it. Use the **session pooler**
> connection string, not the direct one.

---

## 2. Deploy — Vercel

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

At this point signup and login work, and the app is live. The feed is still
empty — that's the next step.

---

## 3. Seed the interest catalog

The catalog needs to be embedded and written once. Easiest from your own
machine, pointed at the production database:

```bash
git clone https://github.com/aaryanghcodes/project2.git
cd project2
npm install

# Paste the SAME Neon connection string here
echo 'DATABASE_URL="postgresql://...your-neon-url..."' > .env

npm run db:seed
```

First run downloads the embedding model (~130MB) and takes a minute or two.
When it prints `Done. 44 interests ready.`, reload your Vercel URL — the
signed-in page will show 44 interests in the catalog.

> If your network blocks `huggingface.co`, prefix with
> `EMBEDDING_PROVIDER=hashed` to seed anyway. Do this only to unblock yourself;
> the vectors it produces are lexical, not semantic, and should be re-seeded
> properly later.

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
