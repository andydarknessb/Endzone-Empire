import fs from 'fs';
import path from 'path';
import { listArticles, getArticle, featuredArticles, relatedArticles } from './index';
import { findLocalKitDeclarations } from './kitGuard';

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

// The four article decorations live in the public kit now. A local copy in a
// new article drifts from it silently, and the published weeks 3 to 8 are
// frozen with theirs, so the guard starts at week 9.
describe('kit guard', () => {
  it('reports a locally declared Pill in a week 9 article', () => {
    expect(findLocalKitDeclarations('week9-start-sit-darkness-report.jsx', 'const Pill = () => null;\n'))
      .toEqual([{ name: 'Pill', line: 1 }]);
  });

  it('exempts the published weeks 3 to 8 by week number', () => {
    expect(findLocalKitDeclarations('week8-waiver-wire-darkness-report.jsx', 'const Tag = () => null;')).toEqual([]);
    expect(findLocalKitDeclarations('week3-start-sit-darkness-report.jsx', 'const Pill = () => null;')).toEqual([]);
  });

  it('finds no local declaration in any article file', () => {
    const dir = __dirname;
    const sources = fs.readdirSync(dir)
      .filter((file) => file.endsWith('.jsx'))
      .map((file) => ({ file, violations: findLocalKitDeclarations(file, fs.readFileSync(path.join(dir, file), 'utf8')) }));
    expect(sources).not.toHaveLength(0);
    expect(sources.filter((s) => s.violations.length > 0)).toEqual([]);
  });
});
