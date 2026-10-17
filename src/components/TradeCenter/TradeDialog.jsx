import React, { useEffect, useRef } from 'react';
import { Box, Dialog } from '@mui/material';
import { formatPoints } from '../../shared/lib/numeric';
import { PsButton } from '../../shared/ui/playselect/Controls';
import { PixelCheck } from '../../shared/ui/playselect/Icons';
import { PosTag } from '../../shared/ui/playselect/Marks';
import { psRootSx } from '../../shared/ui/playselect/root';
import { SR_ONLY_SX, pixelSx } from '../../shared/ui/playselect/type';
import { AnalysisError, AnalysisResult, useTradeAnalysis } from './TradeAnalysis';
import TradeAlert from './TradeAlert';

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/** Position-grouped, in QB/RB/WR/TE/K/DEF order, with anything else appended after. */
function groupPlayersByPosition(players) {
  const byPosition = new Map();
  for (const player of players) {
    const key = player.position || 'Other';
    if (!byPosition.has(key)) byPosition.set(key, []);
    byPosition.get(key).push(player);
  }
  const orderedKeys = [
    ...POSITION_ORDER.filter((pos) => byPosition.has(pos)),
    ...[...byPosition.keys()].filter((pos) => !POSITION_ORDER.includes(pos)),
  ];
  return orderedKeys.map((position) => ({ position, players: byPosition.get(position) }));
}

// Check square, position tag, name, then the two right-aligned figures.
const GRID = {
  display: 'grid',
  gridTemplateColumns: { xs: '24px 44px minmax(0, 1fr) 56px 48px', sm: '24px 44px minmax(0, 1fr) 72px 56px' },
  alignItems: 'center',
  gap: { xs: '8px', sm: '10px' },
};

const FIGURE = {
  textAlign: 'right', fontSize: '14px', color: 'var(--ps-dim)', fontVariantNumeric: 'tabular-nums',
};

/** One roster column: players grouped under their position, one 44px checkbox row each. */
function RosterColumn({
  label, players, selectedIds, onToggle, testId, firstRef,
}) {
  const rows = groupPlayersByPosition(players || []).flatMap(({ players: group }) => group);
  return (
    <Box data-testid={testId} sx={{ minWidth: 0 }}>
      <Box component="h3" sx={{ m: '0 0 8px', fontSize: '16px', fontWeight: 700 }}>{label}</Box>
      <Box
        aria-hidden="true"
        sx={{
          ...GRID, fontSize: '13px', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ps-dim)', lineHeight: 1.2, pb: '6px', borderBottom: '2px solid var(--ps-rule)',
        }}
      >
        <span />
        <span />
        <span />
        <Box component="span" sx={{ textAlign: 'right' }}>Weekly proj</Box>
        <Box component="span" sx={{ textAlign: 'right' }}>ROS</Box>
      </Box>
      {rows.map((player, i) => {
        const checked = selectedIds.has(player.id);
        const newGroup = i > 0 && rows[i - 1].position !== player.position;
        return (
          <Box
            component="label"
            key={player.id}
            sx={{
              ...GRID,
              minHeight: '44px',
              cursor: 'pointer',
              position: 'relative',
              ...(i ? { borderTop: `2px solid var(--ps-${newGroup ? 'dim' : 'rule'})` } : null),
              '&:has(input:focus-visible)': { outline: '3px solid var(--ps-focus)', boxShadow: '0 0 0 7px var(--ps-halo)' },
            }}
          >
            <Box
              component="input"
              type="checkbox"
              ref={i === 0 ? firstRef : undefined}
              checked={checked}
              onChange={() => onToggle(player.id)}
              aria-label={[
                `${player.name} (${player.position})`,
                player.projected_weekly_points != null ? `weekly proj ${player.projected_weekly_points}` : null,
                player.rest_of_season_points != null ? `ROS ${player.rest_of_season_points}` : null,
              ].filter(Boolean).join(' · ')}
              sx={SR_ONLY_SX}
            />
            <Box
              component="span"
              aria-hidden="true"
              sx={{
                display: 'grid',
                placeItems: 'center',
                width: '24px',
                height: '24px',
                boxSizing: 'border-box',
                border: '2px solid var(--ps-ink)',
                ...(checked ? { backgroundColor: 'var(--ps-ink)', color: 'var(--ps-panel)' } : { color: 'var(--ps-ink)' }),
              }}
            >
              {checked && <PixelCheck />}
            </Box>
            <PosTag position={player.position} />
            <Box component="span" sx={{ fontSize: '15px', fontWeight: checked ? 700 : 600, minWidth: 0, overflowWrap: 'anywhere' }}>{player.name}</Box>
            <Box component="span" aria-hidden="true" sx={FIGURE}>{formatPoints(player.projected_weekly_points)}</Box>
            <Box component="span" aria-hidden="true" sx={FIGURE}>{formatPoints(player.rest_of_season_points)}</Box>
          </Box>
        );
      })}
    </Box>
  );
}

