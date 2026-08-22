import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Card, CardActionArea, CardContent, Chip, Stack, Typography, Box } from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';

/**
 * A strategy-article summary card: category chip, title, excerpt, read time.
 * Links internally (public BrowserRouter) to /strategy/:slug. The optional
 * `Icon` + `featured` props support the waiver-wire feature-grid style.
 */
function ArticleCard({ article, Icon, featured = false }) {
  const { slug, title, category, excerpt, readMinutes } = article;
  return (
    <Card
      variant="outlined"
      sx={featured ? {
        height: '100%',
        minHeight: { md: 260 },
        bgcolor: 'var(--accent-soft)',
        borderColor: 'var(--border-strong)',
      } : { height: '100%' }}
    >
      <CardActionArea
        component={RouterLink}
        to={`/strategy/${slug}`}
        sx={{ height: '100%', alignItems: 'stretch' }}
      >
        <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column', gap: featured ? 2 : 1, p: featured ? { xs: 3, md: 5 } : undefined }}>
          <Stack direction="row" spacing={1} alignItems="center">
            {Icon && (
              <Box
                aria-hidden="true"
                sx={{
                  display: 'grid',
                  placeItems: 'center',
                  width: 36,
                  height: 36,
                  borderRadius: 'var(--radius-md)',
                  bgcolor: 'var(--accent-soft)',
                  color: 'var(--accent)',
                }}
              >
                <Icon fontSize="small" />
              </Box>
            )}
            {category && <Chip label={category} size="small" color="primary" variant="outlined" />}
          </Stack>
          <Typography variant={featured ? 'h3' : 'h6'} component="h3" sx={{ fontWeight: featured ? 800 : 700, maxWidth: featured ? 720 : undefined }}>
            {title}
          </Typography>
          <Typography variant={featured ? 'body1' : 'body2'} sx={{ color: 'text.secondary', flexGrow: 1, maxWidth: featured ? 760 : undefined }}>
            {excerpt}
          </Typography>
          {readMinutes != null && (
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: 'text.secondary', mt: 0.5 }}>
              <AccessTimeIcon sx={{ fontSize: 15 }} aria-hidden="true" />
              <Typography variant="caption">{readMinutes} min read</Typography>
            </Stack>
          )}
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

export default ArticleCard;
