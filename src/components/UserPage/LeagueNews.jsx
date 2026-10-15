import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box } from '@mui/material';
import { formatInstant } from '../../shared/lib/instantFormat';
import { ErrorPanel, Frame, FrameHead, PixelHeading, Skel } from '../../shared/ui/playselect';

const rowSx = {
  display: 'block', padding: '12px 0', color: 'inherit', textDecoration: 'none',
};

/**
 * The "League news" frame (build-main.js): what already happened, newest
 * first, from the shared notifications read. A row links to its league when the
 * notification carries a league id. `awaiting` and `error` stand in only for a
 * list we don't have; with nothing to show the frame is left out.
 */
export default function LeagueNews({
  items, awaiting, error, onRetry,
}) {
  if (error) {
    return <ErrorPanel title="Couldn't load league news" body="Check your connection, then try again." onRetry={onRetry} />;
  }
  if (!awaiting && items.length === 0) return null;
  return (
    <Frame labelledBy="league-news-heading" head={<FrameHead><PixelHeading id="league-news-heading">League news</PixelHeading></FrameHead>}>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: { xs: '4px 14px 12px', md: '4px 20px 12px' } }}>
        {awaiting ? [0, 1, 2].map((i) => (
          <Box component="li" key={i} data-testid="news-skeleton" sx={{ py: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <Skel width={`${85 - i * 10}%`} height={18} />
            <Skel width="40%" height={14} />
          </Box>
        )) : items.map((item, i) => {
          const inner = (
            <>
              <Box sx={{ fontWeight: 600 }}>{item.message}</Box>
              <Box sx={{ fontSize: '14px', color: 'var(--ps-dim)' }}>
                {[item.league_name, formatInstant(item.created_at, 'day')].filter(Boolean).join(' · ')}
              </Box>
            </>
          );
          return (
            <Box
              component="li"
              key={item.id}
              sx={{ borderBottom: i === items.length - 1 ? 0 : '2px solid var(--ps-rule)' }}
            >
              {item.league_id
                ? <Box component={RouterLink} to={`/league/${item.league_id}`} sx={rowSx}>{inner}</Box>
                : <Box sx={rowSx}>{inner}</Box>}
            </Box>
          );
        })}
      </Box>
    </Frame>
  );
}
