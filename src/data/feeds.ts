/**
 * The curated feed list.
 *
 * Every entry is a public RSS/Atom endpoint that needs no key and no
 * attribution deal. Breadth matters more than depth here: the recommendation
 * engine can only surface topics that exist in the pool, so a user who picks
 * "Space" needs space articles to have been ingested whether or not anyone
 * else picked it. See PLAN.md §4 for why RSS is sufficient.
 *
 * `group` is a weak prior, not a label. Real topic assignment happens at
 * ingest by embedding similarity against the interest catalog, because a
 * publication filed under Technology routinely runs business and policy
 * stories. It exists so we can check coverage across groups when curating,
 * and so a brand-new article has something sensible before tagging runs.
 *
 * `quality` seeds `Article.qualityScore` (0-1). It encodes how much editorial
 * trust a source gets by default — wire services and established desks higher,
 * aggregators and high-volume blogs lower — so that when two articles cover
 * the same story, the ranking layer has a tiebreaker that is not just
 * recency. It is a prior, not a verdict.
 */

export interface FeedSource {
  id: string;
  name: string;
  url: string;
  group: string;
  quality: number;
}

export const FEEDS: FeedSource[] = [
  // ---------------------------------------------------------------- Technology
  {
    id: "ars-technica",
    name: "Ars Technica",
    url: "https://feeds.arstechnica.com/arstechnica/index",
    group: "Technology",
    quality: 0.85,
  },
  {
    id: "the-verge",
    name: "The Verge",
    url: "https://www.theverge.com/rss/index.xml",
    group: "Technology",
    quality: 0.75,
  },
  {
    id: "techcrunch",
    name: "TechCrunch",
    url: "https://techcrunch.com/feed/",
    group: "Technology",
    quality: 0.65,
  },
  {
    id: "hacker-news",
    name: "Hacker News",
    url: "https://hnrss.org/frontpage",
    group: "Technology",
    quality: 0.6,
  },
  {
    id: "mit-tech-review",
    name: "MIT Technology Review",
    url: "https://www.technologyreview.com/feed/",
    group: "Technology",
    quality: 0.85,
  },
  {
    id: "wired",
    name: "WIRED",
    url: "https://www.wired.com/feed/rss",
    group: "Technology",
    quality: 0.75,
  },

  // ------------------------------------------------------------------- Science
  {
    id: "quanta",
    name: "Quanta Magazine",
    url: "https://www.quantamagazine.org/feed/",
    group: "Science",
    quality: 0.9,
  },
  {
    id: "phys-org",
    name: "Phys.org",
    url: "https://phys.org/rss-feed/",
    group: "Science",
    quality: 0.7,
  },
  {
    id: "science-daily",
    name: "ScienceDaily",
    url: "https://www.sciencedaily.com/rss/all.xml",
    group: "Science",
    quality: 0.65,
  },
  {
    id: "nasa",
    name: "NASA",
    url: "https://www.nasa.gov/rss/dyn/breaking_news.rss",
    group: "Science",
    quality: 0.85,
  },
  {
    id: "space-com",
    name: "Space.com",
    url: "https://www.space.com/feeds/all",
    group: "Science",
    quality: 0.65,
  },

  // ------------------------------------------------------------------ Business
  {
    id: "cnbc-business",
    name: "CNBC",
    url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147",
    group: "Business",
    quality: 0.75,
  },
  {
    id: "marketwatch",
    name: "MarketWatch",
    url: "https://feeds.content.dowjones.io/public/rss/mw_topstories",
    group: "Business",
    quality: 0.75,
  },
  {
    id: "fortune",
    name: "Fortune",
    url: "https://fortune.com/feed/fortune-feeds/?id=3230629",
    group: "Business",
    quality: 0.7,
  },
  {
    id: "guardian-business",
    name: "The Guardian",
    url: "https://www.theguardian.com/uk/business/rss",
    group: "Business",
    quality: 0.8,
  },

  // -------------------------------------------------------------------- Health
  {
    id: "stat-news",
    name: "STAT",
    url: "https://www.statnews.com/feed/",
    group: "Health",
    quality: 0.85,
  },
  {
    id: "npr-health",
    name: "NPR Health",
    url: "https://feeds.npr.org/1128/rss.xml",
    group: "Health",
    quality: 0.8,
  },
  {
    id: "medical-news-today",
    name: "Medical News Today",
    url: "https://www.medicalnewstoday.com/rss",
    group: "Health",
    quality: 0.6,
  },
  {
    id: "harvard-health",
    name: "Harvard Health",
    url: "https://www.health.harvard.edu/blog/feed",
    group: "Health",
    quality: 0.8,
  },

  // ------------------------------------------------------------------ Politics
  {
    id: "npr-politics",
    name: "NPR Politics",
    url: "https://feeds.npr.org/1014/rss.xml",
    group: "Politics",
    quality: 0.8,
  },
  {
    id: "the-hill",
    name: "The Hill",
    url: "https://thehill.com/rss/syndicator/19110",
    group: "Politics",
    quality: 0.65,
  },
  {
    id: "politico",
    name: "POLITICO",
    url: "https://rss.politico.com/politics-news.xml",
    group: "Politics",
    quality: 0.75,
  },

  // --------------------------------------------------------------------- World
  {
    id: "bbc-world",
    name: "BBC News",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    group: "World",
    quality: 0.9,
  },
  {
    id: "al-jazeera",
    name: "Al Jazeera",
    url: "https://www.aljazeera.com/xml/rss/all.xml",
    group: "World",
    quality: 0.8,
  },
  {
    id: "guardian-world",
    name: "The Guardian",
    url: "https://www.theguardian.com/world/rss",
    group: "World",
    quality: 0.8,
  },
  {
    id: "npr-world",
    name: "NPR",
    url: "https://feeds.npr.org/1004/rss.xml",
    group: "World",
    quality: 0.8,
  },

  // -------------------------------------------------------------------- Sports
  {
    id: "espn",
    name: "ESPN",
    url: "https://www.espn.com/espn/rss/news",
    group: "Sports",
    quality: 0.7,
  },
  {
    id: "bbc-sport",
    name: "BBC Sport",
    url: "https://feeds.bbci.co.uk/sport/rss.xml",
    group: "Sports",
    quality: 0.8,
  },
  {
    id: "guardian-football",
    name: "The Guardian",
    url: "https://www.theguardian.com/football/rss",
    group: "Sports",
    quality: 0.75,
  },

  // ------------------------------------------------------------------- Culture
  {
    id: "variety",
    name: "Variety",
    url: "https://variety.com/feed/",
    group: "Culture",
    quality: 0.7,
  },
  {
    id: "pitchfork",
    name: "Pitchfork",
    url: "https://pitchfork.com/feed/feed-news/rss",
    group: "Culture",
    quality: 0.7,
  },
  {
    id: "guardian-culture",
    name: "The Guardian",
    url: "https://www.theguardian.com/culture/rss",
    group: "Culture",
    quality: 0.8,
  },
  {
    id: "npr-books",
    name: "NPR",
    url: "https://feeds.npr.org/1032/rss.xml",
    group: "Culture",
    quality: 0.8,
  },

  // ----------------------------------------------------------------- Lifestyle
  {
    id: "lifehacker",
    name: "Lifehacker",
    url: "https://lifehacker.com/feed/rss",
    group: "Lifestyle",
    quality: 0.55,
  },
  {
    id: "serious-eats",
    name: "Serious Eats",
    url: "https://www.seriouseats.com/feeds/all",
    group: "Lifestyle",
    quality: 0.7,
  },
  {
    id: "guardian-lifeandstyle",
    name: "The Guardian",
    url: "https://www.theguardian.com/lifeandstyle/rss",
    group: "Lifestyle",
    quality: 0.75,
  },
];

/** Feeds grouped by their editorial group, for coverage checks while curating. */
export function feedsByGroup(): Map<string, FeedSource[]> {
  const map = new Map<string, FeedSource[]>();
  for (const feed of FEEDS) {
    const existing = map.get(feed.group);
    if (existing) existing.push(feed);
    else map.set(feed.group, [feed]);
  }
  return map;
}