/** A "You send (n): <chips>" / "You receive (n): <chips>" scannable summary row. */
function SummaryChipRow({ label, ids, roster }) {
  const idList = [...ids];
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
      <Box component="b" sx={{ fontSize: '15px', fontWeight: 700 }}>{`${label} (${idList.length}):`}</Box>
      {idList.length === 0 ? (
        <Box component="span" sx={{ fontSize: '15px', color: 'var(--ps-dim)' }}>none selected</Box>
      ) : (
        idList.map((id) => (
          <Box
            component="span"
            key={id}
            sx={{
              display: 'inline-flex', alignItems: 'center', height: '28px', padding: '0 10px', boxSizing: 'border-box', border: '2px solid var(--ps-rule)', fontSize: '14px', fontWeight: 600,
            }}
          >
            {roster?.players?.find((p) => p.id === id)?.name || `#${id}`}
          </Box>
        ))
      )}
    </Box>
  );
}

// Focus lands from an effect inside the dialog, not from `autoFocus`: under StrictMode the focus trap restores
// focus to the opener between its two effect runs, and a child's effect runs before the trap's each time.
function FocusOnMount({ target }) {
  useEffect(() => { target.current?.focus(); }, [target]);
  return null;
}

const selectSx = {
  width: '100%',
  minHeight: '44px',
  boxSizing: 'border-box',
  padding: '0 12px',
  border: '2px solid var(--ps-ink)',
  borderRadius: 0,
  backgroundColor: 'var(--ps-panel)',
  color: 'var(--ps-ink)',
  font: 'inherit',
  fontSize: '16px',
  '&:disabled': { borderColor: 'var(--ps-rule)', color: 'var(--ps-dim)', cursor: 'not-allowed' },
};

/**
 * The propose / counter dialog (docs/design/league TradePropose board): a modal on a 6px double frame, so
 * its Send Offer is the one filled button on the page. Focus opens on "Trade with"; on a counter or a deep
 * link the team is already chosen, so it opens on the first "You send" checkbox. A refused send keeps the
 * dialog open and says why inside it, above the footer. Closing hands focus back to the opener (MUI's focus
 * trap restores it). The analysis runs by itself 600ms after the selection changes.
 */
