import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  CompactScoreboard, Frame, pixelSx, SR_ONLY_SX, TeamMark, TwoSidedOdds, YouTag,
} from '../../../shared/ui/playselect';
import { initialsFor } from '../../../shared/lib/initials';
import { scoreboardView } from '../model/scoreboardView';

/**
 * The scoreboard strip (widget `scoreboard-strip`, ADR 0031, #898), drawn as the Play-select versus
 * screen of the Matchup boards (ADR 0067 wave 2, spec #2334 ruling 4).
 *
 * The viewer's side comes first (Critique 4 item 1): a participant sees their own team on the left and the
 * opponent right-aligned on the right, whichever of home and away they are; a non-participant sees home on the
 * left. The accessible names (the live sentence, the odds image, the compact bar) follow that visual order.
 *
 * Once the matchup has started it is the Board-black screen: two equal columns (the second
 * right-aligned), team names in Pixel 16 on one baseline, the score in Pixel 32 (24 on a phone) with
 * the leader's in Board ink and the trailer's in Board dim, the record under each name, "Expected
 * final {x}" then "{n} players remaining" under the score, the margin in words ("{Leader} by {x}"),
 * and the full-width two-sided win probability bar with its one "win probability · Endzone Forecast"
 * credit. Before kickoff it is the framed versus panel: "Proj" figures, "{n} starters set to play"
 * (a live count's wording would lie), the projected margin and the same bar in Ink. A settled matchup
 * states its result in place of the bar and the figures (#2007).
 *
 * A visually hidden h2 comes before the team-name h3s. While live, a visually hidden polite region
 * carries the score sentence only ("Darkness Falls 61.0, Sunday Scaries 58.9"); its text is built from
 * the names and scores alone, so a payload that moves nothing announces nothing.
 *
 * `sticky` (RULINGS Critique 11): the panel stays in flow. Once it scrolls out of view a 56px compact
 * bar ("DF 61.0 · SS 58.9 · Darkness Falls by 2.1") pins to the top of the viewport; the page reserves
 * it with `scroll-padding-top`. The bar hangs off a zero-height sticky anchor placed after the panel
 * (its negative top margin cancels the page column's flex gap, `--ps-stack-gap`), so the panel's own
 * height never changes. The bar has no cursor and no action.
 *
 * It reads the entity model and the status view only (`model/scoreboardView`); the page passes
 * `matchup`, `viewerTeamId` and the optional `records` lookup down. Paints only `ps-*` tokens.
 */
const noteFor = (side, started) => {
  const n = side.playersRemaining;
  if (n == null) return null;
  return started
    ? `${n} ${Number(n) === 1 ? 'player' : 'players'} remaining`
    : `${n} ${Number(n) === 1 ? 'starter' : 'starters'} set to play`;
};

/** Expected final, then players remaining (starters set to play before kickoff), on separate lines. */
function Figures({ side, started, colors }) {
  const note = noteFor(side, started);
  return (
    <>
      {started && (
        <Box data-testid="scoreboard-figure-ef">
          Expected final
          {' '}
          <Box component="b" sx={{ fontWeight: 600, color: colors.ink, whiteSpace: 'nowrap' }}>{side.expectedFinal ?? '-'}</Box>
        </Box>
      )}
      {note && <Box data-testid="scoreboard-figure-pmr">{note}</Box>}
    </>
  );
}

/**
 * True once the panel has scrolled out of the viewport upward: the moment the compact bar pins. An
 * observer that is missing (jsdom, an old browser) never pins it.
 */
function useScrolledPast(ref, enabled) {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!enabled || !node || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      setPast(!entry.isIntersecting && entry.boundingClientRect.bottom <= 0);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return past;
}

