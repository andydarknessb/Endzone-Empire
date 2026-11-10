import fs from 'fs';
import path from 'path';
import { listArticles, getArticle, featuredArticles, relatedArticles, currentReport } from './index';
import { findLocalDeclarations, SHARED_PART_NAMES } from './kitGuard';
import * as parts from './darkness-report-parts';

describe('articles content module', () => {
  it('lists metadata for every article, newest first, without a Body', () => {
    const list = listArticles();
    expect(list.length).toBeGreaterThanOrEqual(4);
    for (const meta of list) {
      expect(meta).toEqual(
        expect.objectContaining({
          slug: expect.any(String),
          title: expect.any(String),
          category: expect.any(String),
          excerpt: expect.any(String),
          readMinutes: expect.any(Number),
          date: expect.any(String),
        })
      );
      expect(meta.Body).toBeUndefined(); // metadata only
    }
    // Sorted descending by date.
    const dates = list.map((m) => new Date(m.date).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  // Bodies are the bulk of the content and only one is ever read at a time,
  // so the module hands out metadata eagerly and the Body behind an async
  // loader: a listing (landing band, UserPage highlights, strategy index)
  // costs no article prose in the initial bundle.
  it('returns the article metadata plus an async body loader by slug, never an eager Body', async () => {
    const slug = listArticles()[0].slug;
    const article = getArticle(slug);
    expect(article).not.toBeNull();
    expect(article.Body).toBeUndefined();
    expect(typeof article.loadBody).toBe('function');
    const Body = await article.loadBody();
    expect(typeof Body).toBe('function');
  });

  it('every article body loads and is a component', async () => {
    for (const meta of listArticles()) {
      const Body = await getArticle(meta.slug).loadBody();
      expect(typeof Body).toBe('function');
    }
  });

  it('returns null for an unknown slug', () => {
    expect(getArticle('does-not-exist')).toBeNull();
  });

  it('names a series on every Darkness Report', () => {
    const reports = listArticles().filter((meta) => meta.slug.endsWith('-darkness-report'));
    expect(reports.length).toBeGreaterThan(0);
    for (const meta of reports) {
      expect(['waiver-wire', 'start-sit']).toContain(meta.series);
      // A meta copied from the other series keeps its tag; the slug catches it.
      expect(meta.slug).toContain(meta.series);
    }
  });

  // No slugs here: a new report every week would otherwise mean a test edit every week.
  it('currentReport returns the newest Darkness Report of a series, or null', () => {
    for (const series of ['waiver-wire', 'start-sit']) {
      const current = currentReport(series);
      const reports = listArticles().filter((meta) => meta.series === series);
      expect(reports).toContainEqual(current);
      for (const meta of reports) expect(Date.parse(meta.date)).toBeLessThanOrEqual(Date.parse(current.date));
    }
    expect(currentReport('nonsense')).toBeNull();
  });

  it('registers the Week 2 recap with the requested byline and a lazy body', async () => {
    const article = getArticle('preseason-week-2-recap');
    expect(article).toEqual(
      expect.objectContaining({
        title: 'NFL Preseason Week 2 Recap: Draft Stock, Rookie Breakouts, and Injury Fallout',
        author: 'Andy Darkness',
        date: '2026-08-24',
      })
    );
    expect(typeof await article.loadBody()).toBe('function');
  });

  it('registers the Week 3 recap with the requested byline and a lazy body', async () => {
    const article = getArticle('preseason-week-3-recap');
    expect(article).toEqual(
      expect.objectContaining({
        title: 'NFL Preseason Week 3 Recap: Cutdown Fallout and Final Draft Moves',
        author: 'Andy Darkness',
        date: '2026-09-01',
      })
    );
    expect(typeof await article.loadBody()).toBe('function');
  });

  it('featuredArticles caps the count', () => {
    expect(featuredArticles(3)).toHaveLength(3);
    expect(featuredArticles(2)).toHaveLength(2);
  });

  it('relatedArticles excludes the current slug and returns metadata', () => {
    const slug = listArticles()[0].slug;
    const related = relatedArticles(slug, 3);
    expect(related.length).toBeLessThanOrEqual(3);
    expect(related.map((r) => r.slug)).not.toContain(slug);
  });
});

// The four article decorations live in the public kit now, and the shared
// layout parts live in darkness-report-parts.jsx. A local copy in a new article
// drifts from them silently, and the published weeks 3 to 9 are frozen, so the
// kit names are guarded from week 9 and the shared parts from week 10.
describe('local declaration guard', () => {
  it('reports a locally declared Pill in a week 9 article', () => {
    expect(findLocalDeclarations('week9-start-sit-darkness-report.jsx', 'const Pill = () => null;\n'))
      .toEqual([{ name: 'Pill', line: 1 }]);
  });

  it('exempts the published weeks 3 to 8 by week number', () => {
    expect(findLocalDeclarations('week8-waiver-wire-darkness-report.jsx', 'const Tag = () => null;')).toEqual([]);
    expect(findLocalDeclarations('week3-start-sit-darkness-report.jsx', 'const Pill = () => null;')).toEqual([]);
  });

  it('reports a shared part declared in a future week', () => {
    expect(findLocalDeclarations('week10-start-sit-darkness-report.jsx', 'function SplitBar() {\n  return null;\n}\n'))
      .toEqual([{ name: 'SplitBar', line: 1 }]);
  });

  it('exempts weeks 3 to 9 from the shared parts', () => {
    expect(findLocalDeclarations('week9-waiver-wire-darkness-report.jsx', 'function BidTrack() {}')).toEqual([]);
    expect(findLocalDeclarations('week3-start-sit-darkness-report.jsx', 'function SplitBar() {}')).toEqual([]);
  });

  it('guards every export of the shared parts module', () => {
    expect(Object.keys(parts).sort()).toEqual([...SHARED_PART_NAMES].sort());
  });

  it('finds no local declaration in any article file', () => {
    const dir = __dirname;
    const files = fs.readdirSync(dir).filter((file) => file.endsWith('.jsx'));
    const sources = files.map((file) => {
      // readdirSync returns bare names, so this join cannot leave the directory.
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- readdirSync names cannot contain a path separator
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      return { file, violations: findLocalDeclarations(file, source) };
    });
    expect(sources).not.toHaveLength(0);
    expect(sources.filter((s) => s.violations.length > 0)).toEqual([]);
  });
});
