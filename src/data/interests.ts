/**
 * The interest catalog shown as checkboxes during onboarding.
 *
 * `description` is never displayed. It is the text we embed to produce each
 * interest's seed vector, so it is written densely — packed with the
 * vocabulary that actually appears in articles on the topic — rather than as
 * marketing copy. Changing a description changes the seed vector, so re-run
 * `npm run db:seed` after editing one.
 *
 * Keep this list broad but not exhaustive. The checkboxes only need to get a
 * new user into roughly the right neighbourhood; the calibration pass and
 * ongoing likes are what find their specific tastes.
 */

export interface InterestSeed {
  slug: string;
  label: string;
  emoji: string;
  group: string;
  description: string;
}

export const INTEREST_GROUPS = [
  "Technology",
  "Science",
  "Business",
  "Health",
  "Politics",
  "World",
  "Sports",
  "Culture",
  "Lifestyle",
] as const;

export const INTERESTS: InterestSeed[] = [
  // ---------------------------------------------------------------- Technology
  {
    slug: "artificial-intelligence",
    label: "AI & Machine Learning",
    emoji: "🤖",
    group: "Technology",
    description:
      "Artificial intelligence, machine learning research, large language models, neural networks, generative AI products, AI safety and regulation, model releases and benchmarks.",
  },
  {
    slug: "software-development",
    label: "Software Development",
    emoji: "💻",
    group: "Technology",
    description:
      "Software engineering, programming languages, open source projects, developer tools, frameworks, APIs, version control, and engineering practice.",
  },
  {
    slug: "cybersecurity",
    label: "Cybersecurity",
    emoji: "🔐",
    group: "Technology",
    description:
      "Computer security, data breaches, ransomware attacks, vulnerabilities and exploits, encryption, privacy engineering, hacking groups, and security research.",
  },
  {
    slug: "consumer-tech",
    label: "Consumer Tech & Gadgets",
    emoji: "📱",
    group: "Technology",
    description:
      "Smartphones, laptops, wearables, headphones, product launches and reviews, consumer electronics announcements from Apple, Google, Samsung and others.",
  },
  {
    slug: "semiconductors",
    label: "Chips & Hardware",
    emoji: "⚙️",
    group: "Technology",
    description:
      "Semiconductors, chip manufacturing, processors and GPUs, foundries, export controls on advanced chips, supply chains, Nvidia, TSMC, Intel and AMD.",
  },
  {
    slug: "space-tech",
    label: "Space & Aerospace",
    emoji: "🚀",
    group: "Technology",
    description:
      "Rocket launches, satellites, space agencies and commercial spaceflight, SpaceX and NASA missions, orbital infrastructure, planetary exploration.",
  },
  {
    slug: "crypto-web3",
    label: "Crypto & Blockchain",
    emoji: "⛓️",
    group: "Technology",
    description:
      "Cryptocurrency markets, bitcoin and ethereum, blockchain protocols, decentralized finance, stablecoins, crypto regulation and exchanges.",
  },

  // ------------------------------------------------------------------- Science
  {
    slug: "climate-environment",
    label: "Climate & Environment",
    emoji: "🌍",
    group: "Science",
    description:
      "Climate change science, global warming, emissions, extreme weather, conservation, biodiversity loss, environmental policy and renewable energy transition.",
  },
  {
    slug: "space-science",
    label: "Astronomy & Physics",
    emoji: "🔭",
    group: "Science",
    description:
      "Astronomy, astrophysics, telescopes and observatories, black holes, exoplanets, particle physics, quantum mechanics and cosmology research.",
  },
  {
    slug: "biology-genetics",
    label: "Biology & Genetics",
    emoji: "🧬",
    group: "Science",
    description:
      "Genetics and genomics, CRISPR gene editing, molecular biology, evolution, microbiology, cell research and biotechnology breakthroughs.",
  },
  {
    slug: "neuroscience",
    label: "Neuroscience & Psychology",
    emoji: "🧠",
    group: "Science",
    description:
      "Brain research, cognition and memory, neuroscience studies, psychology experiments, mental processes, consciousness and behavioral science.",
  },
  {
    slug: "energy-science",
    label: "Energy & Materials",
    emoji: "⚡",
    group: "Science",
    description:
      "Nuclear fusion and fission, batteries and energy storage, solar and wind technology, grid infrastructure, novel materials and superconductors.",
  },

  // ------------------------------------------------------------------ Business
  {
    slug: "markets-investing",
    label: "Markets & Investing",
    emoji: "📈",
    group: "Business",
    description:
      "Stock markets, equities and bonds, earnings reports, investor sentiment, indexes, trading, hedge funds and portfolio strategy.",
  },
  {
    slug: "economy",
    label: "Economy",
    emoji: "🏦",
    group: "Business",
    description:
      "Macroeconomics, inflation and interest rates, central banks and the Federal Reserve, employment data, recession risk, GDP growth and fiscal policy.",
  },
  {
    slug: "startups-vc",
    label: "Startups & Venture Capital",
    emoji: "🌱",
    group: "Business",
    description:
      "Startup funding rounds, venture capital firms, seed and Series A investment, unicorn valuations, accelerators, founders and company launches.",
  },
  {
    slug: "big-tech-business",
    label: "Big Tech Business",
    emoji: "🏢",
    group: "Business",
    description:
      "Corporate strategy at large technology companies, antitrust cases, acquisitions and mergers, layoffs, quarterly results from Apple, Amazon, Google, Microsoft and Meta.",
  },
  {
    slug: "real-estate",
    label: "Housing & Real Estate",
    emoji: "🏘️",
    group: "Business",
    description:
      "Housing market, mortgage rates, home prices and affordability, rental markets, commercial real estate and construction.",
  },
  {
    slug: "future-of-work",
    label: "Work & Careers",
    emoji: "💼",
    group: "Business",
    description:
      "Remote and hybrid work, labor market trends, hiring and layoffs, unions and organizing, workplace culture, salaries and career advice.",
  },

  // -------------------------------------------------------------------- Health
  {
    slug: "medicine",
    label: "Medicine & Treatments",
    emoji: "💊",
    group: "Health",
    description:
      "Medical research, clinical trials, new drugs and treatments, FDA approvals, cancer research, vaccines and disease therapies.",
  },
  {
    slug: "public-health",
    label: "Public Health",
    emoji: "🏥",
    group: "Health",
    description:
      "Epidemiology and outbreaks, healthcare policy and access, hospitals, insurance, health equity and pandemic preparedness.",
  },
  {
    slug: "nutrition-fitness",
    label: "Nutrition & Fitness",
    emoji: "🥗",
    group: "Health",
    description:
      "Diet and nutrition science, exercise research, weight and metabolism, sleep, longevity and healthy habits.",
  },
  {
    slug: "mental-health",
    label: "Mental Health",
    emoji: "🧘",
    group: "Health",
    description:
      "Anxiety and depression, therapy and treatment, burnout and stress, mental wellbeing, and mental health policy.",
  },

  // ------------------------------------------------------------------ Politics
  {
    slug: "us-politics",
    label: "US Politics",
    emoji: "🇺🇸",
    group: "Politics",
    description:
      "United States politics, Congress and the Senate, the White House and presidency, elections and campaigns, legislation and political parties.",
  },
  {
    slug: "policy-law",
    label: "Law & Courts",
    emoji: "⚖️",
    group: "Politics",
    description:
      "Supreme Court rulings, legal cases and judicial decisions, constitutional law, civil rights litigation, prosecutions and regulation.",
  },
  {
    slug: "tech-policy",
    label: "Tech Policy & Regulation",
    emoji: "📜",
    group: "Politics",
    description:
      "Technology regulation, antitrust enforcement, data privacy law, content moderation rules, AI governance and platform accountability.",
  },
  {
    slug: "immigration",
    label: "Immigration",
    emoji: "🛂",
    group: "Politics",
    description:
      "Immigration policy, borders and asylum, visas and refugees, deportation and enforcement, migration debates.",
  },

  // --------------------------------------------------------------------- World
  {
    slug: "world-conflict",
    label: "Conflict & Security",
    emoji: "🛡️",
    group: "World",
    description:
      "Wars and armed conflict, military operations, defense and national security, ceasefires and peace negotiations, geopolitical tension.",
  },
  {
    slug: "international-affairs",
    label: "International Affairs",
    emoji: "🌐",
    group: "World",
    description:
      "Diplomacy and foreign policy, international summits, treaties and sanctions, the United Nations, alliances and global governance.",
  },
  {
    slug: "asia",
    label: "Asia",
    emoji: "🌏",
    group: "World",
    description:
      "News from China, Japan, India, Korea and Southeast Asia, regional politics, economies and society across the Asia Pacific.",
  },
  {
    slug: "europe",
    label: "Europe",
    emoji: "🇪🇺",
    group: "World",
    description:
      "European Union politics, elections and governments across Europe, the United Kingdom, regional economy and policy.",
  },

  // -------------------------------------------------------------------- Sports
  {
    slug: "basketball",
    label: "Basketball",
    emoji: "🏀",
    group: "Sports",
    description:
      "NBA games and playoffs, college basketball, trades and drafts, player performance, coaching and team standings.",
  },
  {
    slug: "football-nfl",
    label: "Football (NFL)",
    emoji: "🏈",
    group: "Sports",
    description:
      "NFL games and playoffs, the Super Bowl, college football, quarterbacks, drafts, trades and team standings.",
  },
  {
    slug: "soccer",
    label: "Soccer",
    emoji: "⚽",
    group: "Sports",
    description:
      "International soccer and football, Premier League, Champions League, World Cup, transfers, managers and match results.",
  },
  {
    slug: "baseball",
    label: "Baseball",
    emoji: "⚾",
    group: "Sports",
    description:
      "Major League Baseball, the World Series, pitching and batting performance, trades and team standings.",
  },
  {
    slug: "olympic-sports",
    label: "Tennis, Golf & Olympics",
    emoji: "🎾",
    group: "Sports",
    description:
      "Tennis grand slams, golf tournaments and majors, Olympic events, track and field, swimming and individual sports.",
  },

  // ------------------------------------------------------------------- Culture
  {
    slug: "film-tv",
    label: "Film & Television",
    emoji: "🎬",
    group: "Culture",
    description:
      "Movies and television series, streaming releases, box office, directors and actors, reviews, awards and film festivals.",
  },
  {
    slug: "music",
    label: "Music",
    emoji: "🎵",
    group: "Culture",
    description:
      "Album releases, artists and bands, concerts and touring, music industry business, streaming and charts.",
  },
  {
    slug: "books-ideas",
    label: "Books & Ideas",
    emoji: "📚",
    group: "Culture",
    description:
      "Books and authors, literary criticism and reviews, publishing, essays, philosophy and intellectual debate.",
  },
  {
    slug: "gaming",
    label: "Gaming",
    emoji: "🎮",
    group: "Culture",
    description:
      "Video games, game releases and reviews, consoles and PC gaming, esports, game studios and the games industry.",
  },
  {
    slug: "art-design",
    label: "Art & Design",
    emoji: "🎨",
    group: "Culture",
    description:
      "Visual art and exhibitions, museums and galleries, architecture, graphic and industrial design, photography.",
  },

  // ----------------------------------------------------------------- Lifestyle
  {
    slug: "food-drink",
    label: "Food & Drink",
    emoji: "🍽️",
    group: "Lifestyle",
    description:
      "Restaurants and chefs, recipes and cooking, food culture and trends, coffee, wine and the drinks industry.",
  },
  {
    slug: "travel",
    label: "Travel",
    emoji: "✈️",
    group: "Lifestyle",
    description:
      "Destinations and travel guides, airlines and flights, hotels, tourism industry and travel disruption.",
  },
  {
    slug: "personal-finance",
    label: "Personal Finance",
    emoji: "💰",
    group: "Lifestyle",
    description:
      "Saving and budgeting, retirement accounts, taxes, credit and debt, consumer spending and financial planning advice.",
  },
  {
    slug: "science-curiosities",
    label: "Curiosities & Explainers",
    emoji: "💡",
    group: "Lifestyle",
    description:
      "Explainers, surprising findings, history and archaeology, unusual discoveries and long-form curiosity pieces.",
  },
];

/** Sort order is derived from position within the group, so the data stays terse. */
export function interestsWithOrder(): (InterestSeed & { sortOrder: number })[] {
  const counters = new Map<string, number>();
  return INTERESTS.map((interest) => {
    const next = (counters.get(interest.group) ?? 0) + 1;
    counters.set(interest.group, next);
    return { ...interest, sortOrder: next };
  });
}
