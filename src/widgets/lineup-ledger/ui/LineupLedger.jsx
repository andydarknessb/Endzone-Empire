import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography, useMediaQuery, useTheme } from '@mui/material';
import { Card } from '../../../shared/ui';
import { MIN_TOUCH_TARGET_SX } from '../../../shared/lib';
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
 * Bench, each card full width, no inner scroll. Below `sm` (AC8) the
 * sections are switched by a fixed bottom tab bar (Starters / Bench, with IR
 * folding into the Bench tab exactly as the Bench+IR group already sits
 * together) - each tab button is a 44px touch target
 * (`MIN_TOUCH_TARGET_SX`, `src/shared/lib/a11y`) and carries a count
 * (`Starters 8/9`, `Bench 6`, #1957 L6). The page around this widget owns its
 * own vertical scrolling; nothing here forces horizontal scroll (rows are a
 * fixed grid whose name truncates).
 *
 * The Bench card also carries AC5's bench-points-left line (this widget's
 * own `useBenchPointsLeft` read of the existing hindsight endpoint, keyed
 * off `leagueId` plus the `lineup` prop's own `teamId`/`season`), and
 * `onOpenDecisionCard` is forwarded to every occupied row so its player name
 * can open the page-owned Decision card (#1240; see `../index.js`'s
 * below-island edges note for why that control lives below the island).
 *
 * `footer` (optional node) is rendered inside the bottom-sticky container,
 * directly above the phone tab bar, so a page-owned sticky strip and the tab
 * bar stack instead of overlapping.
 *
 * Below `sm`, selecting a row auto-switches the tab bar to whichever
 * section actually holds an eligible target for it (#1425: the bug report
 * was a manager stuck on Starters after selecting a starter whose only
 * legal targets sat on the hidden Bench tab). This widget owns that flip
 * (it already receives `selectedEntryId` and `isEligibleTarget`, and its own
 * `buildLedgerSections` rows are what "eligible target" is asked about), not
 * the page - see the effect below for the exact rule.
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
  footer,
}) {
  const [mobileTab, setMobileTab] = useState('starters');
  const theme = useTheme();
  // Below `sm` only (#1425 ruling): at `sm` and up both sections are always
  // visible (the Box `sx` below only hides one at `xs`), so the
  // tab-bar-driven flip below has no useful effect there and AC7
  // requires it never fires. jsdom does not evaluate the `sx` breakpoints
  // that hide/show the two sections, so this is the one place that decision
  // is made in JS - the same `useMediaQuery(theme.breakpoints.down('sm'))`
  // read `LineupPage.jsx`'s own `compact` already uses.
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  // Which tab button the auto-switch effect below should move focus to once
  // it lands (accessibility risk review finding, #1425) - `null` when the
  // current `mobileTab` state came from the manager's own tab click instead.
  const pendingTabFocusRef = useRef(null);
  const startersTabButtonRef = useRef(null);
  const benchTabButtonRef = useRef(null);
  const entries = Array.isArray(lineup?.entries) ? lineup.entries : [];
  const { starters, bench, ir } = buildLedgerSections({
    entries,
    rosterSlots: lineup?.rosterSlots || [],
    benchSlots: lineup?.benchSlots,
    irSlots: lineup?.irSlots,
  });

  // #1425 ruling: selecting a row can hide its own eligible targets behind
  // the inactive mobile tab (the bug report). Flip to whichever section
  // actually holds an eligible target for the row just selected - Starters
  // to Bench (which folds in IR) or back, never a flip when the OTHER
  // section has no eligible target at all (AC3: stays on Starters when only
  // a starter-for-starter target exists). Keyed on `selectedEntryId` alone,
  // not on `isEligibleTarget` (a fresh closure every render): a cleared
  // selection - cancel or a completed swap - is `null` here and the effect
  // returns immediately without touching `mobileTab` (AC6, "no flip back").
  //
  // Risk review finding (accessibility, #1425): the row the manager just
  // activated sits inside the section that is about to become
  // `display:none`, and a hidden focused element is dropped to `<body>` per
  // the HTML spec (not a "mobile only" edge case either - WCAG 1.4.10
  // reflow puts a zoomed desktop keyboard user below `sm` too). `setMobileTab`
  // here only records WHICH tab to land on; `pendingTabFocusRef` below is
  // what actually moves focus once that tab's button exists in the DOM.
  useEffect(() => {
    if (!isMobile || selectedEntryId == null) return;
    const inStarters = starters.some((row) => row.entry && row.entry.playerId === selectedEntryId);
    const benchAndIr = [...ir, ...bench];
    if (inStarters) {
      if (benchAndIr.some((row) => isEligibleTarget?.(row.entry, row.slotType))) {
        pendingTabFocusRef.current = 'bench';
        setMobileTab('bench');
      }
      return;
    }
    const inBenchOrIr = benchAndIr.some((row) => row.entry && row.entry.playerId === selectedEntryId);
    if (inBenchOrIr && starters.some((row) => isEligibleTarget?.(row.entry, row.slotType))) {
      pendingTabFocusRef.current = 'starters';
      setMobileTab('starters');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntryId, isMobile]);

  // Risk review finding (accessibility, #1425): moves focus to the tab the
  // auto-switch above just landed on, once that tab's button is actually in
  // the DOM (this effect runs after the render `setMobileTab` triggered).
  // This both restores the focus the hidden section's button lost and is
  // the manager's only signal the section changed - a real screen-reader
  // announcement ("Bench, toggle button, pressed") - without adding a
  // second live region (ADR 0037 keeps the Snackbar the page's only one).
  // A manager who switches the tab by hand never hits this: their click
  // already carries focus, so `pendingTabFocusRef` stays unset and this
  // effect is a no-op.
  useEffect(() => {
    if (pendingTabFocusRef.current !== mobileTab) return;
    pendingTabFocusRef.current = null;
    (mobileTab === 'bench' ? benchTabButtonRef : startersTabButtonRef).current?.focus();
  }, [mobileTab]);

  // AC5: "the bench points left on the table line reads the existing
  // hindsight endpoint" (formal review finding ac5-hindsight-line-missing).
  const benchPointsLeft = useBenchPointsLeft({ leagueId, teamId: lineup?.teamId, season: lineup?.season });

  // L6: the phone tab labels carry counts. Starters counts filled seats
  // (a spent row starts nobody, so it is not one); Bench counts occupied
  // Bench and IR rows, the same group its tab shows.
  const startersFilled = starters.filter((row) => row.entry && !row.entry.spent).length;
  const benchCount = [...ir, ...bench].filter((row) => row.entry).length;

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
    <>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '16px' }}>
        <Box sx={{ display: mobileTab === 'starters' ? 'block' : { xs: 'none', sm: 'block' } }}>
          <Card title="Starters" data-testid="ledger-starters">
            <Box sx={{ p: { xs: '8px', sm: '12px' } }}>
              {starters.map((row) => {
                const { key, ...props } = rowProps(row);
                return <LedgerRow key={key} {...props} />;
              })}
            </Box>
          </Card>
        </Box>

        <Box sx={{ display: mobileTab === 'bench' ? 'block' : { xs: 'none', sm: 'block' } }}>
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

      {/* Bottom tab bar (AC8): only below `sm`, where the two columns above
          collapse to one. Plain toggle buttons with `aria-pressed`, NOT
          `role="tablist"`/`role="tab"`: the ARIA tabs pattern is a
          behavioural contract (arrow-key roving tabindex, `aria-controls`
          pointing at a real `role="tabpanel"`) this pair does not implement,
          and reviewed as a violation for exactly that reason - a screen
          reader trains a user to press Left/Right on a "tab" and nothing
          would happen. `aria-pressed` makes the same true claim ("this
          control is a toggle, and here is its state") without promising
          keyboard behaviour that isn't there, matching PickWeek's own
          "All weeks" toggle button (src/features/pick-week/ui/PickWeek.jsx). */}
      {/* One bottom-sticky container (#1957): the optional `footer` (the page's
          move strip) stacked directly above the phone tab bar, so two sticky
          siblings never overlap. Below `sm` both show; from `sm` the tab bar
          is hidden and a footer floats alone 16px off the bottom. With no
          footer it holds just the tab bar and is hidden from `sm`. */}
      <Box
        data-testid="lineup-sticky-footer"
        sx={{
          display: footer ? 'flex' : { xs: 'flex', sm: 'none' },
          flexDirection: 'column',
          gap: '8px',
          position: 'sticky',
          bottom: { xs: 0, sm: 16 },
          zIndex: 1,
          mt: '12px',
          backgroundColor: { xs: 'var(--dash-bg)', sm: 'transparent' },
        }}
      >
        {footer}
        <Box
          role="group"
          aria-label="Lineup section"
          data-testid="lineup-mobile-tabs"
          sx={{
            display: { xs: 'flex', sm: 'none' },
            border: '1px solid var(--dash-line)',
            borderRadius: 'var(--dash-radius-sm)',
            overflow: 'hidden',
            backgroundColor: 'var(--dash-surface)',
          }}
        >
          {[
            { key: 'starters', label: `Starters ${startersFilled}/${starters.length}`, name: `Starters, ${startersFilled} of ${starters.length} filled` },
            { key: 'bench', label: `Bench ${benchCount}`, name: `Bench, ${benchCount} ${benchCount === 1 ? 'player' : 'players'}` },
          ].map((tab) => (
            <Box
              key={tab.key}
              component="button"
              type="button"
              ref={tab.key === 'starters' ? startersTabButtonRef : benchTabButtonRef}
              aria-label={tab.name}
              aria-pressed={mobileTab === tab.key}
              onClick={() => setMobileTab(tab.key)}
              sx={{
                ...MIN_TOUCH_TARGET_SX,
                flex: '1 1 0',
                border: 'none',
                borderRight: tab.key === 'starters' ? '1px solid var(--dash-line)' : 'none',
                backgroundColor: mobileTab === tab.key ? 'var(--dash-accent-soft)' : 'transparent',
                color: mobileTab === tab.key ? 'var(--dash-accent)' : 'var(--dash-dim)',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </Box>
          ))}
        </Box>
      </Box>
    </>
  );
}
