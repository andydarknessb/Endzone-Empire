import React from 'react';
import { Box, Typography } from '@mui/material';

/**
 * The Decision card's news list (CONTEXT.md's News: "Shown on the Decision
 * card in every Availability context except your own player"). `news[]`
 * (`server/services/playerCard.service.js`: the ESPN list when present, the
 * feed sync's single note as the one fallback item, ADR 0040's Plan) - the
 * caller decides whether the context calls for it (my_team never does); this
 * component just hides on an empty list rather than assuming.
 */
export default function NewsList({ news }) {
  if (!Array.isArray(news) || news.length === 0) return null;
  return (
    <Box data-testid="decision-card-news" component="ul" role="list" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1 }}>
      {news.map((item, i) => (
        // eslint-disable-next-line react/no-array-index-key -- no stable id on a news item
        <Box component="li" key={i} sx={{ borderBottom: '1px solid var(--border-subtle)', pb: 1 }}>
          <Typography sx={{ fontSize: 13 }}>{item.headline}</Typography>
          {item.publishedAt && (
            <Typography sx={{ fontSize: 11, color: 'var(--text-muted)', mt: 0.25 }}>
              {new Date(item.publishedAt).toLocaleDateString()}
            </Typography>
          )}
        </Box>
      ))}
    </Box>
  );
}
