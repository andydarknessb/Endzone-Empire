import React, { useEffect } from 'react';
import { Box, useMediaQuery, useTheme } from '@mui/material';
import { Frame, FrameHead, PixelHeading } from '../../../shared/ui/playselect';
import { spent } from '../../../entities/roster';
import LedgerRow from './LedgerRow';

const EMPTY_SECTIONS = { starters: [], bench: [], ir: [] };

/**
 * The Ledger widget (CONTEXT.md's Ledger row; ADR 0037; #1237 AC1): Starters,
 * Bench and IR as Ledger rows, composed from `entities/roster`'s normalized
 * lineup entries plus the interaction state the page assembles from the
 * swap-players and drop-player features. Reads only `entities` and `shared`
 * (ADR 0020/0029): row grouping is the Roster entity's (`useTeamLineup`'s
 * `sections`, #2146), handed in as the `sections` prop; every interaction decision (which row
 * is selected, which target is eligible, whether a row may be dropped) is
 * computed by the page from the features it composes and handed down as
 * plain props, so this widget never imports a feature.
 *
 * One column at every width (#1957 L1): Starters, then IR when present, then
 * Bench, each card full width, no inner scroll. Below `sm` (AC8) the sections
 * are switched by `mobileTab`, which the page owns (#1965): `'starters'` shows
 * Starters, `'bench'` shows IR plus Bench (IR folds into the Bench view exactly
 * as the Bench+IR group already sits together), and any other value (the
 * page's Outlook view) shows neither. From `sm` both always show. The bar that
 * picks the view, and the sticky container it shares with the page's move
 * strip, are the page's too: a bar inside this widget could not stay on screen
 * once the roster column is hidden for Outlook. The page around this widget
 * owns its own vertical scrolling; nothing here forces horizontal scroll (rows
 * are a fixed grid whose name truncates).
 *
 * Play-select (ADR 0067 wave 3): Starters and Bench are primary frames, IR a tertiary one. The Bench card
 * no longer prints its own "Bench points this season" line: it is the same quantity as the Forecast's
 * "Left on the bench this season", which says it once. The page's one cursor lands on the row named by
 * `cursorKey` (its frame `'urgent'` under one hour from the lock), and `cursorNote` is the lineup note
 * that row carries. `onOpenDecisionCard` is forwarded to every occupied row so its player name can open
 * the page-owned Decision card (#1240; see `../index.js`'s below-island edges note for why that control
 * lives below the island).
 *
 * Below `sm`, selecting a row asks the page to switch to whichever section
 * actually holds an eligible target for it (`onMobileTabChange`; #1425: the
 * bug report was a manager stuck on Starters after selecting a starter whose
 * only legal targets sat on the hidden Bench view). This widget owns that
 * rule (it already receives `selectedEntryId` and `isEligibleTarget`, and its
 * `sections` rows are what "eligible target" is asked about),
 * not the page - see the effect below for the exact rule. Moving focus to the
 * bar button the switch lands on is the page's job, since the bar is its own.
 */
