# Winnow

A personalized news feed. You pick a few interests, rate a short sample feed,
and the ranking sharpens from there.

The name is set in `src/lib/site.ts`, which is the only place it lives — all
user-facing copy reads from there.

**[PLAN.md](./PLAN.md) is the design document.** It covers the product flow,
the recommendation engine, and the phased build. Read it first.

## Status

Phase 0 (foundation) is complete and verified:

- Next.js 16 + TypeScript + Tailwind 4
- Postgres + pgvector schema with HNSW indexes, via Prisma 7
- Email/password auth (Auth.js v5), with route protection
- A 44-interest catalog seeded with computed embeddings

Phase 1 (RSS ingestion) is next. See PLAN.md §8.

## Requirements

- Node 22+
- Postgres 16+ with the `pgvector` extension

No paid API keys. Embeddings run locally.

## Setup

```bash
npm install

# Postgres with pgvector. Any instance works — this is just one way.
sudo apt-get install -y postgresql-16-pgvector    # or: brew install pgvector
createdb newsfeed
psql newsfeed -c 'CREATE EXTENSION IF NOT EXISTS vector;'

cp .env.example .env      # then set DATABASE_URL and AUTH_SECRET
npx prisma migrate deploy
npm run db:seed           # embeds and stores the interest catalog
npm run dev
```

Generate `AUTH_SECRET` with `openssl rand -base64 32`.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:seed` | Seed / re-seed the interest catalog |
| `npm run db:studio` | Prisma Studio |

## Embeddings

Text is embedded locally with `bge-small-en-v1.5` (384 dims) through
Transformers.js — no API key, no per-call cost. Weights (~130MB) download from
HuggingFace on first use and are cached in `.model-cache/`.

**Offline fallback.** If you are on a network that cannot reach
`huggingface.co`, set `EMBEDDING_PROVIDER=hashed`. That swaps in a deterministic
lexical embedder so the pipeline runs end to end. It matches on shared
vocabulary only and has no semantic understanding — use it to exercise plumbing,
never to judge feed quality, and never in production. See
`src/lib/embeddings/hashed.ts`.

Everything downstream depends only on `embed()` / `embedBatch()`, so switching
to a hosted embedding API later is a change to `src/lib/embeddings/index.ts`
alone.

## Layout

```
prisma/
  schema.prisma      data model (see PLAN.md §3)
  seed.ts            interest catalog seeding
src/
  app/               routes: landing, (auth)/signin, (auth)/signup, feed
  components/ui.tsx  shared primitives
  data/interests.ts  the interest catalog — edit, then re-seed
  lib/
    auth.ts          Auth.js config, currentUser()
    db.ts            Prisma client singleton
    embeddings/      local embedding providers
    vector.ts        pgvector <-> JS conversion, cosine helpers
```

## Notes

- Vector columns are `Unsupported("vector(384)")` in Prisma, so they are read
  and written through raw SQL. `src/lib/vector.ts` is the only place that
  representation should be built.
- Editing an interest's `description` changes its seed vector. Re-run
  `npm run db:seed` afterwards.
- Only headlines, snippets, and links to the original are stored or displayed.
  Full article text is never redistributed.
