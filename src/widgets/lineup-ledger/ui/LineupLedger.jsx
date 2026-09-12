import React, { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { Card } from '../../../shared/ui';
import { MIN_TOUCH_TARGET_SX } from '../../../lib/a11y';
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
 * Desktop: Starters in one column, Bench+IR in the other (mirroring the
 * legacy page's own two-column split). Below `sm` (AC8) the two columns
 * collapse into a single column switched by a fixed bottom tab bar (Starters
 * / Bench, with IR folding into the Bench tab exactly as the desktop's own
 * Bench+IR card already groups them) - each tab button is a 44px touch
 * target (`MIN_TOUCH_TARGET_SX`, `src/lib/a11y`). The page around this
 * widget owns its own vertical scrolling; nothing here forces horizontal
 * scroll (rows wrap rather than overflow).
 *
 * The Bench card also carries AC5's bench-points-left line (this widget's
 * own `useBenchPointsLeft` read of the existing hindsight endpoint, keyed
 * off `leagueId` plus the `lineup` prop's own `teamId`/`season`), and
 * `onOpenDecisionCard` is forwarded to every occupied row so its player name
 * can open the page-owned Decision card (#1240; see `../index.js`'s
 * below-island edges note for why that control lives below the island).
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
}) {
  const [mobileTab, setMobileTab] = useState('starters');
  const entries = Array.isArray(lineup?.entries) ? lineup.entries : [];
  const { starters, bench, ir } = buildLedgerSections({
    entries,
    rosterSlots: lineup?.rosterSlots || [],
    benchSlots: lineup?.benchSlots,
    irSlots: lineup?.irSlots,
  });
  // AC5: "the bench points left on the table line reads the existing
  // hindsight endpoint" (formal review finding ac5-hindsight-line-missing).
  const benchPointsLeft = useBenchPointsLeft({ leagueId, teamId: lineup?.teamId, season: lineup?.season });

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
      onClick: (event) => onRowClick?.(entry, row.slotType, event),
      onRequestDrop,
      onOpenDecisionCard,
    };
  };

  return (
    <>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '16px' }}>
        <Box sx={{ display: mobileTab === 'starters' ? 'block' : { xs: 'none', sm: 'block' } }}>
          <Card title="Starters" data-testid="ledger-starters">
            <Box sx={{ p: '12px' }}>
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
              <Box sx={{ p: '12px' }}>
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
            <Box sx={{ p: '12px', maxHeight: { sm: 560 }, overflowY: { sm: 'auto' } }}>
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
      <Box
        role="group"
        aria-label="Lineup section"
        data-testid="lineup-mobile-tabs"
        sx={{
          display: { xs: 'flex', sm: 'none' },
          position: 'sticky',
          bottom: 0,
          zIndex: 1,
          mt: '12px',
          border: '1px solid var(--dash-line)',
          borderRadius: 'var(--dash-radius-sm)',
          overflow: 'hidden',
          backgroundColor: 'var(--dash-surface)',
        }}
      >
        {[
          { key: 'starters', label: 'Starters' },
          { key: 'bench', label: 'Bench' },
        ].map((tab) => (
          <Box
            key={tab.key}
            component="button"
            type="button"
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
    </>
  );
}
