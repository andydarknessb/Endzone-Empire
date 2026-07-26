import React from 'react';
import { Box, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import PublicLayout from '../PublicLayout';
import PublicSeo from '../PublicSeo';
import ArticleCard from '../kit/ArticleCard';
import { listArticles } from '../../../content/articles';

/**
 * Strategy hub: a featured lead article plus a grid of the rest. Content is
 * static (typed-JSX module), so this never has a loading/error state.
 */
function StrategyIndexPage() {
  const articles = listArticles();
  const [featured, ...rest] = articles;

  return (
    <PublicLayout ctaContext="strategy">
      <PublicSeo
        title="Fantasy Football Strategy"
        description="Evergreen fantasy football strategy for drafting, waivers, trades, lineup decisions, and the playoff run."
        path="/strategy"
      />
      <Box sx={{ mb: 4 }}>
        <Typography variant="h3" component="h1" sx={{ fontWeight: 800 }}>Fantasy Football Strategy</Typography>
        <Typography variant="body1" sx={{ color: 'text.secondary', mt: 1, maxWidth: 720 }}>
          Evergreen tactics for drafting, waivers, trades, and the playoff run, written to help you win
          your league, whatever platform you play on.
        </Typography>
      </Box>

      {featured && (
        <Box sx={{ mb: 3 }}>
          <ArticleCard article={featured} featured />
        </Box>
      )}

      <Grid container spacing={3}>
        {rest.map((article) => (
          <Grid xs={12} sm={6} md={4} key={article.slug}>
            <ArticleCard article={article} />
          </Grid>
        ))}
      </Grid>
    </PublicLayout>
  );
}

export default StrategyIndexPage;
