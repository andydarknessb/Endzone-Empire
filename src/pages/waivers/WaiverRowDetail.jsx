import React, { useEffect } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { MIN_TOUCH_TARGET_SX, formatPoints } from '../../shared/lib';
import { NewsList } from '../../entities/player';
import { SwapPreview } from '../../features/claim-player';
import { formatRelative } from '../../utils/formatRelative';

const LABEL_SX = { fontSize: 12, color: 'var(--dash-dim)', mb: 0.25 };

/**
 * The expanded Waivers row (#1617, ADR 0049): the swap, Rest of season, the
 * player's Clear time and News, and a link to the Decision card. Nothing else
 * about the player belongs here (ADR 0040: Usage and the rest stay on the card).
 *
 * News is the Decision card's own read (`GET /api/players/:id/card`), started
 * once this panel first mounts, i.e. when a row first expands. `reads` (the
 * page's `useCardReads`) keeps the attempt, in flight, loaded or failed, per
 * player for the page view, so re-expanding never reads again. A read that
 * fails leaves the link to the Decision card in News's place.
 *
 * BELOW-ISLAND EDGE (ADR 0031 amendment): `utils/formatRelative`, the same
 * plumbing edge `player-row`'s Status column already names.
 */
export default function WaiverRowDetail({ id, player, roster, isFaab, reads, onOpen }) {
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

  return (
    <Box id={id} data-testid="waiver-row-detail" sx={{ display: 'grid', gap: 1.5, minWidth: 0, pt: 1 }}>
      <SwapPreview player={player} roster={Array.isArray(roster) ? roster : []} />
      <Box>
        <Typography sx={LABEL_SX}>Rest of season</Typography>
        <Typography sx={{ fontWeight: 700 }}>
          {formatPoints(player.ros?.points)}
          {perGame != null && (
            <Typography component="span" sx={{ fontWeight: 400, color: 'var(--dash-dim)' }}>
              {` · ${formatPoints(perGame)} per game`}
            </Typography>
          )}
        </Typography>
      </Box>
      <Box data-testid="waiver-row-detail-clear">
        <Typography sx={LABEL_SX}>Clear time</Typography>
        {availableAt ? (
          <Typography>
            {`Claims on ${player.name} resolve at ${new Date(availableAt).toLocaleString()} (${formatRelative(availableAt)}); ${rule}.`}
          </Typography>
        ) : (
          <Typography>Clear time not available.</Typography>
        )}
      </Box>
      <Box>
        <Typography sx={LABEL_SX}>News</Typography>
        {/* One live region, mounted with the panel, so each state change is announced. */}
        <Typography role="status" sx={{ fontSize: 13, color: 'var(--dash-dim)' }}>
          {newsLoading && 'Loading news'}
          {newsFailed && 'News is on the Decision card.'}
          {payload && news.length === 0 && 'No recent news.'}
          {news.length > 0 && `${news.length} news ${news.length === 1 ? 'item' : 'items'}`}
        </Typography>
        {news.length > 0 && <NewsList news={news} />}
      </Box>
      <Box>
        <Button
          variant="outlined"
          onClick={() => onOpen(player.id)}
          aria-label={`Open ${player.name} Decision card`}
          sx={MIN_TOUCH_TARGET_SX}
        >
          Decision card
        </Button>
      </Box>
    </Box>
  );
}
