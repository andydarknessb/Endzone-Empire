import React, { useState } from 'react';
import { Box } from '@mui/material';
import { Card } from '../../../shared/ui';
import { MIN_TOUCH_TARGET_SX } from '../../../lib/a11y';
import { buildLedgerSections } from '../model/buildLedgerSections';
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
 */
export default function LineupLedger({
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
}) {
  const [mobileTab, setMobileTab] = useState('starters');
  const entries = Array.isArray(lineup?.entries) ? lineup.entries : [];
  const { starters, bench, ir } = buildLedgerSections({
    entries,
    rosterSlots: lineup?.rosterSlots || [],
    benchSlots: lineup?.benchSlots,
    irSlots: lineup?.irSlots,
  });

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
          collapse to one. `role="tablist"`/`role="tab"` names the pair
          without inventing a bespoke pattern; `aria-selected` carries which
          panel is showing since the panels above are plain, unlabelled Boxes
          rather than full tabpanel semantics (the page's own landmarks
          already carry the real navigable structure). */}
      <Box
        role="tablist"
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
            role="tab"
            aria-selected={mobileTab === tab.key}
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
