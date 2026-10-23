import React, { useEffect, useId } from 'react';
import { Box, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import PickWeek from '../../../features/pick-week';
import {
  Frame, FrameHead, NumbersHelp, PixelCheck, Skel, pixelSx,
} from '../../../shared/ui/playselect';
import { formatKickoff } from '../../../shared/lib';
import useBoardPresenter from '../model/useBoardPresenter';
import KickoffWindowGroup from './KickoffWindowGroup';
import GameCard from './GameCard';
import { ErrorBox } from './parts';

const CURSOR_ID = 'pickem-cursor';

const NUMBERS = [
  ['Spread', 'The favorite and the points it is expected to win by.'],
  ['O/U', 'The expected combined score of both teams.'],
  ['FAV', 'Marks the favorite, the team the spread expects to win.'],
  ['Win probability', "ESPN's live figure for each team's chance to win; it shows on live games."],
];
const CONFIDENCE_TERM = [
  'Confidence',
  "Each pick carries a rank from 1 up to the week's game count, each used once. A correct pick earns its rank.",
];

/**
 * The Pick'em board widget (ADR 0038, Play-select in ADR 0067 wave 2): the Picks section. Its h2
 * row is "Picks" and the one status of where the manager stands; under it the week picker
 * (`pick-week`, no "All weeks": this board's week setter cannot take it), then
 * the slate as kickoff-window frames of GameCards, then "What the numbers mean".
 *
 * Picks save the moment they are made, so there is no save bar, no draft and nothing sticky at the
 * bottom. The status is plain text in the h2 row ("9 of 14 picked · 2 open · next lock Sun 3:25 PM",
 * or "14 of 14 picked · all saved"): the card's own save line is the one live region. "next lock" is
 * an in-page link that focuses the cursor card, the earliest-kickoff game that is unlocked and
 * unpicked.
 *
 * In confidence mode a rule line explains the ranks, and a strip sticks to the top of the section
 * with the ranks left and the rank pool. The page reserves its height with `scroll-padding-top`, and
 * the cursor card has `scroll-margin-top`, so neither a focused card nor the next-lock jump lands
 * under it (WCAG 2.4.11).
 *
 * Non-ready states before the slate itself: a load failure (the danger frame with a ghost Retry), the
 * loading skeleton (one GameCard per state, since the real count is what has not loaded yet), and an
 * empty week (no NFL games scheduled).
 *
 * `onSaved(result)` fires after every save that landed, which is how the composing page, the one
 * that reads both `entities/pickem-game` and `entities/pickem-standings`, clears the standings cache
 * a save made stale (sibling entities do not import each other, ADR 0029).
 */
export default function PickemBoard({ leagueId, onSaved }) {
  const theme = useTheme();
  // `pick-week`'s own 44px touch target below `sm` is opt-in (`fill`).
  const compact = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const headingId = useId();

  const {
    week,
    weeks,
    setWeek,
    mode,
    loading,
    error,
    reload,
    totalManagers,
    slateSize,
    windows,
    cursorKey,
    status,
    confidence,
    usedByFor,
    stateFor,
    onPickWinner,
    onSetConfidence,
    onUndo,
    onRetry,
  } = useBoardPresenter(leagueId, { onSaved });

  const ready = !loading && !error;
  const withGames = ready && windows.length > 0;
  const stripped = withGames && confidence != null;

  // The sticky rank strip is 42px tall; reserve it (plus 16px) so a focused card is never under it.
  useEffect(() => {
    if (!stripped) return undefined;
    const root = document.documentElement;
    const before = root.style.scrollPaddingTop;
    root.style.scrollPaddingTop = '58px';
    return () => { root.style.scrollPaddingTop = before; };
  }, [stripped]);

  const jumpToCursor = (event) => {
    event.preventDefault();
    document.getElementById(CURSOR_ID)?.focus();
  };

  return (
    <Box component="section" aria-labelledby={headingId} data-testid="pickem-board" sx={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 16px' }}>
        <Box component="h2" id={headingId} sx={{ m: 0, ...pixelSx(16) }}>Picks</Box>
        {withGames && (
          <Box component="span" data-testid="pickem-status" sx={{ fontSize: { xs: '15px', sm: '16px' }, fontVariantNumeric: 'tabular-nums' }}>
            <StatusWords status={status} compact={compact} onJump={jumpToCursor} />
          </Box>
        )}
      </Box>

      {withGames && confidence && (
        <>
          <Box component="p" data-testid="confidence-rule" sx={{ m: 0, fontSize: { xs: '15px', sm: '16px' }, maxWidth: '760px', textWrap: 'pretty' }}>
            <Box component="b" sx={{ fontWeight: 600 }}>Confidence league:</Box>
            {` give each game a rank from 1 to ${slateSize}, each used once. A correct pick earns its rank.`}
          </Box>
          <RankStrip confidence={confidence} total={slateSize} />
        </>
      )}

      <PickWeek weeks={weeks} value={week ?? undefined} onChange={setWeek} fill={compact} allWeeks={false} />

      {error && (
        <ErrorBox data-testid="pickem-board-error" message="We could not load this week's picks right now." onRetry={reload} />
      )}

      {loading && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }} aria-busy="true">
          <Frame tier="rule" component="div" head={<FrameHead><Skel width="180px" height={20} /></FrameHead>}>
            <GameCard loading />
          </Frame>
        </Box>
      )}

      {ready && windows.length === 0 && (
        <Frame tier="rule" component="div" sx={{ padding: '20px' }}>
          <Box component="p" data-testid="pickem-board-empty" sx={{ m: 0, fontSize: '16px', fontWeight: 600 }}>
            {week != null ? `No games scheduled for week ${week}.` : 'No week selected.'}
          </Box>
        </Frame>
      )}

      {withGames && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {windows.map((group) => (
            <KickoffWindowGroup
              key={group.window}
              window={group.window}
              views={group.games}
              mode={mode}
              totalManagers={totalManagers}
              slateSize={slateSize}
              usedByFor={usedByFor}
              stateFor={stateFor}
              cursorKey={cursorKey}
              cursorId={CURSOR_ID}
              scrollMarginTop={stripped ? 120 : 80}
              onPickWinner={onPickWinner}
              onSetConfidence={onSetConfidence}
              onUndo={onUndo}
              onRetry={onRetry}
            />
          ))}
        </Box>
      )}

      {withGames && <NumbersHelp terms={confidence ? [...NUMBERS, CONFIDENCE_TERM] : NUMBERS} />}
    </Box>
  );
}