export default function ScoreboardStrip({
  matchup, viewerTeamId, records, sticky = true, sx, ...rest
}) {
  const view = scoreboardView(matchup, { viewerTeamId, records });
  const live = view.isLive === true;
  const settled = view.result != null;
  const started = view.started;
  // One layout in the DOM, not two hidden ones: a phone sets the You tag beside the record and the figures under the margin.
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const panelRef = useRef(null);
  const scrolledPast = useScrolledPast(panelRef, sticky);
  const colors = started
    ? { ink: 'var(--ps-board-ink)', dim: 'var(--ps-board-dim)' }
    : { ink: 'var(--ps-ink)', dim: 'var(--ps-dim)' };
  // The board puts the viewer's team first when they play in this matchup, else home.
  const left = view.first;
  const right = view.second;
  const sentence = useMemo(
    () => `${left.name} ${left.score}, ${right.name} ${right.score}`,
    [left.name, left.score, right.name, right.score]
  );

  const sideNode = (side, key, isRight) => {
    const leads = view.leader == null || view.leader === key;
    const label = !started ? 'Proj' : settled ? 'Final score' : 'Live score';
    const you = <YouTag color={colors.ink} />;
    return (
      <Box
        data-testid={`scoreboard-side-${side.origin}`}
        data-viewer-team={side.isViewer || undefined}
        sx={{ gridArea: isRight ? 'sr' : 'sl', minWidth: 0, textAlign: isRight ? 'right' : 'left' }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', flexDirection: isRight ? 'row-reverse' : 'row', color: colors.ink }}>
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline-flex' } }}><TeamMark name={side.name} avatarUrl={side.avatarUrl} avatarStaticUrl={side.avatarStaticUrl} /></Box>
          <Box
            component="h3"
            data-testid="scoreboard-team-name"
            title={side.name}
            sx={{ m: 0, minWidth: 0, ...pixelSx(16), color: colors.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {side.name}
          </Box>
          {side.isViewer && !phone && you}
        </Box>
        <Box
          sx={{
            display: 'flex', alignItems: 'center', gap: '8px', mt: '4px', minHeight: '22px', flexDirection: isRight ? 'row-reverse' : 'row', fontSize: '13px', color: colors.dim, fontVariantNumeric: 'tabular-nums',
          }}
        >
          {side.record && <span>{side.record}</span>}
          {side.isViewer && phone && you}
        </Box>
        <Box sx={{ fontSize: '13px', color: colors.dim, mt: { xs: '4px', sm: '10px' } }}>{label}</Box>
        <Box
          data-testid="scoreboard-score"
          sx={{
            ...pixelSx(32), fontSize: { xs: '24px', sm: '32px' }, lineHeight: 1.2, mt: '4px', color: leads ? colors.ink : colors.dim,
          }}
        >
          {side.figure ?? '-'}
        </Box>
        {!settled && !phone && (
          <Box
            data-testid="scoreboard-figures"
            sx={{ mt: '6px', fontSize: '14px', color: colors.dim, fontVariantNumeric: 'tabular-nums' }}
          >
            <Figures side={side} started={started} colors={colors} />
          </Box>
        )}
      </Box>
    );
  };

  // A phone sets the figures under the margin, in the two halves.
  const figuresBelow = (side, isRight) => (settled || !phone ? null : (
    <Box
      data-testid="scoreboard-figures-phone"
      sx={{
        gridArea: isRight ? 'fr' : 'fl', minWidth: 0, textAlign: isRight ? 'right' : 'left', fontSize: '14px', color: colors.dim, fontVariantNumeric: 'tabular-nums',
      }}
    >
      <Figures side={side} started={started} colors={colors} />
    </Box>
  ));

  let margin = null;
  if (settled) {
    margin = <Box component="p" data-testid="scoreboard-result" sx={{ m: 0, fontSize: '16px', fontWeight: 600, color: colors.ink, overflowWrap: 'anywhere' }}>{view.result}</Box>;
  } else if (view.marginText && started) {
    margin = <Box component="p" data-testid="scoreboard-margin" sx={{ m: 0, ...pixelSx(16), color: colors.ink, overflowWrap: 'anywhere' }}>{view.marginText}</Box>;
  } else if (view.marginText) {
    margin = (
      <Box component="p" data-testid="scoreboard-margin" sx={{ m: 0, fontSize: '16px', color: colors.dim, overflowWrap: 'anywhere' }}>
        Projected margin ·
        {' '}
        <Box component="b" sx={{ fontWeight: 700, color: colors.ink }}>{view.marginText}</Box>
      </Box>
    );
  }

  const inner = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: '16px', sm: '20px' }, padding: { xs: '14px', sm: '24px' }, minWidth: 0 }}>
      <Box component="h2" id="matchup-scoreboard-h" sx={{ m: 0, ...SR_ONLY_SX }}>
        {started ? `Week ${matchup?.week} scoreboard` : `Week ${matchup?.week} scoreboard, projected`}
      </Box>
      {live && <Box component="p" aria-live="polite" data-testid="scoreboard-live-region" sx={{ m: 0, ...SR_ONLY_SX }}>{sentence}</Box>}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gridTemplateAreas: { xs: '"sl sr" "mg mg" "fl fr"', sm: '"sl sr" "mg mg"' },
          gap: { xs: '4px 12px', sm: '16px 24px' },
          alignItems: 'start',
        }}
      >
        {sideNode(left, 'first', false)}
        {sideNode(right, 'second', true)}
        <Box sx={{ gridArea: 'mg', minWidth: 0 }}>{margin}</Box>
        {figuresBelow(left, false)}
        {figuresBelow(right, true)}
      </Box>
      {settled && (
        // The bar is gone once settled and the names above truncate (#2364), so the bar's caption slot keeps the full names:
        // TwoSidedOdds' 14px body type, leader in ink, trailer dim. aria-hidden: the team headings already announce them.
        <Box
          aria-hidden="true"
          data-testid="scoreboard-final-names"
          sx={{
            display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '2px 12px', fontSize: '14px', color: colors.dim,
          }}
        >
          {[[left, 'first', false], [right, 'second', true]].map(([side, key, end]) => (
            <Box
              key={key}
              component="span"
              sx={{
                minWidth: 0, overflowWrap: 'anywhere', textAlign: end ? 'right' : 'left', ...(view.leader == null || view.leader === key ? { fontWeight: 700, color: colors.ink } : null),
              }}
            >
              {side.name}
            </Box>
          ))}
        </Box>
      )}
      {view.showBar && (
        <Box data-testid="scoreboard-odds" sx={{ width: '100%' }}>
          <TwoSidedOdds
            a={left.name}
            b={right.name}
            pct={left.winPct}
            live={live}
            onBoard={started}
            caption={(
              <>
                Win probability ·
                {' '}
                <Box component="span" sx={{ whiteSpace: 'nowrap' }}>Endzone Forecast</Box>
              </>
            )}
            size={14}
          />
        </Box>
      )}
    </Box>
  );

  const panel = started ? (
    <Box
      component="section"
      aria-labelledby="matchup-scoreboard-h"
      data-testid="scoreboard-strip"
      data-state={settled ? 'settled' : live ? 'live' : 'started'}
      data-layout={phone ? 'mobile' : 'desktop'}
      sx={{
        boxSizing: 'border-box', minWidth: 0, backgroundColor: 'var(--ps-board)', color: 'var(--ps-board-ink)', border: '6px double var(--ps-board-dim)', ...sx,
      }}
      {...rest}
    >
      {inner}
    </Box>
  ) : (
    <Frame labelledBy="matchup-scoreboard-h" data-testid="scoreboard-strip" data-state="scheduled" data-layout={phone ? 'mobile' : 'desktop'} sx={sx} {...rest}>
      {inner}
    </Frame>
  );

  return (
    <>
      <Box ref={panelRef} sx={{ minWidth: 0 }}>{panel}</Box>
      {sticky && (
        <Box
          data-testid="scoreboard-sticky"
          sx={{
            position: 'sticky', top: 0, zIndex: 5, height: 0, mt: 'calc(var(--ps-stack-gap, 0px) * -1)',
          }}
        >
          {scrolledPast && view.marginText && (
            <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
              <CompactScoreboard
                a={{ abbr: initialsFor(left.name), name: left.name, score: left.figure ?? '-' }}
                b={{ abbr: initialsFor(right.name), name: right.name, score: right.figure ?? '-' }}
                lead={view.leader === 'first' ? 'a' : view.leader === 'second' ? 'b' : undefined}
                marginText={view.marginText}
                live={live}
              />
            </Box>
          )}
        </Box>
      )}
    </>
  );
}
