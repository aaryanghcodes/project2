/**
 * Keywords and named entities for each article.
 *
 * These are metadata, not ranking inputs. Ranking runs on embeddings, which
 * capture meaning that keyword overlap does not — an article about "the
 * central bank held rates" and one about "the Fed paused" share almost no
 * words. What keywords and entities are good for is the things embeddings are
 * bad at: showing a reader *why* something surfaced, filtering a saved list,
 * and giving a future collaborative-filtering layer a cheap join key.
 *
 * Deliberately statistical rather than a model. A real NER model would be more
 * accurate, but it would add a second model to every ingest run for metadata
 * that is not in the ranking path. This is the cheap 80%.
 */

/** Words too common to carry meaning, plus news-copy filler. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "than", "that", "this",
  "these", "those", "of", "in", "on", "at", "to", "for", "with", "by", "from",
  "as", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
  "do", "does", "did", "will", "would", "could", "should", "may", "might",
  "can", "not", "no", "nor", "so", "such", "it", "its", "he", "she", "they",
  "them", "their", "his", "her", "we", "our", "you", "your", "i", "me", "my",
  "who", "whom", "which", "what", "when", "where", "why", "how", "all", "any",
  "both", "each", "few", "more", "most", "other", "some", "only", "own", "same",
  "too", "very", "just", "also", "after", "before", "during", "while", "about",
  "into", "over", "under", "up", "down", "out", "off", "again", "further",
  "there", "here", "one", "two", "first", "last", "new", "old", "said", "says",
  "told", "according", "reported", "report", "week", "year", "day", "time",
  "make", "made", "get", "got", "go", "going", "come", "came", "take", "taken",
  "see", "seen", "know", "known", "think", "want", "use", "used", "way", "like",
]);

/**
 * Words that look like entities because they are capitalised, but are not.
 * Sentence-initial words are the main source of noise in this approach.
 */
const NON_ENTITIES = new Set([
  "The", "A", "An", "But", "And", "If", "It", "In", "On", "At", "For", "This",
  "That", "These", "Those", "There", "Here", "When", "While", "After", "Before",
  "However", "Meanwhile", "Instead", "Still", "Yet", "So", "Now", "Then",
  "They", "He", "She", "We", "You", "I", "His", "Her", "Their", "Our", "My",
  "Mr", "Mrs", "Ms", "Dr", "Monday", "Tuesday", "Wednesday", "Thursday",
  "Friday", "Saturday", "Sunday",
]);

export const MAX_KEYWORDS = 8;
export const MAX_ENTITIES = 8;

/**
 * Capitalised runs, which in news copy are overwhelmingly people,
 * organisations, and places.
 *
 * Sentence-initial capitals are the obvious false positive; NON_ENTITIES
 * catches the common ones, and requiring either a multi-word run or a
 * non-sentence-initial position catches most of the rest.
 */
export function extractEntities(text: string): string[] {
  const counts = new Map<string, number>();

  // Split into sentences first so we can tell "Apple said" (entity) from
  // "Apple" opening a sentence about fruit.
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const words = sentence.split(/\s+/);

    let run: string[] = [];
    const flush = (startedSentence: boolean) => {
      if (run.length === 0) return;
      // A single capitalised word at the start of a sentence is not evidence
      // of anything; a multi-word run is.
      if (run.length > 1 || !startedSentence) {
        const phrase = run.join(" ").replace(/[^\w\s&'’-]/g, "").trim();
        if (phrase.length > 2 && !NON_ENTITIES.has(phrase)) {
          counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
        }
      }
      run = [];
    };

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const bare = word.replace(/[^\w&'’-]/g, "");
      const capitalised = /^[A-Z][\w&'’-]*$/.test(bare) && bare.length > 1;

      if (capitalised && !NON_ENTITIES.has(bare)) {
        run.push(bare);
      } else {
        flush(i - run.length === 0);
        // Punctuation ends a run even when the next word is capitalised.
        if (!capitalised) run = [];
      }
    }
    flush(words.length - run.length === 0);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_ENTITIES)
    .map(([phrase]) => phrase);
}

/**
 * Content words weighted by frequency, with a bonus for appearing in the
 * title.
 *
 * Title terms get the bonus because a headline is the one part of an article
 * a human already compressed for us — a word the editor chose to spend
 * headline space on is worth more than one that happened to recur in
 * paragraph six.
 */
export function extractKeywords(title: string, body: string): string[] {
  const titleWords = new Set(
    title.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [],
  );

  const counts = new Map<string, number>();
  const words = `${title} ${body}`.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [];

  for (const word of words) {
    if (STOPWORDS.has(word) || word.length < 4) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([word, count]) => ({
      word,
      weight: count + (titleWords.has(word) ? 3 : 0),
    }))
    .filter((entry) => entry.weight > 1)
    .sort((a, b) => b.weight - a.weight || a.word.localeCompare(b.word))
    .slice(0, MAX_KEYWORDS)
    .map((entry) => entry.word);
}

export function extractMetadata(article: {
  title: string;
  description?: string | null;
  contentSnippet?: string | null;
}): { keywords: string[]; entities: string[] } {
  const body = [article.description ?? "", article.contentSnippet ?? ""]
    .join(" ")
    .trim();

  return {
    keywords: extractKeywords(article.title, body),
    entities: extractEntities(`${article.title}. ${body}`),
  };
}
