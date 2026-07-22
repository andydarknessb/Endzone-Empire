/**
 * Strategy-article content module.
 *
 * Articles are typed JSX (one file per article, frontmatter as plain fields +
 * a Body component built from the Prose primitives) — deliberately NOT MDX,
 * which CRA can't load without ejecting. Everything is accessed ONLY through
 * the functions below, so a future DB-backed CMS can replace this one file
 * without touching any page.
 *
 * Article shape: { slug, title, category, excerpt, readMinutes, date, Body }.
 */
import draftByTiers from './draft-by-tiers';
import waiverPriorityVsFaab from './waiver-priority-vs-faab';
import readingTradeValue from './reading-trade-value';
import streamingDefenseAndKicker from './streaming-defense-and-kicker';
import playoffPrep from './playoff-prep';

// Newest first.
const ARTICLES = [
  draftByTiers,
  waiverPriorityVsFaab,
  readingTradeValue,
  streamingDefenseAndKicker,
  playoffPrep,
].sort((a, b) => new Date(b.date) - new Date(a.date));

const META_KEYS = ['slug', 'title', 'category', 'excerpt', 'readMinutes', 'date'];

/** Metadata-only view (no Body) for cards and listings. */
function toMeta(article) {
  const meta = {};
  for (const key of META_KEYS) meta[key] = article[key];
  return meta;
}

/** All articles as metadata, newest first. */
export function listArticles() {
  return ARTICLES.map(toMeta);
}

/** The full article (incl. Body component) for a slug, or null. */
export function getArticle(slug) {
  return ARTICLES.find((a) => a.slug === slug) || null;
}

/** First `n` articles as metadata (for the landing teaser + featured slots). */
export function featuredArticles(n = 3) {
  return listArticles().slice(0, n);
}

/** Up to `n` other articles, same category first, for a "Related" strip. */
export function relatedArticles(slug, n = 3) {
  const current = getArticle(slug);
  if (!current) return [];
  const clusters = {
    Waivers: ['Waivers', 'Streaming', 'Playoffs'],
    Streaming: ['Streaming', 'Waivers', 'Playoffs'],
    Playoffs: ['Playoffs', 'Streaming', 'Waivers'],
  };
  const preferred = clusters[current.category] || [current.category];
  const others = ARTICLES.filter((a) => a.slug !== slug);
  others.sort((a, b) => {
    const aIndex = preferred.indexOf(a.category);
    const bIndex = preferred.indexOf(b.category);
    const aPriority = aIndex === -1 ? preferred.length : aIndex;
    const bPriority = bIndex === -1 ? preferred.length : bIndex;
    return aPriority - bPriority;
  });
  return others.slice(0, n).map(toMeta);
}
