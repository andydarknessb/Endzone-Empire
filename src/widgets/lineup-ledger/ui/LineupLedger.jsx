import React, { useEffect } from 'react';
import { Box, Typography, useMediaQuery, useTheme } from '@mui/material';
import { Card } from '../../../shared/ui';
import { buildLedgerSections } from '../model/buildLedgerSections';
import { useBenchPointsLeft } from '../model/useBenchPointsLeft';
import LedgerRow from './LedgerRow';

/**
 * The Ledger widget (CONTEXT.md's Ledger row; ADR 0037; #1237 AC1): Starters,
 * Bench and IR as Ledger rows, composed from `entities/roster`'s normalized
 * lineup entries plus the interaction state the page assembles from the
 * swap-players and drop-player features. Reads only `entities` and `shared`
 * (ADR 0020/0029): row grouping is this widget's own pure model
 * (`./model/buildLedgerSections.js`); every interaction decision (which row
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
 * The Bench card also carries AC5's bench-points-left line (this widget's
 * own `useBenchPointsLeft` read of the existing hindsight endpoint, keyed
 * off `leagueId` plus the `lineup` prop's own `teamId`/`season`), and
 * `onOpenDecisionCard` is forwarded to every occupied row so its player name
 * can open the page-owned Decision card (#1240; see `../index.js`'s
 * below-island edges note for why that control lives below the island).
 *
 * Below `sm`, selecting a row asks the page to switch to whichever section
 * actually holds an eligible target for it (`onMobileTabChange`; #1425: the
 * bug report was a manager stuck on Starters after selecting a starter whose
 * only legal targets sat on the hidden Bench view). This widget owns that
 * rule (it already receives `selectedEntryId` and `isEligibleTarget`, and its
 * own `buildLedgerSections` rows are what "eligible target" is asked about),
 * not the page - see the effect below for the exact rule. Moving focus to the
 * bar button the switch lands on is the page's job, since the bar is its own.
 */
export default function LineupLedger({
  leagueId,
  lineup,
  league,
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
  const entries = Array.isArray(lineup?.entries) ? lineup.entries : [];
  const { starters, bench, ir } = buildLedgerSections({
    entries,
    rosterSlots: lineup?.rosterSlots || [],
    benchSlots: lineup?.benchSlots,
    irSlots: lineup?.irSlots,
  });

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

  // AC5: "the bench points left on the table line reads the existing
  // hindsight endpoint" (formal review finding ac5-hindsight-line-missing).
  const benchPointsLeft = useBenchPointsLeft({ leagueId, teamId: lineup?.teamId, season: lineup?.season });

  // Reserve the Drop track on every row when any row can drop (a spent row
  // has no Drop but must keep the same numbers edge).
  const reserveDropTrack = [...starters, ...ir, ...bench].some((row) => row.entry && !row.entry.spent && canDropEntry?.(row.entry));

  const rowProps = (row) => {
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
      disabled: Boolean(disabled) || Boolean(entry?.spent) || (rowShowsEligibility && !eligible),
      canDrop: Boolean(entry && !entry.spent && canDropEntry?.(entry)),
      reserveDropTrack,
      onClick: (event) => onRowClick?.(entry, row.slotType, event),
      onRequestDrop,
      onOpenDecisionCard,
    };
  };

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '16px' }}>
      <Box data-testid="ledger-starters-section" sx={{ display: mobileTab === 'starters' ? 'block' : { xs: 'none', sm: 'block' } }}>
        <Card title="Starters" data-testid="ledger-starters">
          <Box sx={{ p: { xs: '8px', sm: '12px' } }}>
            {starters.map((row) => {
              const { key, ...props } = rowProps(row);
              return <LedgerRow key={key} {...props} />;
            })}
          </Box>
        </Card>
      </Box>

      <Box data-testid="ledger-bench-section" sx={{ display: mobileTab === 'bench' ? 'block' : { xs: 'none', sm: 'block' } }}>
        {ir.length > 0 && (
          <Card title="IR" data-testid="ledger-ir" sx={{ mb: '16px' }}>
            <Box sx={{ p: { xs: '8px', sm: '12px' } }}>
              {ir.map((row) => {
                const { key, ...props } = rowProps(row);
                return <LedgerRow key={key} {...props} />;
              })}
            </Box>
          </Card>
        )}
        <Card title="Bench" data-testid="ledger-bench">
          {benchPointsLeft.text && (
            <Typography
              component="p"
              data-testid="bench-points-left"
              sx={{ m: 0, px: '12px', pt: '10px', fontSize: '12px', color: 'var(--dash-faint)' }}
            >
              {benchPointsLeft.text}
            </Typography>
          )}
          <Box data-testid="ledger-bench-rows" sx={{ p: { xs: '8px', sm: '12px' } }}>
            {bench.map((row) => {
              const { key, ...props } = rowProps(row);
              return <LedgerRow key={key} {...props} />;
            })}
          </Box>
        </Card>
      </Box>
    </Box>
  );
}
