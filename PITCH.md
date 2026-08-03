# Winnow — pitch

> **Note on honesty.** Sections 6 (Traction) and 10 (Team) contain blanks
> marked `[FILL IN]`. They are not written because only you know the answers,
> and inventing them is the fastest way to lose a room. Everything else is
> written from what the product actually does today.

---

## 1. The 30-second pitch

Winnow is a news reader that learns what you actually read, not what you say
you like.

You pick a handful of interests, rate about a dozen headlines, and from that
we build a multi-vector taste profile — several distinct interests held
separately, so being into both quantum computing and the NBA doesn't average
into a feed about neither. Every article we ingest is embedded and scored
against that profile, and every like or dislike moves it immediately.

No ads, no engagement optimization, no algorithmic outrage. The only thing the
ranking maximizes is whether *you* want to read the thing.

---

## 2. Who the customer is

The person who reads a lot and resents how much time they spend finding
things worth reading.

Concretely, the wedge is **professionals who need to track a specific field**:
a biotech analyst tracking FDA decisions, a VC tracking a sector, a policy
researcher tracking one legislature. They already spend 30-60 minutes a day on
this. They have twelve tabs, three newsletters, and a Twitter list, and they
still miss things.

Broader consumer market exists behind that, but see §8 — leading with the
general reader is how news apps die.

---

## 3. The problem

Finding news is solved. **Filtering it is not.**

Every existing option fails in one of three ways:

- **Publisher-shaped** (NYT, BBC apps): you get one outlet's judgment of what
  matters. Great outlet, still one worldview, still 80% irrelevant to you.
- **Engagement-shaped** (X, Reddit, Facebook, Google Discover): optimized for
  time-on-app, which is not the same as value-to-reader and frequently the
  opposite. These feeds are very good at showing you what makes you angry.
- **Manual** (RSS readers, newsletters, Twitter lists): actually
  high-signal, but the curation labor falls entirely on you, and it decays —
  the list you built in 2023 doesn't reflect what you care about now.

The gap: **personalized without being manipulative, automatic without being
manual.**

---

## 4. Why existing solutions aren't good enough

| | Personalized | Not engagement-optimized | Zero curation labor |
|---|---|---|---|
| NYT / BBC app | ✗ | ✓ | ✓ |
| Google News / Discover | partial | ✗ | ✓ |
| X / Reddit | ✓ | ✗ | partial |
| Feedly / RSS | ✗ | ✓ | ✗ |
| Newsletters | ✗ | ✓ | ✗ |
| **Winnow** | ✓ | ✓ | ✓ |

Two specific technical failures worth naming, because they're what we fixed:

**Single-vector personalization doesn't work on real people.** Most
recommender systems average your history into one preference vector. Someone
with three unrelated interests gets a vector pointing at none of them. We keep
up to six positive and three negative centroids, and score on best match, not
average.

**Topic filtering is too coarse.** "Show me Technology" gives you 400 articles
a day. We rank on semantic similarity in embedding space, so "the specific
corner of AI research you care about" is expressible without you having to
name it.

**Also worth knowing:** Artifact — built by the Instagram founders, well
funded, well designed, doing roughly this — shut down in January 2024. That is
the single strongest objection to this business and you should raise it before
the investor does. Our read: they went straight at the general consumer, where
retention is brutal and monetization is worse. §8 is a different answer to
that problem, not a denial that the problem exists.

---

## 5. Current product

**Working and deployed today.** Not a mockup.

- **Ingestion:** 36 curated RSS feeds, pulled every 30 minutes on a schedule.
  URL-canonicalized and hash-deduped, so re-runs insert nothing.
- **Embeddings:** `bge-small-en-v1.5` running locally as ONNX. 384 dimensions,
  no API key, no per-article cost.
- **Story clustering:** the same event from six outlets collapses to one card.
- **Onboarding:** interest picker, then a calibration deck built to *maximize
  information rather than relevance* — stratified across your picks, spread by
  maximal marginal relevance within each, plus deliberate off-profile probes.
  Showing you 18 articles you'd obviously like teaches us nothing.
- **Profile:** spherical k-means over your rated articles, k growing with
  evidence. Cold-start seeded from your interest picks so the feed works
  before you've rated anything.
- **Ranking:** pgvector retrieval, then scoring on relevance, aversion,
  freshness, and source quality, with ~15% of slots reserved for exploration
  so the feed doesn't collapse into a bubble.

**The number that matters:** two accounts that answered onboarding differently
get **0% overlap** in their ranked feeds. That's measured by an automated
acceptance test against the live corpus, not asserted.

**Known rough edges**, stated because they're visible in a demo: topic labels
are sometimes wrong (golf gets labelled "Soccer" — the interest catalog is
thin on sports), narrow profiles produce monotonous feeds, and relevance
outweighs recency by a narrower margin than we'd like.

---

## 6. Traction

**`[FILL IN]` — and if the honest answer is "none yet," say that.**

What is true today:

- The product is built and deployed end to end.
- Corpus: 700+ articles, growing automatically every 30 minutes.
- Users: **[FILL IN — currently just you?]**
- Revenue: **none.**
- Waitlist: **[FILL IN — do you have one? If not, this is the single
  cheapest thing to start today.]**

Investors at pre-seed do not expect revenue. They expect *evidence you can
learn*. If you have none of the above, the strongest honest substitute is:

- Number of people you've watched use it, and what they said
- Your own retention — have *you* used it daily for three weeks?
- One quantitative signal, e.g. "of N calibration ratings, X% of feed items
  got a positive reaction"

