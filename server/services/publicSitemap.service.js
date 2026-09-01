const pool = require('../modules/pool');
const {
  RECAPS_TABLE_SQL,
  isMissingRecapStorage,
} = require('../modules/recapStorage');

const SITE_ORIGIN = 'https://endzoneempire.gg';
const MAX_SITEMAP_URLS = 50_000;

// Concrete, indexable public pages. Parameterized player and recap URLs are
// appended from the league-free public tables below.
const STATIC_PUBLIC_PATHS = [
  '/rankings',
  '/draft-simulator',
  '/waiver-wire',
  '/strategy',
  '/strategy/draft-by-tiers',
  '/strategy/waiver-priority-vs-faab',
  '/strategy/reading-trade-value',
  '/strategy/streaming-defense-and-kicker',
  '/strategy/playoff-prep',
  '/strategy/preseason-week-1-recap',
  '/strategy/preseason-week-2-recap',
  '/strategy/preseason-week-3-recap',
  '/strategy/rookie-draft-round-guide',
  '/recaps',
];

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function lastModified(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function getSitemapEntries() {
  const playerResult = await pool.query(
    `SELECT "id" FROM "players" WHERE "id" IS NOT NULL ORDER BY "id"`
  );

  let recapRows = [];
  try {
    const recapResult = await pool.query(
      `SELECT "tank01_game_id", "final_at"
       FROM ${RECAPS_TABLE_SQL}
       ORDER BY "final_at" DESC NULLS LAST, "tank01_game_id"`
    );
    recapRows = recapResult.rows;
  } catch (error) {
    if (!isMissingRecapStorage(error)) throw error;
  }

  const entries = [
    ...STATIC_PUBLIC_PATHS.map((path) => ({ path })),
    ...playerResult.rows.map((row) => ({ path: `/players/${encodeURIComponent(row.id)}` })),
    ...recapRows.map((row) => ({
      path: `/recaps/${encodeURIComponent(row.tank01_game_id)}`,
      lastmod: lastModified(row.final_at),
    })),
  ];

  const seen = new Set();
  return entries
    .filter(({ path }) => {
      if (seen.has(path)) return false;
      seen.add(path);
      return true;
    })
    .slice(0, MAX_SITEMAP_URLS);
}

function buildSitemapXml(entries) {
  const urls = entries.map(({ path, lastmod }) => {
    const loc = `${SITE_ORIGIN}${path}`;
    const modified = lastmod ? `\n    <lastmod>${escapeXml(lastmod)}</lastmod>` : '';
    return `  <url>\n    <loc>${escapeXml(loc)}</loc>${modified}\n  </url>`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

module.exports = {
  SITE_ORIGIN,
  STATIC_PUBLIC_PATHS,
  getSitemapEntries,
  buildSitemapXml,
  escapeXml,
};
