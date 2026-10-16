import React, { useId, useState } from 'react';
import { Box } from '@mui/material';
import {
  Frame, FrameHead, PsButton, pixelSx,
} from '../../../shared/ui/playselect';
import GameCard from './GameCard';
import { StarIcon } from './parts';

/**
 * pickem-board widget (ADR 0038, Play-select in ADR 0067 wave 2): one kickoff window as a tertiary
 * frame, its h3 the window label (under the page's "Picks" h2), its GameCards rows inside it with 2px
 * Rule dividers. The grouping itself is `entities/pickem-game`'s `groupByKickoffWindow` (ADR 0038:
 * "Do not reimplement... grouping" - the entity groups, this renders one group); this component only
 * knows how to label the five windows CONTEXT.md names (Kickoff window) and lay their cards out.
 *
 * The head says "League picks reveal at kickoff" once for the window (the cards no longer repeat it),
 * and, in confidence mode while an open game still lacks a pick, the one hint ("Pick a team to set its
 * confidence") that each disabled select points at with aria-describedby.
 *
 * A window whose games are all locked is settled: one summary row ("{n} live · {p} picked · {x} no
 * pick", or "Final · {c} of {p} correct", the pick count dropped when every game was picked, with a
 * pixel star and "Perfect" when two or more games were all picked and right) and a ghost "Show games"
 * toggle (`aria-expanded`), collapsed by default. A window with an open game renders its cards.
 */
const WINDOW_LABELS = {
  'thursday-night': 'Thursday Night',
  'sunday-early': 'Sunday Early',
  'sunday-late': 'Sunday Late',
  'sunday-night': 'Sunday Night',
  'monday-night': 'Monday Night',
};

function summaryOf(views) {
  const picked = views.filter((view) => view.myPick != null).length;
  const none = views.length - picked;
  if (views.every((view) => view.phase === 'final')) {
    const correct = views.filter((view) => view.outcome === 'correct').length;
    // A one-game window never earns "Perfect": 1 of 1 is not an ending worth a star.
    const perfect = views.length >= 2 && none === 0 && correct === views.length;
    return { text: `Final · ${correct} of ${picked} correct${none ? ` · ${none} no pick` : ''}`, perfect };
  }
  const live = views.filter((view) => view.phase === 'live').length;
  return { text: `${live} live · ${picked} picked · ${none} no pick`, perfect: false };
}

export default function KickoffWindowGroup({
  window: windowKey,
  views,
  mode,
  totalManagers,
  slateSize,
  usedByFor,
  stateFor,
  cursorKey = null,
  cursorId,
  scrollMarginTop,
  loading = false,
  onPickWinner,
  onSetConfidence,
  onUndo,
  onRetry,
}) {
  const label = WINDOW_LABELS[windowKey] || windowKey;
  const headingId = useId();
  const listId = useId();
  const hintId = useId();
  const [expanded, setExpanded] = useState(false);
  const settled = views.length > 0 && views.every((view) => view.lock);

  const heading = (
    <Box component="h3" id={headingId} sx={{ m: 0, ...pixelSx(16) }}>{label}</Box>
  );

  const cards = (
    <Box component="ul" id={listId} sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {views.map((view, index) => (
        <Box
          component="li"
          key={view.gameKey}
          sx={index < views.length - 1 ? { borderBottom: '2px solid var(--ps-rule)' } : undefined}
        >
          <GameCard
            view={view}
            mode={mode}
            totalManagers={totalManagers}
            slateSize={slateSize}
            usedBy={usedByFor ? usedByFor(view.gameKey) : {}}
            saveState={stateFor ? stateFor(view.gameKey) : null}
            hintId={hintId}
            cursor={view.gameKey === cursorKey}
            cursorId={cursorId}
            scrollMarginTop={scrollMarginTop}
            loading={loading}
            onPickWinner={onPickWinner}
            onSetConfidence={onSetConfidence}
            onUndo={onUndo}
            onRetry={onRetry}
          />
        </Box>
      ))}
    </Box>
  );

  if (settled) {
    const { text, perfect } = summaryOf(views);
    return (
      <Frame tier="rule" labelledBy={headingId} data-testid={`kickoff-window-${windowKey}`}>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '4px 16px',
            padding: { xs: '8px 14px', md: '8px 20px' },
            boxSizing: 'border-box',
            borderBottom: expanded ? '2px solid var(--ps-rule)' : undefined,
          }}
        >
          <Box component="span" sx={{ flex: { xs: '1 1 100%', md: 'none' }, width: { md: '224px' } }}>{heading}</Box>
          <Box
            component="span"
            data-testid="window-summary"
            sx={{ flex: '1 1 0', minWidth: 0, fontSize: { xs: '15px', md: '16px' }, fontWeight: 600, fontVariantNumeric: 'tabular-nums', textWrap: 'balance' }}
          >
            {text}
            {perfect && (
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', ml: '12px', fontWeight: 700 }}>
                <StarIcon />
                Perfect
              </Box>
            )}
          </Box>
          <Box component="span" sx={{ marginLeft: 'auto', flex: 'none' }}>
            <PsButton
              variant="ghost"
              ariaExpanded={expanded}
              ariaControls={expanded ? listId : undefined}
              ariaLabel={`${expanded ? 'Hide' : 'Show'} games, ${label}`}
              onClick={() => setExpanded((open) => !open)}
            >
              {expanded ? 'Hide games' : 'Show games'}
            </PsButton>
          </Box>
        </Box>
        {expanded && cards}
      </Frame>
    );
  }

  const confidenceHint = mode === 'confidence' && views.some((view) => !view.lock && view.myPick == null);
  return (
    <Frame
      tier="rule"
      labelledBy={headingId}
      data-testid={`kickoff-window-${windowKey}`}
      head={(
        <FrameHead>
          {heading}
          <Box
            component="span"
            sx={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '2px 16px', fontSize: '13px', color: 'var(--ps-dim)' }}
          >
            <span>League picks reveal at kickoff</span>
            {confidenceHint && <span id={hintId}>Pick a team to set its confidence</span>}
          </Box>
        </FrameHead>
      )}
    >
      {cards}
    </Frame>
  );
}