Instrument that before pitching. It's a day of work and it's the difference
between "I built a thing" and "I built a thing and here's what I learned."

---

## 7. Business model

Consumer news monetization is historically brutal — say so first, then show
you've thought about it.

**Near term — freemium subscription.** Free tier is the full feed. Paid
(~$5/mo) adds saved articles with search, a daily email digest, custom source
lists, and multiple profiles (work vs. personal).

**Why not ads:** an ad-supported feed has to optimize for time-on-app, which
is precisely the thing we're positioning against. Taking ad money would make
us the product we're criticizing. This is a strategic commitment, not
squeamishness.

**Second line — B2B, and possibly the real business.** The engine is
domain-agnostic: ingest documents, embed, personalize, rank. A firm that wants
"every analyst gets a personalized morning brief across our sources" is
solving the same problem with a much larger budget and much better retention
than consumers.

**Unit economics are unusually good.** Embeddings run locally, ingestion runs
on free CI, storage is a Postgres row per article. Marginal cost per user is
close to zero. That means a subscription business works at small scale — we
don't need millions of users to be viable, which is exactly the trap Artifact
was in.

---

## 8. Go-to-market

**Wedge into one vertical. Do not launch as "a better news app."**

That's the Artifact lesson. General-consumer news has weak retention and no
pricing power. A specific professional audience has both.

**Phase 1 — one niche, 100 users.** Pick a field with high information
density and painful filtering: AI/ML research, biotech regulatory, energy
policy, semiconductors. Replace the 36 general feeds with 40 domain sources.
Distribution is direct: the relevant subreddit, a Discord, a newsletter's
comment section, HN. This audience is reachable without spend.

**Phase 2 — earn the second niche.** If retention holds in one vertical, the
same engine re-points at another by swapping the source list and the interest
catalog. That's a configuration change, not a rebuild. Prove it works twice
and you have a platform rather than a product.

**Phase 3 — B2B inbound.** Teams inside those verticals will ask for a shared
version. That's the enterprise motion, and it arrives warm.

**The consumer app is Phase 4, if ever.** It's the biggest market and the
worst place to start.

---

## 9. Why now

**The cost of personalization collapsed.** A 33M-parameter embedding model now
runs on a CPU with quality that required an API call and a per-token bill two
years ago. This product would have had real marginal costs in 2022. Today
inference is free. That's what makes a small subscription business viable
where it previously wasn't.

**Vector search became infrastructure.** pgvector means semantic retrieval is
a Postgres extension, not a separate database and a specialist to run it.

**The incumbent feeds got worse.** Twitter's algorithmic timeline, Google
Discover, and Facebook's news retreat pushed serious readers back to manual
curation. The demand is visibly there — people are doing this work by hand.

**Artifact's shutdown cleared the field.** The best-resourced attempt at this
exited in January 2024. The need didn't disappear with it; the competition
did.

---

## 10. Why this team

**`[FILL IN] — this section cannot be written for you, and it's the one
investors weigh most at pre-seed.**

What to answer, honestly:

- **Are you the customer?** If you built this because your own news
  consumption was broken, say that plainly — founder-as-user is a real
  advantage and it's credible in a way market analysis isn't.
- **What have you shipped before?** Not credentials, evidence of finishing.
- **Why this problem, for the next five years?** Recommender systems are a
  long slog of unglamorous tuning. What makes you the person still doing it
  when it's boring?
- **What unfair access do you have?** A vertical you already know, a community
  you're already in, a distribution channel others don't have.

If the honest answer is "I'm early and this is my first product," that's
workable — say it, and lean on what you've demonstrably built. What is not
workable is an invented credential.

---

## 11. Long-term vision

**Near:** the best reader in a handful of professional verticals. The thing
you open first because it reliably surfaces what you'd have found in an hour.

**Medium:** the personalization layer stops being about news. The engine
takes any stream of documents — papers, filings, internal wikis, job
listings, research — and ranks it against a profile of what one person cares
about. Newsfeed is the first instance, not the product.

**Far — and this is the actual thesis:** every feed you use today is
optimized for someone else's objective. Engagement, ad load, time-on-app,
whatever the platform monetizes. The user's own interest is at best a proxy.

We think there's room for the opposite: a ranking system where the user is
the customer rather than the inventory, and where the objective function is
just "did this person want to read this." That's a boring sentence and a
genuinely different product. Attention is the one budget nobody can top up,
and almost nothing in the market is honestly optimizing it on the user's
behalf.

---

## Appendix — likely questions

**"Isn't this just RSS with extra steps?"** RSS is transport, not ranking. We
use it as a source. The product is what happens after ingestion.

**"What stops Google/Apple from doing this?"** Nothing technically. But their
business model requires ad inventory, and an ad-supported feed can't credibly
promise it isn't optimizing for engagement. The positioning is the moat, not
the algorithm.

**"Artifact failed. Why won't you?"** Different go-to-market (vertical wedge,
not general consumer), different cost structure (near-zero marginal cost, so
viable at thousands of users rather than millions), different business model
(subscription and B2B from the start, never ads).

**"How do you get content rights?"** We show headline, source, timestamp, and
a short snippet from the publisher's own feed, linking out to the original.
That's what RSS is published for. We don't reproduce article bodies.

**"What's the moat?"** Honestly: at this stage, not much technically. The
defensible asset is the accumulated profile — a user with a year of ratings
has a feed a competitor cannot replicate on day one — plus vertical-specific
source curation. Say this plainly; claiming a moat you don't have is worse
than admitting you're early.
