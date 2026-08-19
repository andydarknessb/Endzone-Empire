/**
 * Strategy-article content module.
 *
 * Articles are typed JSX (two files per article: `<slug>.meta.js` holds the
 * frontmatter as plain fields, `<slug>.jsx` the Body component built from the
 * Prose primitives) — deliberately NOT MDX, which CRA can't load without
 * ejecting. Everything is accessed ONLY through the functions below, so a
 * future DB-backed CMS can replace this one file without touching any page.
 *
 * Only the frontmatter is imported here. Bodies are the bulk of the content
 * and one is read at a time, so `getArticle` hands out `loadBody()`, a dynamic
 * import, and a listing (landing band, UserPage highlights, strategy index)
 * puts no article prose in the initial bundle.
 *
 * Article shape: { slug, title, category, excerpt, readMinutes, date, author?, loadBody }.
 */
import draftByTiers from './draft-by-tiers.meta';
import waiverPriorityVsFaab from './waiver-priority-vs-faab.meta';
import readingTradeValue from './reading-trade-value.meta';
import streamingDefenseAndKicker from './streaming-defense-and-kicker.meta';
import playoffPrep from './playoff-prep.meta';
import preseasonWeek1Recap from './preseason-week-1-recap.meta';

// One loader per article, keyed by slug. Literal import() calls so the
// bundler can split one chunk per body.
const BODY_LOADERS = {
  'draft-by-tiers': () => import('./draft-by-tiers'),
  'waiver-priority-vs-faab': () => import('./waiver-priority-vs-faab'),
  'reading-trade-value': () => import('./reading-trade-value'),
  'streaming-defense-and-kicker': () => import('./streaming-defense-and-kicker'),
  'playoff-prep': () => import('./playoff-prep'),
  'preseason-week-1-recap': () => import('./preseason-week-1-recap'),
};

// Newest first.
const ARTICLES = [
  draftByTiers,
  waiverPriorityVsFaab,
  readingTradeValue,
  streamingDefenseAndKicker,
  playoffPrep,
  preseasonWeek1Recap,
].sort((a, b) => new Date(b.date) - new Date(a.date));

const META_KEYS = ['slug', 'title', 'category', 'excerpt', 'readMinutes', 'date', 'author'];

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

/**
 * The article for a slug, or null: its metadata plus `loadBody()`, which
 * resolves to the Body component (a dynamic import; call it when the prose
 * is about to be shown, typically through React.lazy).
 */
export function getArticle(slug) {
  const meta = ARTICLES.find((a) => a.slug === slug);
  if (!meta) return null;
  const loader = BODY_LOADERS[slug];
  return { ...meta, loadBody: () => loader().then((mod) => mod.default) };
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
