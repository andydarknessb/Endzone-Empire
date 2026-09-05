import React, { useState } from 'react';
import { Box, Typography, useMediaQuery } from '@mui/material';
import { keyframes, useTheme } from '@mui/material/styles';
import { visuallyHidden } from '@mui/utils';
import { Badge, Card } from '../../../shared/ui';
import { playLabel } from '../../../lib/scoringEvents';
import {
  IDLE_LINE,
  SIDE_LABELS,
  SIDE_TOKENS,
  formatPlayTime,
  formatPoints,
  playsThisHour,
  playsThisHourLabel,
  sideKey,
  toMs,
} from '../model/scoringFeedModel';

/**
 * The scoring-feed widget (ADR 0031, #895): the live ticker strip and the
 * Scoring feed card from the Game Center canvas
 * (docs/design/game-center-matchups/build.mjs, `tickerStrip()` and
 * `feedCard()`), which the Game Center page composes in place of its legacy
 * LiveActionTicker and LiveScoringFeed. Both surfaces are presenters over the
 * one item shape described in ../model/scoringFeedModel.js (which also says
 * what the page must add to the server's play before handing it over); the
 * page keeps its own plays filter and hands the widget the items, newest
 * first.
 *
 * Composes `shared/ui` (ADR 0020) and paints only `dash-*` tokens. Every
 * ink-on-surface pairing here is registered in tokens.contrast.test.js: ink /
 * dim / faint on the card surface, the Live pill's danger on the danger tint
 * over a card (the strip is a card, and that is the only backdrop the pill is
 * guarded on), and the points figure's `dash-away` on the card surface ("away
 * side percentage on a card"). The canvas paints the points in its
 * `--success`, which is the same hex as `dash-away` in both modes, so the
 * points read `dash-away`; its Live pill and the strip's border are its
 * `--danger` / `--danger-soft`, which are `dash-danger` / `dash-danger-soft`
 * (Badge `danger`, the canvas's `.chip.live`).
 *
 * Copy is house style: middot separators, hyphens in scores, no em dashes and
 * no emoji (the legacy ticker's football emoji is gone; the strip's test
 * asserts its absence). Icons are inline stroke SVG on the canvas's 20px grid.
 */

/** The canvas's `list` icon at 14px: three horizontal strokes, decorative. */
function ListIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-testid="scoring-strip-count-icon"
    >
      <path d="M4 6h12M4 10h12M4 14h12" />
    </svg>
  );
}

// The canvas's `.dot`: an 8px disc in currentColor. Decorative on its own;
// where it carries meaning (the feed row's side) the caller pairs it with
// visually hidden text.
const DOT_SX = {
  display: 'inline-block',
  width: 8,
  height: 8,
  borderRadius: 'var(--radius-pill)',
  backgroundColor: 'currentColor',
  flex: 'none',
};

// The marquee: the track holds two identical groups (the second aria-hidden)
// and slides by exactly one group's width, so the loop is seamless. It ends
// on a transform, never a hidden state, and runs only when reduced motion is
// off (the ternary below), with the in-object reduce override as belt and
// braces for a viewer whose preference flips mid-session.
const scroll = keyframes`
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
`;

const NUM_SX = { fontVariantNumeric: 'tabular-nums' };

// The canvas's `.ellip`.
const ELLIPSIS_SX = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

/**
 * One play on the strip: "Name NFL · play · +pts to Team", spans 8px apart at
 * 13px. The explicit `{' '}` between spans is for the text, not the layout: a
 * flex gap paints space but puts none in the DOM, so without them a screen
 * reader (and a copy) would run "JeffersonMIN·receiving" together. Whitespace-
 * only text nodes are dropped from flex layout, so the visual gap is unchanged.
 */
