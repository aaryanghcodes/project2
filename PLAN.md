# Personalized News Feed — Product & Technical Plan

## 1. What we're building

A web product where a user creates an account, tells us roughly what they care
about, calibrates that with a short like/dislike pass over a sample feed, and
then gets a ranked news feed that keeps sharpening as they use it.

The core insight driving the design: **stated interests are coarse, behavior is
precise.** "Technology" is a checkbox; "self-hosted infra and chip supply
chains, but not consumer gadget reviews" is what the person actually wants. The
checkbox grid solves cold start. The like/dislike signal is what makes the feed
good.

### User flow

```
Sign up  →  Pick interests (grid of checkboxes, min 3)
         →  Calibration feed (~18 cards, like / dislike / skip, min 8 rated)
         →  Personalized feed (ranking updates continuously from here on)
```

---

## 2. Stack

Constraint: **no paid APIs.** Every dependency below is free at our scale, and
the whole thing runs on free hosting tiers. This is the "MVP to demo" build.

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 15, App Router, TypeScript | UI + API routes in one codebase |
| DB | Postgres + `pgvector` | Neon or Supabase free tier; Docker locally |
| ORM | Prisma | `Unsupported("vector(384)")` for embedding columns, raw SQL for ANN queries |
| Auth | Auth.js v5 (credentials) | Email/password, bcrypt, JWT sessions |
| Styling | Tailwind + shadcn/ui | Fast, good defaults for card/grid UI |
| News source | Curated RSS/Atom feeds | Free, unlimited, no key — see §4 |
| Embeddings | `bge-small-en-v1.5` via Transformers.js | Runs locally, 384 dims, no API key |
| Jobs | GitHub Actions cron | Free; see the note on why not Vercel Cron |
| Hosting | Vercel free tier | |

### Consequences of going key-free

**Embeddings run in-process, not over HTTP.** `@xenova/transformers` runs
`bge-small-en-v1.5` as ONNX on the CPU. It's a strong English retrieval model
that punches well above its 33M parameters, and at 384 dimensions the vectors
are a quarter the size of OpenAI's — smaller index, faster search, less storage.
Quality is a step below `text-embedding-3-small` but comfortably good enough for
topic-level personalization, and swapping to a hosted model later is a one-file
change behind the `embed()` interface.

**Ingestion can't run on Vercel Cron.** The model weights are ~130MB, which
blows past the serverless bundle limit and would cold-start on every invocation.
So ingestion runs as a standalone Node script on a **GitHub Actions schedule**,
writing straight to Postgres. Free, no timeout pressure, and the model gets
cached between runs. The web app never loads the model except for the rare
on-demand embed.

**One demo-critical implication:** because this is an investor/team demo, the
database must never look empty. The seed script ships with a checked-in fixture
set of articles so a fresh clone has a populated, believable feed on first run,
independent of whether the RSS cron has ever fired.

---

## 3. Data model

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

**users** — `id`, `email` (unique), `password_hash` (nullable for OAuth),
`name`, `image_url`, `onboarding_state` (enum: `interests` | `calibration` |
`complete`), `created_at`

**interests** — the checkbox catalog. `id`, `slug`, `label`, `group` (Tech,
Science, Business, Health, Sports, Politics, World, Culture, …),
`seed_embedding vector(384)`, `sort_order`

