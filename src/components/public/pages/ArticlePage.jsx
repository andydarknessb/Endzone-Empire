import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import {
  Box, Breadcrumbs, Card, CardContent, Chip, Divider, LinearProgress, Link,
  Skeleton, Stack, Typography,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import PublicLayout from '../PublicLayout';
import PublicSeo from '../PublicSeo';
import Prose from '../kit/Prose';
import ArticleCard from '../kit/ArticleCard';
import SectionHeading from '../kit/SectionHeading';
import { EmptyState } from '../kit/DataState';
import { getArticle, relatedArticles } from '../../../content/articles';

function formatDate(date) {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function ReadingProgress({ articleRef }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = null;
    const update = () => {
      frame = null;
      const node = articleRef.current;
      if (!node) return;
      const start = node.getBoundingClientRect().top + window.scrollY - 96;
      const distance = Math.max(node.offsetHeight - window.innerHeight * 0.65, 1);
      setProgress(Math.min(100, Math.max(0, ((window.scrollY - start) / distance) * 100)));
    };
    const schedule = () => {
      if (frame == null) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame != null) window.cancelAnimationFrame(frame);
    };
  }, [articleRef]);

  return (
    <LinearProgress
      variant="determinate"
      value={progress}
      aria-label="Article reading progress"
      sx={{
        position: 'fixed',
        inset: '0 0 auto 0',
        height: 3,
        zIndex: (theme) => theme.zIndex.appBar + 1,
        bgcolor: 'transparent',
        '& .MuiLinearProgress-bar': { transition: 'transform var(--transition-fast) linear' },
        '@media (prefers-reduced-motion: reduce)': { '& .MuiLinearProgress-bar': { transition: 'none' } },
      }}
    />
  );
}

// `renderedSlug` is the article whose lazily loaded body is on the page; the
// headings are read only once it matches `slug`, so during a hop the TOC
// empties instead of listing the previous article's (about-to-vanish) ids.
function ArticleToc({ articleRef, slug, renderedSlug }) {
  const [headings, setHeadings] = useState([]);

  useEffect(() => {
    if (renderedSlug !== slug) {
      setHeadings([]);
      return;
    }
    const nodes = articleRef.current ? [...articleRef.current.querySelectorAll('h2[id]')] : [];
    setHeadings(nodes.map((node) => ({ id: node.id, title: node.textContent })));
  }, [articleRef, slug, renderedSlug]);

  if (headings.length < 2) return null;
  return (
    <Card component="nav" variant="outlined" aria-label="Table of contents" sx={{ position: { md: 'sticky' }, top: { md: 88 } }}>
      <CardContent>
        <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 800 }}>On this page</Typography>
        <Stack spacing={1.25} sx={{ mt: 1 }}>
          {headings.map((heading) => (
            <Link key={heading.id} href={`#${heading.id}`} underline="hover" sx={{ color: 'text.secondary', fontSize: '0.875rem', fontWeight: 600 }}>
              {heading.title}
            </Link>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}

// Mounts with the body once its Suspense boundary resolves, so the effect
// runs after the prose is in the DOM (and the TOC can read its headings).
// Keyed by slug at the call site so an in-app hop to another article
// remounts it and fires again for that article's body.
function BodyRendered({ onRendered }) {
  useEffect(() => {
    onRendered();
  }, [onRendered]);
  return null;
}

function ArticlePage() {
  const { slug } = useParams();
  const articleRef = useRef(null);
  const article = getArticle(slug);
  // The body is not in the initial bundle: it is fetched when this page
  // renders it (one chunk per article, see content/articles/index.js).
  const Body = useMemo(
    () => (article ? lazy(() => article.loadBody().then((component) => ({ default: component }))) : null),
    // A new slug is a new article; loadBody is stable per article.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slug],
  );
  const [renderedSlug, setRenderedSlug] = useState(null);
  const handleBodyRendered = useCallback(() => setRenderedSlug(slug), [slug]);

  if (!article) {
    return (
      <PublicLayout maxWidth="md" ctaContext="strategy">
        <PublicSeo
          title="Strategy Article Not Found"
          description="This Endzone Empire fantasy football strategy article could not be found."
          path={`/strategy/${encodeURIComponent(slug)}`}
          noIndex
        />
        <EmptyState message="That article doesn't exist." hint="Browse the strategy hub for the full library." />
      </PublicLayout>
    );
  }

  const { title, category, date, readMinutes } = article;
  const related = relatedArticles(slug, 3);

  return (
    <PublicLayout maxWidth="lg" ctaContext="strategy">
      <PublicSeo
        title={title}
        description={article.excerpt}
        path={`/strategy/${encodeURIComponent(slug)}`}
        type="article"
        imageAlt={`${title} from Endzone Empire`}
      />
      <ReadingProgress articleRef={articleRef} />
      <Breadcrumbs aria-label="Breadcrumb" sx={{ mb: 3 }}>
        <Link component={RouterLink} to="/strategy" underline="hover">Strategy</Link>
        <Typography color="text.primary">{title}</Typography>
      </Breadcrumbs>

      <Grid container spacing={4} alignItems="flex-start">
        <Grid xs={12} md={3} sx={{ order: { xs: 2, md: 1 } }}>
          <ArticleToc articleRef={articleRef} slug={slug} renderedSlug={renderedSlug} />
        </Grid>
        <Grid xs={12} md={9} sx={{ order: { xs: 1, md: 2 } }}>
          <Box component="article" ref={articleRef} sx={{ maxWidth: 720 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
              {category && <Chip label={category} size="small" color="primary" variant="outlined" />}
            </Stack>
            <Typography variant="h2" component="h1" sx={{ fontWeight: 800, mb: 1.5 }}>{title}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
              {article.author ? `${article.author} · ` : 'Endzone Empire · '}{formatDate(date)} · {readMinutes} min read
            </Typography>
            <Prose sx={{ '& h2': { scrollMarginTop: 92 } }}>
              <Suspense
                fallback={(
                  <Box aria-busy="true" aria-label="Loading article">
                    <Skeleton variant="text" width="90%" height={28} />
                    <Skeleton variant="text" width="100%" />
                    <Skeleton variant="text" width="95%" />
                    <Skeleton variant="text" width="60%" />
                  </Box>
                )}
              >
                <Body />
                <BodyRendered key={slug} onRendered={handleBodyRendered} />
              </Suspense>
            </Prose>
          </Box>
        </Grid>
      </Grid>

      {related.length > 0 && (
        <Box sx={{ mt: 8 }}>
          <Divider sx={{ mb: 4 }} />
          <SectionHeading title="Related articles" variant="h5" />
          <Grid container spacing={3}>
            {related.map((relatedArticle) => (
              <Grid xs={12} sm={6} md={4} key={relatedArticle.slug}>
                <ArticleCard article={relatedArticle} />
              </Grid>
            ))}
          </Grid>
        </Box>
      )}
    </PublicLayout>
  );
}

export default ArticlePage;