function StripPlay({ item }) {
  return (
    <Box
      component="span"
      data-testid="scoring-strip-play"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}
    >
      <Box component="span" sx={{ fontWeight: 600, color: 'var(--dash-ink)' }}>
        {item.name}
      </Box>
      {item.nflTeam ? (
        <>
          {' '}
          <Box component="span" sx={{ color: 'var(--dash-faint)' }}>
            {item.nflTeam}
          </Box>
        </>
      ) : null}{' '}
      <Box component="span" aria-hidden="true" sx={{ color: 'var(--dash-faint)' }}>
        ·
      </Box>{' '}
      <Box component="span" sx={{ color: 'var(--dash-dim)' }}>
        {playLabel(item)}
      </Box>{' '}
      <Box component="span" aria-hidden="true" sx={{ color: 'var(--dash-faint)' }}>
        ·
      </Box>{' '}
      <Box component="span" sx={{ ...NUM_SX, fontWeight: 700, color: 'var(--dash-away)' }}>
        {formatPoints(item.pointsDelta)}
      </Box>
      {item.teamName ? (
        <>
          {' '}
          <Box component="span" sx={{ color: 'var(--dash-faint)' }}>
            to {item.teamName}
          </Box>
        </>
      ) : null}
    </Box>
  );
}

/** A group of strip plays, 20px apart, with the same 20px after the last so two groups tile. */
function StripGroup({ items, ...rest }) {
  return (
    <Box
      component="span"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: '20px', pr: '20px' }}
      {...rest}
    >
      {items.map((item, i) => (
        <StripPlay key={`${item.playerId ?? 'play'}-${i}`} item={item} />
      ))}
    </Box>
  );
}

/**
 * The live ticker strip: one line with the Live pill (Badge `danger`, the
 * canvas's red `.chip.live`), the latest plays, and on desktop a
 * plays-this-hour count with the list icon.
 * Mobile (below the `sm` breakpoint) shows one play and no count. The line
 * marquees only when motion is allowed, on desktop, and there is more than
 * one play to cycle; under `prefers-reduced-motion: reduce` it is a static
 * row, clipped at the strip's edge, exactly as the canvas draws it. The strip
 * is a named region ("Recent league scoring plays"), so it is reachable by
 * landmark; it is not a live region, since a play a minute would talk over a
 * screen-reader user the whole afternoon.
 *
 * With no items it renders the idle line and no pill: nothing is live yet.
 *
 * `now` (epoch ms, ISO or Date) is the clock the count reads against; it
 * defaults to the render time and exists so a test can pin it. `desktopLimit`
 * is how many plays the desktop line carries (the canvas shows four).
 */
export function ScoringStrip({ items, now, desktopLimit = 4, sx, ...rest }) {
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  const list = Array.isArray(items) ? items.filter(Boolean) : [];

  const stripSx = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    px: '12px',
    py: '8px',
    overflow: 'hidden',
    borderColor: 'var(--dash-danger-soft)',
    ...sx,
  };

  if (list.length === 0) {
    return (
      <Card data-testid="scoring-strip" sx={stripSx} {...rest}>
        <Typography component="p" sx={{ m: 0, fontSize: '13px', color: 'var(--dash-dim)' }}>
          {IDLE_LINE}
        </Typography>
      </Card>
    );
  }

  const shown = list.slice(0, mobile ? 1 : Math.max(1, desktopLimit));
  const marquee = !mobile && !prefersReducedMotion && shown.length > 1;
  const count = playsThisHour(list, now != null ? toMs(now) : undefined);

  return (
    <Card
      data-testid="scoring-strip"
      aria-label="Recent league scoring plays"
      sx={stripSx}
      {...rest}
    >
      <Badge variant="danger" data-testid="scoring-strip-live" sx={{ flex: 'none' }}>
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <Box component="span" aria-hidden="true" sx={DOT_SX} />
          Live
        </Box>
      </Badge>
      <Box sx={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>
        <Box
          data-testid="scoring-strip-track"
          data-motion={marquee ? 'marquee' : 'static'}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            animation: marquee ? `${scroll} 24s linear infinite` : 'none',
            '&:hover': { animationPlayState: 'paused' },
            '&:focus-within': { animationPlayState: 'paused' },
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        >
          <StripGroup items={shown} data-testid="scoring-strip-group" />
          {marquee ? (
            <StripGroup items={shown} aria-hidden="true" data-testid="scoring-strip-clone" />
          ) : null}
        </Box>
      </Box>
      {!mobile ? (
        <Box
          data-testid="scoring-strip-count"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '12px',
            color: 'var(--dash-faint)',
            flex: 'none',
          }}
        >
          <ListIcon />
          <span>{playsThisHourLabel(count)}</span>
        </Box>
      ) : null}
    </Card>
  );
}