Ship ~40 interests across ~9 groups. Each one's `seed_embedding` is the
embedding of a short descriptive sentence ("News about artificial intelligence,
machine learning research, and AI products"), refined later to the centroid of
articles actually tagged with it.

**user_interests** — `user_id`, `interest_id`, `weight` (float, default 1.0),
`source` (`onboarding` | `inferred`). PK `(user_id, interest_id)`.

**articles** — `id`, `url_hash` (unique, sha256 of normalized URL), `url`,
`source_name`, `author`, `title`, `description`, `content_snippet`,
`image_url`, `published_at`, `fetched_at`, `lang`, `embedding vector(384)`,
`story_cluster_id` (nullable), `quality_score` (float)

**article_topics** — `article_id`, `interest_id`, `confidence`. Derived by
comparing the article embedding to interest seed embeddings; keep the top 3
above a threshold. Used for the stratified calibration sample and for "why am I
seeing this" labels.

**interactions** — `id`, `user_id`, `article_id`, `type` (`like` | `dislike` |
`click` | `dwell` | `save` | `hide`), `dwell_ms`, `context` (`onboarding` |
`feed`), `created_at`. Unique on `(user_id, article_id, type)`.

**user_taste_centroids** — `user_id`, `idx`, `polarity` (`pos` | `neg`),
`vector vector(384)`, `weight`, `article_count`, `updated_at`.
This is the user's taste profile — see §5.

**impressions** — `user_id`, `article_id`, `shown_at`, `position`,
`session_id`. Prevents re-showing and gives us position-aware CTR later.

### Indexes

```sql
CREATE INDEX ON articles USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON articles (published_at DESC);
CREATE INDEX ON impressions (user_id, article_id);
CREATE INDEX ON interactions (user_id, created_at DESC);
```

---

## 4. Ingestion pipeline

A standalone Node script (`scripts/ingest.ts`), run every 30 minutes by a
GitHub Actions schedule and also runnable by hand:

1. **Fetch** — pull a curated list of ~60 English RSS/Atom feeds in parallel
   with a concurrency cap, using `rss-parser`. Feeds live in a checked-in
   config file grouped by interest, so adding coverage is a data change, not a
   code change. Send `If-Modified-Since` / `ETag` and skip unchanged feeds.
2. **Normalize** — strip URL tracking params (`utm_*`, `fbclid`), resolve
   redirects, sha256 the cleaned URL, drop rows whose `url_hash` exists.
3. **Embed** — batch new articles (`title + ". " + description + ". " +
   content_snippet`) through the local model, 32 at a time.
4. **Tag** — cosine-compare against interest seed embeddings, write the top 3
   above threshold into `article_topics`.
5. **Cluster** — group articles with pairwise cosine > 0.92 into a
   `story_cluster_id` so the same story from twelve outlets collapses to one
   card.
6. **Prune** — delete articles older than 30 days.

Everything from step 2 onward is source-agnostic. The fetcher sits behind a
`NewsSource` interface, so if you ever want to add a paid API alongside RSS it
plugs in without touching the pipeline.

### Why RSS is genuinely fine here

It's not a downgrade forced by budget. RSS gives us **no rate limits, no key
rotation, no vendor dependency, and no 24-hour delay** — feeds carry stories
within minutes of publication, which is better than NewsAPI's free tier offered.
The real costs are that we curate the source list ourselves, and that feed
quality varies (some outlets publish title-only items with no description).

Two things to handle because of that variance:
- Items with a description under ~120 characters embed poorly. Fetch the page's
  Open Graph description as a fallback, and skip the item if that's also thin.
- Some feeds paginate poorly or replay old items. The `url_hash` dedupe absorbs
  this, but cap per-feed intake per run so one misbehaving feed can't flood.

**Licensing:** store and display title, description, a short snippet, image, and
a link to the original. Never store or serve full article bodies, and keep
source attribution and an outbound link on every card. RSS being publicly
published doesn't grant redistribution rights to full text — headline, snippet,
and link is the defensible posture.

---

## 5. The recommendation engine

### Why not a single taste vector

The obvious approach — average all the articles a user liked into one vector —
breaks on real people. Someone into both quantum computing and the NBA gets a
mean vector pointing at neither. So the profile is **multi-vector**.

### Profile

Keep up to **6 positive centroids** and **3 negative centroids** per user.
Positives come from k-means over their liked-article embeddings (k grows with
interaction count: 2 centroids under 10 likes, up to 6 past 50). Negatives come
from disliked articles the same way.

**Cold start:** immediately after the checkbox step, seed the positive centroids
from the selected interests' `seed_embedding`s — one centroid per interest
group they picked. So they have a usable profile before rating anything.

### Scoring

For each candidate article `a`:

```
relevance  = max over positive centroids c of  cosine(a, c) * c.weight
aversion   = max over negative centroids n of  cosine(a, n)
freshness  = exp(-age_hours / 36)
score      = w1*relevance - w2*aversion + w3*freshness + w4*quality + noise
```

Starting weights `w1=1.0, w2=0.8, w3=0.35, w4=0.1`, tuned by hand against real
feeds. Then apply hard filters: drop anything already in `impressions` for this
user, and keep only one article per `story_cluster_id`.

### Retrieval

Don't score the whole table. Query pgvector for the top ~200 nearest neighbors
per positive centroid (`ORDER BY embedding <=> $1 LIMIT 200`) restricted to
`published_at > now() - interval '7 days'`, union the candidates, then apply the
full scoring formula in application code. Fast, and the HNSW index does the
heavy lifting.

### Exploration

Reserve **~15% of feed slots** for articles outside the user's current taste —
sampled from interests adjacent to theirs, or simply high-quality items with low
relevance scores. Without this the feed collapses into a bubble within a week
and stops discovering the specific interests we're trying to find. Mark these
slots internally so we can measure whether exploration slots earn likes.

### Learning from feedback

On each like/dislike: attach the article to its nearest centroid of matching
polarity and nudge that centroid toward it, `c ← normalize(c + η(a - c))`, with
η decaying as `article_count` grows. Full k-means refit runs nightly, or
immediately at the end of onboarding calibration.

Implicit signals get folded in later with smaller weights: a click is a weak
like, a long dwell a stronger one, a scroll-past after an impression a very weak
dislike. Ship explicit like/dislike first — implicit signal is noisy and needs
real traffic to calibrate.

### The calibration feed is a separate problem

The onboarding sample must **maximize information**, not relevance. Showing 18
articles the user is 95% likely to like teaches us nothing. Build it with
stratified sampling plus maximal marginal relevance:

- One or two articles per selected interest, for coverage.
- Within each interest, pick items that are far apart from each other, so a
  like/dislike pair actually splits the space.
- Two or three deliberately off-profile items to catch interests they didn't
  check.

Require 8 ratings before "Done" enables; allow skip on individual cards.

---

## 6. API surface

```
POST   /api/auth/[...nextauth]        Auth.js
GET    /api/interests                 catalog, grouped
POST   /api/onboarding/interests      { interestIds: string[] }  (min 3)
GET    /api/onboarding/sample-feed    stratified + MMR sample
POST   /api/onboarding/complete       k-means → user_taste_centroids
POST   /api/interactions              { articleId, type, dwellMs? }
GET    /api/feed?cursor=              ranked, paginated
POST   /api/cron/ingest               cron-secret protected
```

---

## 7. Screens

1. **Landing** — what it is, sign up.
2. **Sign up / sign in.**
3. **Interest picker** — grid of ~40 chips grouped by category, multi-select,
   sticky "Continue (3 minimum)" footer.
4. **Calibration** — one card at a time or a 2-col grid, thumbs up/down/skip,
   progress bar "8 of 18 rated".
5. **Feed** — infinite scroll cards: image, source + time, title, snippet, like
   / dislike / save, "why am I seeing this" chip showing the matched interest.
6. **Settings** — edit interests, view liked history, reset profile.

---

## 8. Build phases

**Phase 0 — Foundation (~2 days)**
Next.js scaffold, Prisma + pgvector migrations, Auth.js email/password, local
embedding module, seed the 40-interest catalog with computed embeddings.
*Done when:* a user can sign up, log in, and hit an empty authenticated page,
and the interest catalog is in the database with real vectors.

**Phase 1 — Ingestion (~3 days)**
`NewsSource` interface + RSS implementation, curated feed list, normalize and
dedupe, batch embedding, topic tagging, story clustering, GitHub Actions cron.
*Done when:* the articles table fills automatically every 30 min with embeddings
and topics populated, and a checked-in fixture set guarantees a non-empty demo.

**Phase 2 — Onboarding (~3 days)**
Interest picker, stratified + MMR calibration feed, interaction recording,
k-means centroid build on completion. *Done when:* a new user finishes
onboarding and has populated `user_taste_centroids`.

**Phase 3 — Feed & ranking (~4 days)**
pgvector candidate retrieval, scoring formula, impression filtering, cluster
dedupe, exploration slots, infinite scroll, like/dislike with online centroid
updates. *Done when:* the feed is visibly different for two users with different
onboarding answers — that's the acceptance test for the whole product.

**Phase 4 — Sharpening (~3 days)**
Nightly k-means refit, implicit signals, "why am I seeing this", settings/edit
interests, reset profile.

**Phase 5 — Polish**
Saved articles, email digest, PWA, share.

Roughly **3 weeks** to a working v1 at Phase 3, which is the point where the
product is real.

---

## 9. Risks and open questions

| Risk | Mitigation |
|---|---|
| RSS feed quality varies; thin descriptions embed badly | Open Graph fallback, skip items still too thin, cap per-feed intake |
| Local embeddings are weaker than hosted ones | Behind an `embed()` interface; swap to a hosted model is one file if quality disappoints |
| Demo database looks empty if cron hasn't run | Checked-in article fixtures seeded on setup |
| Cold start feels generic before calibration | Seed centroids from interest embeddings at checkbox time, not after |
| Filter bubble / feed goes stale | 15% exploration slots, measured against like rate |
| Same story from 12 outlets floods feed | Story clustering at 0.92 cosine, one card per cluster |
| Users won't rate 18 cards | Allow skip, require only 8, show progress; measure drop-off |
| Copyright on article content | Title + snippet + link only, attribution on every card |

**Open questions for you:**

1. Do we need a mobile app eventually, or is a responsive web PWA enough? It
   affects whether we keep the API strictly REST-clean from day one.
2. Should users be able to follow specific sources ("more Reuters, less
   TechCrunch") in v1, or is topic-level control enough?
3. Any monetization intent? It changes whether we build impression analytics
   properly in Phase 3 or defer it.

None of these block Phase 0-2, so we can start building while you think about
them.

---

## 10. Decisions on record

| Decision | Choice | Date |
|---|---|---|
| Stack | Next.js + Postgres | 2026-08-01 |
| Purpose | MVP to demo to investors/team — demo path quality over public-scale hardening | 2026-08-01 |
| Paid APIs | None. RSS ingestion + local embedding model | 2026-08-01 |
| Ranking | Embeddings + vector similarity, multi-centroid profile | 2026-08-01 |
| Coverage | English, US-centric | 2026-08-01 |