export default function LineupLedger({
  sections,
  liveGamesByKey,
  disabled,
  showEligibility,
  isEligibleTarget,
  isSwapHighlighted,
  selectedEntryId,
  onRowClick,
  canDropEntry,
  onRequestDrop,
  onOpenDecisionCard,
  mobileTab,
  onMobileTabChange,
  cursorKey = null,
  cursorTone = true,
  cursorNote = null,
}) {
  const theme = useTheme();
  // Below `sm` only (#1425 ruling): at `sm` and up both sections are always
  // visible (the Box `sx` below only hides one at `xs`), so the section flip
  // below has no useful effect there and AC7 requires it never fires. jsdom
  // does not evaluate the `sx` breakpoints that hide/show the two sections, so
  // this is the one place that decision is made in JS - the same
  // `useMediaQuery(theme.breakpoints.down('sm'))` read `LineupPage.jsx`'s own
  // `compact` already uses.
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const { starters, bench, ir } = sections || EMPTY_SECTIONS;

  // #1425 ruling: selecting a row can hide its own eligible targets behind
  // the inactive mobile section (the bug report). Ask the page to flip to
  // whichever section actually holds an eligible target for the row just
  // selected - Starters to Bench (which folds in IR) or back, never a flip
  // when the OTHER section has no eligible target at all (AC3: stays on
  // Starters when only a starter-for-starter target exists). Keyed on
  // `selectedEntryId` alone, not on `isEligibleTarget` (a fresh closure every
  // render): a cleared selection - cancel or a completed swap - is `null` here
  // and the effect returns immediately without asking for anything (AC6, "no
  // flip back").
  //
  // Risk review finding (accessibility, #1425): the row the manager just
  // activated sits inside the section that is about to become `display:none`,
  // and a hidden focused element is dropped to `<body>` per the HTML spec (not
  // a "mobile only" edge case either - WCAG 1.4.10 reflow puts a zoomed
  // desktop keyboard user below `sm` too). `onMobileTabChange` only says WHICH
  // section to land on; the page, which owns the bar, moves focus to that
  // section's button once it renders (see LineupPage.jsx).
  useEffect(() => {
    if (!isMobile || selectedEntryId == null) return;
    const inStarters = starters.some((row) => row.entry && row.entry.playerId === selectedEntryId);
    const benchAndIr = [...ir, ...bench];
    if (inStarters) {
      if (benchAndIr.some((row) => isEligibleTarget?.(row.entry, row.slotType))) onMobileTabChange?.('bench');
      return;
    }
    const inBenchOrIr = benchAndIr.some((row) => row.entry && row.entry.playerId === selectedEntryId);
    if (inBenchOrIr && starters.some((row) => isEligibleTarget?.(row.entry, row.slotType))) onMobileTabChange?.('starters');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntryId, isMobile]);

  // Reserve the Drop track on every row when any row can drop (a spent row
  // has no Drop but must keep the same numbers edge).
  const reserveDropTrack = [...starters, ...ir, ...bench].some((row) => row.entry && !spent(row.entry) && canDropEntry?.(row.entry));

  const rowProps = (row, last) => {
    const entry = row.entry;
    const isSelected = Boolean(entry && selectedEntryId != null && entry.playerId === selectedEntryId);
    const rowShowsEligibility = Boolean(showEligibility) && !isSelected;
    const eligible = rowShowsEligibility ? Boolean(isEligibleTarget?.(entry, row.slotType)) : false;
    return {
      key: row.key,
      'data-testid': row.testId,
      slotLabel: row.slotLabel,
      entry,
      liveRow: entry && entry.gameKey ? liveGamesByKey?.get(String(entry.gameKey)) : null,
      selected: isSelected,
      swapHighlighted: Boolean(entry && isSwapHighlighted?.(entry)),
      showEligibility: rowShowsEligibility,
      eligible,
      // A row that is showing eligibility and isn't a legal target is fully
      // disabled while a selection is active, the same rule
      // LineupScreen.jsx's own `disabled` computation used - only the
      // selected row itself (excluded from `rowShowsEligibility` above) and
      // a genuinely eligible target stay clickable during a swap.
      disabled: Boolean(disabled) || spent(entry) || (rowShowsEligibility && !eligible),
      canDrop: Boolean(entry && !spent(entry) && canDropEntry?.(entry)),
      reserveDropTrack,
      onClick: (event) => onRowClick?.(entry, row.slotType, event),
      onRequestDrop,
      onOpenDecisionCard,
      last,
      cursor: cursorKey != null && row.key === cursorKey ? cursorTone : false,
      note: cursorKey != null && row.key === cursorKey ? cursorNote : null,
    };
  };

  const rows = (list) => list.map((row, i) => {
    const { key, ...props } = rowProps(row, i === list.length - 1);
    return <LedgerRow key={key} {...props} />;
  });
  const listSx = { listStyle: 'none', m: 0, p: { xs: '2px 6px 6px', sm: '4px 12px 8px' } };

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '16px' }}>
      <Box data-testid="ledger-starters-section" sx={{ display: mobileTab === 'starters' ? 'block' : { xs: 'none', sm: 'block' } }}>
        <Frame labelledBy="ledger-starters-h" data-testid="ledger-starters" head={<FrameHead><PixelHeading id="ledger-starters-h">Starters</PixelHeading></FrameHead>}>
          <Box component="ul" sx={listSx}>{rows(starters)}</Box>
        </Frame>
      </Box>

      <Box data-testid="ledger-bench-section" sx={{ display: mobileTab === 'bench' ? 'block' : { xs: 'none', sm: 'block' } }}>
        {ir.length > 0 && (
          <Frame tier="rule" labelledBy="ledger-ir-h" data-testid="ledger-ir" sx={{ mb: '16px' }} head={<FrameHead><PixelHeading id="ledger-ir-h" size={16}>IR</PixelHeading></FrameHead>}>
            <Box component="ul" sx={listSx}>{rows(ir)}</Box>
          </Frame>
        )}
        <Frame labelledBy="ledger-bench-h" data-testid="ledger-bench" head={<FrameHead><PixelHeading id="ledger-bench-h">Bench</PixelHeading></FrameHead>}>
          <Box component="ul" data-testid="ledger-bench-rows" sx={listSx}>{rows(bench)}</Box>
        </Frame>
      </Box>
    </Box>
  );
}
