import { listArticles, getArticle, featuredArticles, relatedArticles } from './index';

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
