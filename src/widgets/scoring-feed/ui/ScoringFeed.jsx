import React, { useId, useState } from 'react';
import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import {
  Frame, FrameHead, PixelHeading, PsLinkButton, SR_ONLY_SX,
} from '../../../shared/ui/playselect';
import { playLabel } from '../../../entities/matchup';
import {
  IDLE_LINE,
  SIDE_LABELS,
  formatPlayTime,
  formatPoints,
  sideKey,
} from '../model/scoringFeedModel';

/**
 * The scoring-feed widget (ADR 0031, #895; Play-select, ADR 0067 wave 2, spec #2334 ruling 6): the
 * latest-plays strip and the Scoring feed frame, presenters over the one item shape described in
 * ../model/scoringFeedModel.js (the page keeps its own plays filter and hands the widget the items, newest
 * first).
 *
 * The strip is a Board-black box with a quiet "Latest plays" label in place of the red Live badge (the Live
 * chip appears only on the h1 row and the live hero, Critique 7). It does not marquee (Steps Not Slides): a
 * static set of the newest 4 plays, or the newest 1 below `sm`, with the points in Ink, not green. The page
 * shows it only below `md`; on desktop the rail's feed shows the same plays. With no plays it renders
 * nothing (before kickoff the strip is not drawn and the feed keeps its idle line).
 *
 * The feed is a tertiary frame (2px rule, Pixel 16 h2) of Archivo rows: the time, the play over the NFL
 * team and fantasy Team, the points. The home / away side is words for a screen reader only (the dots are
 * gone). The frame shows `limit` rows and a "Show all N plays" 44px control when there are more.
 *
 * Paints only `ps-*` tokens. Copy is house style: middots, hyphens in scores, no em dashes, no emoji.
 */

const NUM_SX = { fontVariantNumeric: 'tabular-nums' };
const ELLIPSIS_SX = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

/** One play on the strip: "Name NFL · play · +pts to Team". The `{' '}` keep the DOM text readable. */
function StripPlay({ item }) {
  return (
    <Box component="li" data-testid="scoring-strip-play" sx={{ fontSize: '14px', lineHeight: 1.4, color: 'var(--ps-board-dim)', minWidth: 0 }}>
      <Box component="strong" sx={{ fontWeight: 700, color: 'var(--ps-board-ink)' }}>{item.name}</Box>
      {item.nflTeam ? <>{' '}<span>{item.nflTeam}</span></> : null}
      {' '}
      <span aria-hidden="true">·</span>
      {' '}
      <span>{playLabel(item)}</span>
      {' '}
      <span aria-hidden="true">·</span>
      {' '}
      <Box component="b" sx={{ ...NUM_SX, fontWeight: 700, color: 'var(--ps-board-ink)' }}>{formatPoints(item.pointsDelta)}</Box>
      {item.teamName ? <>{' '}<span>{`to ${item.teamName}`}</span></> : null}
    </Box>
  );
}

/**
 * The latest-plays strip. `desktopLimit` is how many plays it shows from `sm` up (the board shows four);
 * below `sm` it shows the newest one. No clock, no count, no animation.
 */
export function ScoringStrip({ items, desktopLimit = 4, sx, ...rest }) {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (list.length === 0) return null;
  const shown = list.slice(0, mobile ? 1 : Math.max(1, desktopLimit));

  return (
    <Box
      component="section"
      data-testid="scoring-strip"
      aria-label="Recent league scoring plays"
      {...rest}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '12px 14px',
        boxSizing: 'border-box',
        backgroundColor: 'var(--ps-board)',
        color: 'var(--ps-board-ink)',
        border: '2px solid var(--ps-board-dim)',
        minWidth: 0,
        ...sx,
      }}
    >
      <Box component="span" sx={{ fontSize: '13px', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ps-board-dim)' }}>Latest plays</Box>
      <Box component="ul" role="list" data-testid="scoring-strip-track" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {shown.map((item, i) => (
          <StripPlay key={`${item.playerId ?? 'play'}-${i}`} item={item} />
        ))}
      </Box>
    </Box>
  );
}