/** One feed row: time, side dot, player and play over NFL team and fantasy team, points. */
function FeedRow({ item, first }) {
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
        px: '18px',
        py: '10px',
        borderTop: first ? 0 : '1px solid var(--dash-line)',
      }}
    >
      <Box
        component="span"
        data-testid="scoring-feed-time"
        sx={{ ...NUM_SX, width: 56, flex: 'none', fontSize: '12px', color: 'var(--dash-faint)' }}
      >
        {time}
      </Box>
      <Box component="span" sx={{ display: 'inline-flex', flex: 'none', color: SIDE_TOKENS[key] }}>
        <Box component="span" aria-hidden="true" data-testid="scoring-feed-side" data-side={key} sx={DOT_SX} />
        {SIDE_LABELS[key] ? <Box component="span" sx={visuallyHidden}>{SIDE_LABELS[key]}</Box> : null}
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: '1 1 0', minWidth: 0 }}>
        <Box component="span" sx={{ ...ELLIPSIS_SX, fontSize: '13px', color: 'var(--dash-ink)' }}>
          <strong>{item.name}</strong> · {playLabel(item)}
        </Box>
        <Box component="span" sx={{ ...ELLIPSIS_SX, fontSize: '12px', color: 'var(--dash-faint)' }}>
          {[item.nflTeam, item.teamName].filter(Boolean).join(' · ')}
        </Box>
      </Box>
      <Box
        component="span"
        data-testid="scoring-feed-points"
        sx={{ ...NUM_SX, flex: 'none', fontWeight: 700, color: 'var(--dash-away)' }}
      >
        {formatPoints(item.pointsDelta)}
      </Box>
    </Box>
  );
}

/**
 * The Scoring feed card: a Card titled "Scoring feed" (a real heading, level
 * 2 unless `headingLevel` says otherwise, ADR 0021), with an optional
 * "Week N" beside the title and whatever the page hands as `tail` (its plays
 * filter's label, "TDs only" on the canvas) on the right. One row per item,
 * as a list: the play's clock time, the side dot (home / away / neutral, with
 * visually hidden side text so the side is not carried by color alone), the
 * player and play on line one, the NFL team and fantasy team on line two, and
 * the points in the success tone.
 *
 * The card shows `limit` rows (the canvas's six) and, when there are more, a
 * "Show all N plays" footer. With an `onShowAll` prop the footer calls it and
 * the page decides what "all" means (a route, a drawer); without one the card
 * expands in place and the footer becomes "Show fewer plays". The footer is a
 * real button at least 44px tall. An empty list renders the idle line.
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
    <Card
      data-testid="scoring-feed"
      title="Scoring feed"
      count={week != null ? `Week ${week}` : undefined}
      tail={tail}
      headingLevel={headingLevel}
      {...rest}
    >
      {total === 0 ? (
        <Box sx={{ p: 2.25 }}>
          <Typography component="p" sx={{ m: 0, fontSize: '14px', color: 'var(--dash-dim)' }}>
            {IDLE_LINE}
          </Typography>
        </Box>
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {shown.map((item, i) => (
            <FeedRow key={`${item.playerId ?? 'play'}-${i}`} item={item} first={i === 0} />
          ))}
        </Box>
      )}
      {hasMore ? (
        <Box sx={{ borderTop: '1px solid var(--dash-line)' }}>
          <Box
            component="button"
            type="button"
            data-testid="scoring-feed-show-all"
            onClick={onFooter}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              minHeight: 44,
              px: '10px',
              py: '10px',
              border: 0,
              borderRadius: '0 0 var(--dash-radius) var(--dash-radius)',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              font: 'inherit',
              fontSize: '13px',
              lineHeight: 1.2,
              color: 'var(--dash-dim)',
              '&:hover': { color: 'var(--dash-ink)' },
              '&:focus-visible': { outline: '2px solid var(--focus-ring)', outlineOffset: -2 },
            }}
          >
            {expanded && !onShowAll ? 'Show fewer plays' : `Show all ${total} plays`}
          </Box>
        </Box>
      ) : null}
    </Card>
  );
}

export default ScoringFeedList;
