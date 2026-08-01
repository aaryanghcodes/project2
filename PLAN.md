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

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 15, App Router, TypeScript | UI + API routes in one codebase |
| DB | Postgres + `pgvector` | Neon or Supabase; pgvector for similarity search |
| ORM | Prisma | `Unsupported("vector(1536)")` for embedding columns, raw SQL for ANN queries |
| Auth | Auth.js (NextAuth) | Email/password + Google OAuth |
| Styling | Tailwind + shadcn/ui | Fast, good defaults for card/grid UI |
| News source | NewsAPI.org | See §4 for the tier problem |
| Embeddings | OpenAI `text-embedding-3-small` | 1536 dims, ~$0.02/1M tokens |
| Jobs | Vercel Cron | Ingestion every 30 min |
| Hosting | Vercel | |

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
`seed_embedding vector(1536)`, `sort_order`

Ship ~40 interests across ~9 groups. Each one's `seed_embedding` is the
embedding of a short descriptive sentence ("News about artificial intelligence,
machine learning research, and AI products"), refined later to the centroid of
articles actually tagged with it.

**user_interests** — `user_id`, `interest_id`, `weight` (float, default 1.0),
`source` (`onboarding` | `inferred`). PK `(user_id, interest_id)`.

**articles** — `id`, `url_hash` (unique, sha256 of normalized URL), `url`,
`source_name`, `author`, `title`, `description`, `content_snippet`,
`image_url`, `published_at`, `fetched_at`, `lang`, `embedding vector(1536)`,
`story_cluster_id` (nullable), `quality_score` (float)

**article_topics** — `article_id`, `interest_id`, `confidence`. Derived by
comparing the article embedding to interest seed embeddings; keep the top 3
above a threshold. Used for the stratified calibration sample and for "why am I
seeing this" labels.

**interactions** — `id`, `user_id`, `article_id`, `type` (`like` | `dislike` |
`click` | `dwell` | `save` | `hide`), `dwell_ms`, `context` (`onboarding` |
`feed`), `created_at`. Unique on `(user_id, article_id, type)`.

**user_taste_centroids** — `user_id`, `idx`, `polarity` (`pos` | `neg`),
`vector vector(1536)`, `weight`, `article_count`, `updated_at`.
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

Cron every 30 minutes:

1. **Fetch** — NewsAPI `/v2/top-headlines` per category, plus `/v2/everything`
   for keyword queries backing our narrower interests.
2. **Normalize** — strip URL tracking params, hash, drop rows whose `url_hash`
   already exists.
3. **Embed** — batch the new articles (`title + ". " + description + ". " +
   content_snippet`) into one embeddings request per 100 articles.
4. **Tag** — cosine-compare against interest seed embeddings, write the top 3
   above threshold into `article_topics`.
5. **Cluster** — group articles with pairwise cosine > 0.92 into a
   `story_cluster_id` so the same story from twelve outlets collapses to one
   card.
6. **Prune** — delete articles older than 30 days.

### ⚠️ The NewsAPI constraint — decide before launch

The free tier is **development-only**, capped around 100 requests/day, and
articles are **delayed 24 hours**. That's workable for building, and delayed
articles are fine while we're testing ranking, but it does not support a live
product. Before any real users:

- **Option A** — NewsAPI paid tier (~$449/mo Business). Zero code change.
- **Option B** — swap the fetch step for a curated RSS/Atom ingester. Free and
  unlimited, and everything downstream of step 2 is unchanged because the
  pipeline is source-agnostic by design. Roughly 2-3 days of work.

I'd build against NewsAPI now and keep the fetcher behind a `NewsSource`
interface so B is a drop-in. Revisit at the end of Phase 1.

**Licensing:** store and display title, description, a short snippet, image, and
a link to the original. Do not store or serve full article bodies, and keep
source attribution on every card. This is both NewsAPI's terms and the safe
copyright posture generally.

**Cost sanity check:** ~1,000 articles/day × ~200 tokens ≈ 200k tokens/day ≈
**$0.004/day** in embeddings. Not a factor.

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
Next.js scaffold, Prisma + pgvector migrations, Auth.js with email + Google,
seed the 40-interest catalog and embed the seeds. *Done when:* a user can sign
up, log in, and hit an empty authenticated page.

**Phase 1 — Ingestion (~3 days)**
`NewsSource` interface + NewsAPI implementation, normalize/dedupe, batch
embedding, topic tagging, story clustering, cron route. *Done when:* the
articles table fills automatically every 30 min with embeddings and topics
populated. **Decide the NewsAPI tier question here.**

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
| NewsAPI free tier can't serve live users | `NewsSource` interface; RSS fallback costed at 2-3 days |
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