// "{n} of {total} picked · {o} open · next lock {day time}", or "{total} of {total} picked · all saved".
// The words are plain text; "next lock" jumps to the cursor card (a 24px target on desktop, 44px on phone).
function StatusWords({ status, compact, onJump }) {
  const { picked, total, open, nextLock } = status;
  if (total > 0 && picked === total) {
    return (
      <>
        <Box component="b" sx={{ fontWeight: 600 }}>{`${picked} of ${total} picked`}</Box>
        {' · '}
        <Box component="span" sx={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          all saved
          <PixelCheck size={16} />
        </Box>
      </>
    );
  }
  const link = nextLock && open > 0 ? formatKickoff(nextLock) : null;
  return (
    <>
      <Box component="b" sx={{ fontWeight: 600 }}>{`${picked} of ${total} picked`}</Box>
      {open > 0 && <>{' · '}<Box component="span" sx={{ whiteSpace: 'nowrap' }}>{`${open} open`}</Box></>}
      {link && (
        <>
          {' · '}
          <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
            <Box
              component="a"
              href={`#${CURSOR_ID}`}
              onClick={onJump}
              sx={{
                color: 'var(--ps-ink)',
                textDecoration: 'underline',
                textDecorationThickness: '2px',
                textUnderlineOffset: '5px',
                textDecorationColor: 'var(--ps-dim)',
                display: 'inline-flex',
                alignItems: 'center',
                verticalAlign: 'middle',
                minHeight: compact ? '44px' : '24px',
                padding: compact ? '0 6px' : 0,
                margin: compact ? '-12px -6px' : '-2px 0',
              }}
            >
              {`next lock ${link}`}
            </Box>
          </Box>
        </>
      )}
    </>
  );
}

// The rank pool (confidence mode): one cell per rank, used ranks filled and numbered, free ranks
// outlined; a rank held by a kicked-off game carries a small lock. One image, cells hidden.
function RankStrip({ confidence, total }) {
  const { usedRanks, lockedRanks, left } = confidence;
  const description = `Ranks used: ${usedRanks.length ? usedRanks.join(', ') : 'none'}${lockedRanks.length ? `; locked to kicked-off games: ${lockedRanks.join(', ')}` : ''}`;
  return (
    <Box
      data-testid="rank-strip"
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 5,
        backgroundColor: 'var(--ps-field)',
        borderBottom: '2px solid var(--ps-rule)',
        padding: '8px 0',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '8px 20px',
      }}
    >
      <Box component="span" sx={{ fontSize: '16px', fontVariantNumeric: 'tabular-nums' }}>
        <Box component="b" sx={{ fontWeight: 600 }}>{`${left} ${left === 1 ? 'rank' : 'ranks'} left`}</Box>
      </Box>
      <Box
        role="img"
        aria-label={description}
        sx={{ display: 'inline-grid', gridTemplateColumns: `repeat(${total}, 24px)`, gap: '2px', maxWidth: '100%', overflowX: 'auto' }}
      >
        {Array.from({ length: total }, (unused, index) => {
          const rank = index + 1;
          const used = usedRanks.includes(rank);
          const locked = used && lockedRanks.includes(rank);
          return (
            <Box
              key={rank}
              component="span"
              aria-hidden="true"
              data-used={used || undefined}
              sx={{
                height: '24px',
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1px',
                fontSize: locked ? '12px' : '13px',
                fontWeight: 700,
                lineHeight: 1,
                ...(used
                  ? { backgroundColor: 'var(--ps-frame)', color: 'var(--ps-field)' }
                  : { border: '2px solid var(--ps-dim)', color: 'var(--ps-dim)' }),
              }}
            >
              {locked && (
                <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" shapeRendering="crispEdges" style={{ flex: 'none' }}>
                  <path d="M2 0h4v1H2zM1 1h1v2H1zM6 1h1v2H6zM0 3h8v5H0zM3 4v2h2V4z" fill="currentColor" fillRule="evenodd" />
                </svg>
              )}
              {rank}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