/** One feed row: time, the play over NFL team and fantasy team, the points. */
function FeedRow({ item, first, phone }) {
  const key = sideKey(item.side);
  const time = formatPlayTime(item.at);
  return (
    <Box
      component="li"
      data-testid="scoring-feed-row"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: { xs: '10px 14px', md: '10px 16px' },
        borderTop: first ? 0 : '2px solid var(--ps-rule)',
      }}
    >
      <Box component="span" data-testid="scoring-feed-time" sx={{ ...NUM_SX, width: 64, flex: 'none', fontSize: '13px', color: 'var(--ps-dim)', whiteSpace: 'nowrap' }}>
        {time}
      </Box>
      <Box sx={{ flex: '1 1 0', minWidth: 0 }}>
        {SIDE_LABELS[key] ? <Box component="span" data-testid="scoring-feed-side" data-side={key} sx={SR_ONLY_SX}>{SIDE_LABELS[key]}</Box> : null}
        <Box sx={{ ...ELLIPSIS_SX, fontSize: '15px' }}>
          <strong>{item.name}</strong>
          {' · '}
          {playLabel(item)}
        </Box>
        <Box sx={{ ...ELLIPSIS_SX, fontSize: '13px', color: 'var(--ps-dim)' }}>
          {[item.nflTeam, item.teamName].filter(Boolean).join(' · ')}
        </Box>
      </Box>
      <Box component="b" data-testid="scoring-feed-points" sx={{ ...NUM_SX, flex: 'none', fontSize: '16px', fontWeight: 700 }}>
        {formatPoints(item.pointsDelta)}
      </Box>
    </Box>
  );
}

/**
 * The Scoring feed frame: a tertiary frame whose h2 reads "Scoring feed" (level 2 unless `headingLevel`
 * says otherwise, ADR 0021), with an optional "Week N" beside it and whatever the page hands as `tail`.
 * An empty list renders the idle line. With an `onShowAll` prop the footer calls it; without one the frame
 * expands in place and the control becomes "Show fewer plays".
 */
export function ScoringFeedList({
  items,
  week,
  tail,
  limit = 6,
  onShowAll,
  headingLevel = 2,
  ...rest
}) {
  const [expanded, setExpanded] = useState(false);
  const headingId = useId();
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const total = list.length;
  const cap = Math.max(1, limit);
  const shown = expanded && !onShowAll ? list : list.slice(0, cap);
  const hasMore = total > cap;

  const onFooter = () => {
    if (onShowAll) onShowAll();
    else setExpanded((was) => !was);
  };

  return (
    <Frame
      tier="rule"
      labelledBy={headingId}
      data-testid="scoring-feed"
      {...rest}
      head={(
        <FrameHead>
          <PixelHeading id={headingId} level={headingLevel} size={16}>Scoring feed</PixelHeading>
          {week != null && <Box component="span" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>{`Week ${week}`}</Box>}
          {tail}
        </FrameHead>
      )}
    >
      {total === 0 ? (
        <Box component="p" sx={{ m: 0, padding: { xs: '14px', md: '20px' }, fontSize: '15px', color: 'var(--ps-dim)' }}>
          {IDLE_LINE}
        </Box>
      ) : (
        <Box component="ul" role="list" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {shown.map((item, i) => (
            <FeedRow key={`${item.playerId ?? 'play'}-${i}`} item={item} first={i === 0} />
          ))}
        </Box>
      )}
      {hasMore ? (
        <Box sx={{ borderTop: '2px solid var(--ps-rule)', display: 'flex', justifyContent: 'center' }}>
          <PsLinkButton data-testid="scoring-feed-show-all" onClick={onFooter}>
            {expanded && !onShowAll ? 'Show fewer plays' : `Show all ${total} plays`}
          </PsLinkButton>
        </Box>
      ) : null}
    </Frame>
  );
}

export default ScoringFeedList;
