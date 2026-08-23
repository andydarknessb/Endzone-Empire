/** @jest-environment node */

// Guards the client/server agreement Cory ruled on for #75: the sitemap
// service keeps a hardcoded STATIC_PUBLIC_PATHS list (deriving it would
// couple the server to this client content module), so instead this test
// fails the moment the two drift, in EITHER direction. This is the same
// parity-test idiom server/test/leaguePhase.test.js uses for the client/server
// league-phase contract.
//
// It lives beside the content module (not in server/test) so the tenant's
// checks.unit (`npm test`, which only searches src/) and CI's `npm test`
// step both run it; only server/test/*.test.js run under `npm run
// test:server`. The server module is required directly (Jest transforms
// CommonJS fine); its only non-pure dependency is the pg-backed pool module,
// which is stubbed the same way src/lib/lineupLockTimeline.integration.test.js
// and src/lib/multiSeasonRollover.integration.test.js already stub it, rather
// than moving the content module or building a manifest.
jest.mock('../../../server/modules/pool', () => ({ query: jest.fn() }));

const { STATIC_PUBLIC_PATHS } = require('../../../server/services/publicSitemap.service');
const { listArticles } = require('./index');

describe('sitemap strategy paths <-> content module parity (#75)', () => {
  it('STATIC_PUBLIC_PATHS has exactly one /strategy/<slug> entry per listArticles() slug, in both directions', () => {
    const sitemapSlugs = new Set(
      STATIC_PUBLIC_PATHS
        .filter((path) => path.startsWith('/strategy/'))
        .map((path) => path.slice('/strategy/'.length))
    );
    const contentSlugs = new Set(listArticles().map((article) => article.slug));

    expect(sitemapSlugs.size).toBeGreaterThan(0);
    expect(contentSlugs.size).toBeGreaterThan(0);

    // A slug the content module has but the sitemap doesn't: the #75 bug
    // (preseason-week-1-recap shipped 2026-08-18 without a sitemap entry).
    const missingFromSitemap = [...contentSlugs].filter((slug) => !sitemapSlugs.has(slug));
    // A slug the sitemap still lists after an article was renamed or removed.
    const staleInSitemap = [...sitemapSlugs].filter((slug) => !contentSlugs.has(slug));

    expect(missingFromSitemap).toEqual([]);
    expect(staleInSitemap).toEqual([]);
  });
});
