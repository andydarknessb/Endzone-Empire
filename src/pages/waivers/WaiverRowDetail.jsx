import React, { useEffect } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { MIN_TOUCH_TARGET_SX, formatPoints } from '../../shared/lib';
import { usePlayerCard, NewsList } from '../../entities/player';
import { SwapPreview } from '../../features/claim-player';
import { formatRelative } from '../../utils/formatRelative';

const LABEL_SX = { fontSize: 12, color: 'var(--dash-dim)', mb: 0.25 };

/**
 * The expanded Waivers row (#1617, ADR 0049): the swap, Rest of season, the
 * player's Clear time and News, and a link to the Decision card. Nothing else
 * about the player belongs here (ADR 0040: Usage and the rest stay on the card).
 *
 * News is the Decision card's own read (`usePlayerCard`, `GET
 * /api/players/:id/card`), made only once this panel mounts, i.e. when a row
 * expands. `cache` (the page's `Map` of player id to payload) keeps it to one
 * read per player per page view: a re-expanded row is served from it. A read
 * that fails leaves the link to the Decision card in News's place.
 *
 * BELOW-ISLAND EDGE (ADR 0031 amendment): `utils/formatRelative`, the same
 * plumbing edge `player-row`'s Status column already names.
 */
export default function WaiverRowDetail({ id, player, leagueId, roster, isFaab, cache, onOpen }) {
  const cached = cache.get(player.id) || null;
  const { status, card } = usePlayerCard({ leagueId, playerId: cached ? null : player.id });
  useEffect(() => {
    if (card) cache.set(player.id, card);
  }, [card, cache, player.id]);
  const payload = cached || card;
  const news = Array.isArray(payload?.news) ? payload.news : [];
  const newsFailed = !cached && status === 'error';
  const newsLoading = !payload && !newsFailed;

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
        {newsLoading && (
          <Typography role="status" sx={{ fontSize: 13, color: 'var(--dash-dim)' }}>
            Loading news
          </Typography>
        )}
        {newsFailed && (
          <Typography sx={{ fontSize: 13, color: 'var(--dash-dim)' }}>News is on the Decision card.</Typography>
        )}
        {payload && news.length === 0 && (
          <Typography sx={{ fontSize: 13, color: 'var(--dash-dim)' }}>No recent news.</Typography>
        )}
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