export default function TradeDialog({
  open,
  onClose,
  title,
  leagueId,
  counter,
  otherTeams,
  selectedTeamId,
  onTeamChange,
  myRoster,
  theirRoster,
  sendIds,
  receiveIds,
  onToggleSend,
  onToggleReceive,
  onSend,
  sendError,
  sending,
  onOpenPlayer,
  compact,
}) {
  const analysis = useTradeAnalysis(leagueId);
  const { run, reset } = analysis;
  const offered = [...sendIds];
  const requested = [...receiveIds];
  const teamChosen = selectedTeamId !== '';
  // Focus lands on "Trade with" unless the team was already chosen when the dialog opened (a counter, a deep link).
  const focusCheckbox = useRef(teamChosen);
  const initialFocus = useRef(null);
  const errorRef = useRef(null);
  // The body scrolls under a pinned footer: a refusal at its end must not land out of sight.
  useEffect(() => {
    if (sendError) errorRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [sendError]);

  // Fires ~600ms after the offered/requested ids last changed, rather than waiting for a click.
  useEffect(() => {
    reset();
    if (!open || offered.length === 0 || requested.length === 0) return undefined;
    const handle = setTimeout(() => {
      run({ receivingTeamId: selectedTeamId, offeredPlayerIds: offered, requestedPlayerIds: requested });
    }, 600);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedTeamId, offered.join(','), requested.join(','), run, reset]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      fullScreen={compact}
      transitionDuration={0}
      aria-labelledby="trade-dialog-title"
      PaperProps={{
        className: 'ps-root',
        sx: {
          ...psRootSx,
          display: 'flex',
          flexDirection: 'column',
          border: '6px double var(--ps-frame)',
          borderRadius: 0,
          backgroundColor: 'var(--ps-panel)',
          backgroundImage: 'none',
          boxShadow: 'none',
          ...(compact ? { margin: 0 } : null),
        },
      }}
    >
      <FocusOnMount target={initialFocus} />
      <Box sx={{ padding: { xs: '12px 14px', sm: '14px 20px' }, borderBottom: '2px solid var(--ps-rule)' }}>
        <Box component="h2" id="trade-dialog-title" sx={{ m: 0, ...pixelSx(16) }}>{title}</Box>
      </Box>

      <Box
        sx={{
          flex: 1, minHeight: 0, overflowY: 'auto', padding: { xs: '14px', sm: '20px' }, display: 'flex', flexDirection: 'column', gap: '20px',
        }}
      >
        <Box>
          <Box component="label" htmlFor="trade-with-select" sx={{ display: 'block', mb: '6px', fontSize: '15px', fontWeight: 600 }}>Trade with</Box>
          <Box
            component="select"
            id="trade-with-select"
            value={selectedTeamId}
            disabled={counter}
            ref={focusCheckbox.current ? undefined : initialFocus}
            onChange={(e) => onTeamChange(e.target.value === '' ? '' : Number(e.target.value))}
            sx={selectSx}
          >
            <option value="" />
            {otherTeams.map((team) => (
              <option key={team.teamId} value={team.teamId}>{team.teamName}</option>
            ))}
          </Box>
        </Box>

        {teamChosen && (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: { xs: '24px', sm: '32px' } }}>
            <RosterColumn
              label="You send"
              players={myRoster?.players}
              selectedIds={sendIds}
              onToggle={onToggleSend}
              testId="roster-column-send"
              firstRef={focusCheckbox.current ? initialFocus : undefined}
            />
            <RosterColumn
              label="You receive"
              players={theirRoster?.players}
              selectedIds={receiveIds}
              onToggle={onToggleReceive}
              testId="roster-column-receive"
            />
          </Box>
        )}

        {/* Mounted before it speaks, so "Analyzing…" is announced; out of sight while empty. */}
        <Box role="status" sx={analysis.analyzing ? { fontSize: '15px', color: 'var(--ps-dim)' } : SR_ONLY_SX}>
          {analysis.analyzing ? 'Analyzing…' : ''}
        </Box>

        {teamChosen && offered.length > 0 && requested.length > 0 && (
          <Box sx={{ borderTop: '2px solid var(--ps-rule)', pt: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <AnalysisError error={analysis.error} />
            {analysis.result && <AnalysisResult result={analysis.result} onOpenPlayer={onOpenPlayer} />}
          </Box>
        )}

        {teamChosen && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <SummaryChipRow label="You send" ids={sendIds} roster={myRoster} />
            <SummaryChipRow label="You receive" ids={receiveIds} roster={theirRoster} />
          </Box>
        )}

        {sendError && <Box ref={errorRef}><TradeAlert testId="trade-dialog-error">{sendError}</TradeAlert></Box>}
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '12px', padding: { xs: '12px 14px', sm: '14px 20px' }, borderTop: '2px solid var(--ps-rule)' }}>
        <PsButton variant="ghost" onClick={onClose}>Cancel</PsButton>
        <PsButton variant="fill" disabled={sending || offered.length === 0 || requested.length === 0} onClick={onSend}>Send Offer</PsButton>
      </Box>
    </Dialog>
  );
}
