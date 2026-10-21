import React, { useEffect } from 'react';
import { Box } from '@mui/material';
import { formatInstant, formatPoints, timeUntil } from '../../shared/lib';
import { PsButton } from '../../shared/ui/playselect';
import { SwapPreview } from '../../features/claim-player';

const LABEL_SX = {
  fontSize: '13px', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ps-dim)',
};

/**
 * The expanded Waivers row (#1617, ADR 0049): the swap, Rest of season, the
 * player's Clear time and News, and a link to the Decision card. Nothing else
 * about the player belongs here (ADR 0040: Usage and the rest stay on the card).
 * Play-select look since ADR 0067 wave 3.
 *
 * News is the Decision card's own read (`GET /api/players/:id/card`), started
 * once this panel first mounts, i.e. when a row first expands. `reads` (the
 * page's `useCardReads`) keeps the attempt, in flight, loaded or failed, per
 * player for the page view, so re-expanding never reads again. A read that
 * fails leaves the link to the Decision card in News's place.
 *
 * `inTable`: the panel sits in the desktop table's full-width cell, so it sticks to the left edge of
 * the scrolling region and is as wide as that region shows (a container query unit), never as wide
 * as the table. In a phone card it is plain flow.
 */
// How far off a Clear time is, in the shared house style ("in 14h 40m").
function untilText(availableAt) {
  const until = timeUntil(availableAt, Date.now());
  if (!until || until.passed) return 'clearing now';
  return until.imminent ? 'in under a minute' : `in ${until.text}`;
}

function News({ news }) {
  if (news.length === 0) return null;
  return (
    <Box
      data-testid="decision-card-news"
      component="ul"
      sx={{
        m: '4px 0 0', p: '0 0 0 18px', fontSize: '14px', display: 'flex', flexDirection: 'column', gap: '2px',
      }}
    >
      {news.map((item, i) => (
        // eslint-disable-next-line react/no-array-index-key -- no stable id on a news item
        <li key={i}>
          {item.url ? (
            <Box component="a" href={item.url} target="_blank" rel="noopener noreferrer" sx={{ color: 'var(--ps-ink)' }}>{item.headline}</Box>
          ) : item.headline}
          {item.blurb && (
            <Box component="span" data-testid="decision-card-news-blurb" sx={{ display: 'block', color: 'var(--ps-dim)' }}>{item.blurb}</Box>
          )}
        </li>
      ))}
    </Box>
  );
}

export default function WaiverRowDetail({
  id, player, isFaab, reads, onOpen, inTable = false,
}) {
  useEffect(() => {
    reads.start(player.id);
  }, [reads, player.id]);
  const attempt = reads.read(player.id);
  const payload = attempt?.card || null;
  const news = Array.isArray(payload?.news) ? payload.news : [];
  const newsFailed = attempt?.status === 'error';
  const newsLoading = !attempt || attempt.status === 'loading';

  const perGame = player.ros?.perGame;
  const availableAt = player.availability?.availableAt;
  const rule = isFaab ? 'the highest bid goes first' : 'the best Waiver priority goes first';
  const clearsAt = availableAt ? [formatInstant(availableAt, 'weekdayTime'), formatInstant(availableAt, 'zone')].filter(Boolean).join(' ') : null;

  return (
    <Box
      id={id}
      data-testid="waiver-row-detail"
      sx={{
        boxSizing: 'border-box',
        padding: { xs: '12px 0 0', md: '16px 20px 20px' },
        display: 'grid',
        gridTemplateColumns: '1fr',
        gap: '20px',
        alignItems: 'start',
        minWidth: 0,
        whiteSpace: 'normal',
        textAlign: 'left',
        fontSize: '15px',
        ...(inTable
          ? {
            position: 'sticky',
            left: 0,
            width: 'min(100cqw, 968px)',
            '@container (min-width: 640px)': { gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1.3fr) minmax(0, 1.2fr)' },
          }
          : null),
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
        <SwapPreview player={player} />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <Box component="span" sx={LABEL_SX}>Rest of season</Box>
          <span>
            <Box component="b" sx={{ fontWeight: 700 }}>{formatPoints(player.ros?.points)}</Box>
            {perGame != null && <Box component="span" sx={{ color: 'var(--ps-dim)' }}>{` · ${formatPoints(perGame)} per game`}</Box>}
          </span>
        </Box>
      </Box>
      <Box data-testid="waiver-row-detail-clear" sx={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
        <Box component="span" sx={LABEL_SX}>Clear time</Box>
        {availableAt ? (
          <Box component="span" sx={{ textWrap: 'pretty' }}>
            {`Claims on ${player.name} resolve at ${clearsAt} (${untilText(availableAt)}); ${rule}.`}
          </Box>
        ) : (
          <span>Clear time not available.</span>
        )}
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <Box component="span" sx={LABEL_SX}>News</Box>
          {/* One live region, mounted with the panel, so each state change is announced. */}
          <Box role="status" sx={{ fontSize: '14px', color: 'var(--ps-dim)' }}>
            {newsLoading && 'Loading news'}
            {newsFailed && 'News is on the Decision card.'}
            {payload && news.length === 0 && 'No recent news.'}
            {news.length > 0 && `${news.length} news ${news.length === 1 ? 'item' : 'items'}`}
          </Box>
          <News news={news} />
        </Box>
        <Box>
          <PsButton onClick={() => onOpen(player.id)} ariaLabel={`Open ${player.name} Decision card`}>Decision card</PsButton>
        </Box>
      </Box>
    </Box>
  );
}
