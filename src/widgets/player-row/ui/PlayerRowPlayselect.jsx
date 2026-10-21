import React from 'react';
import { Box } from '@mui/material';
import { PlayerAvatar } from '../../../shared/ui';
import { formatPoints, hasNoHistory } from '../../../shared/lib';
import {
  InjuryTag, PixelClock, PosTag, PsButton, SR_ONLY_SX,
} from '../../../shared/ui/playselect';
import { clearsUnderHour } from '../../../entities/waiver-claim';
import { playerRowColumnCount } from './PlayerRowTableHead';
import { weeksForSparkline } from '../model/weeksAdapter';
import {
  ProjWeekCell, OwnershipCell, availabilityOf, clearsText,
} from './rowParts';

// The Play-select Players row (ADR 0067 wave 3, boards Waivers / WaiversPhone): the same columns and
// the same `action` / `expansion` data objects as the dash row, drawn from `ps-*` tokens only. The
// table row is sticky in its first column; the card is the phone layout. Nothing here is green or red
// except the Danger of an under-one-hour Clear and the cursor frame that follows it.

const CURSOR_NOTE = 'Your next move: the largest Upgrade you have not claimed';
const STATE_LABEL = {
  free_agent: 'Free agent', waivers: 'On waivers', rostered: 'Rostered', my_team: 'Your team',
};
const CELL = {
  boxSizing: 'border-box',
  padding: '8px',
  backgroundColor: 'var(--ps-panel)',
  fontSize: '15px',
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
};

function NameButton({ player, onOpenPlayer, wrap = false }) {
  return (
    <Box
      component="button"
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpenPlayer?.(player.id);
      }}
      sx={{
        minHeight: '44px',
        display: 'inline-flex',
        alignItems: 'center',
        padding: 0,
        margin: '-10px 0',
        border: 0,
        borderRadius: 0,
        background: 'none',
        color: 'inherit',
        font: 'inherit',
        fontSize: '15px',
        fontWeight: 600,
        textAlign: 'left',
        cursor: 'pointer',
        whiteSpace: wrap ? 'normal' : 'nowrap',
      }}
    >
      {player.name}
    </Box>
  );
}

function Identity({ player, onOpenPlayer, wrap }) {
  const opponent = player.nfl_opponent ? `vs ${player.nfl_opponent}` : (player.bye_week != null ? `Bye ${player.bye_week}` : null);
  return (
    <Box sx={{ display: 'flex', alignItems: wrap ? 'flex-start' : 'center', gap: '8px', minWidth: 0 }}>
      <PlayerAvatar name={player.name} photoUrl={player.photo_url} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: wrap ? 'wrap' : 'nowrap', gap: '4px 8px' }}>
          <NameButton player={player} onOpenPlayer={onOpenPlayer} wrap={wrap} />
          <InjuryTag status={player.injury_status} />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: wrap ? 'wrap' : 'nowrap', gap: '4px 8px', fontSize: '13px', color: 'var(--ps-dim)' }}>
          <PosTag position={player.position} />
          <span>{player.nfl_team || 'NFL team unavailable'}</span>
          {opponent && <span data-testid="player-row-opponent">{opponent}</span>}
        </Box>
      </Box>
    </Box>
  );
}

// Upgrade: an outlined Ink badge "+{pts}" (and " Wk N" when the first playable week is not the row's own).
function UpgradeBadge({ upgrade, currentWeek }) {
  if (!(upgrade?.points > 0)) return null;
  const later = upgrade.week != null && currentWeek != null && upgrade.week !== currentWeek;
  const points = formatPoints(upgrade.points);
  return (
    <Box
      component="span"
      data-testid="player-row-upgrade"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        boxSizing: 'border-box',
        height: '24px',
        padding: '0 8px',
        border: '2px solid var(--ps-ink)',
        fontSize: '13px',
        fontWeight: 700,
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden="true">{`+${points}${later ? ` Wk ${upgrade.week}` : ''}`}</span>
      <Box component="span" sx={SR_ONLY_SX}>{`Upgrade plus ${points}${later ? ` in week ${upgrade.week}` : ' this week'}`}</Box>
    </Box>
  );
}

// Weeks: one labelled image, a bar per week, this week in Ink, a bye or an out week a flat 2px line.
function WeekSpark({ weeks, currentWeek, barWidth = 6 }) {
  const list = weeksForSparkline(weeks);
  if (list.length === 0) return null;
  const height = 24;
  const max = Math.max(18, ...list.map((w) => (typeof w.points === 'number' ? w.points : 0)));
  const step = barWidth + 2;
  const label = `Projected points by week, weeks ${list[0].week} to ${list[list.length - 1].week}: ${list
    .map((w) => `week ${w.week} ${w.kind === 'projected' ? formatPoints(w.points) : (w.kind === 'bye' ? 'bye' : 'out')}`)
    .join(', ')}`;
  const current = currentWeek ?? list[0].week;
  return (
    <svg
      role="img"
      aria-label={label}
      data-testid="player-row-weeks"
      width={list.length * step - 2}
      height={height}
      viewBox={`0 0 ${list.length * step - 2} ${height}`}
      shapeRendering="crispEdges"
      style={{ display: 'block' }}
    >
      {list.map((w, i) => {
        const h = w.kind === 'projected' ? Math.max(2, Math.round((Number(w.points) || 0) / max * height)) : 2;
        return (
          <rect
            key={w.week}
            x={i * step}
            y={height - h}
            width={barWidth}
            height={h}
            fill={w.week === current ? 'var(--ps-ink)' : 'var(--ps-dim)'}
          />
        );
      })}
    </svg>
  );
}

// Status: the state word over its one fact (the Clear time, Danger with the clock under an hour).
function Status({ player, align, now }) {
  const state = availabilityOf(player);
  const availability = player.availability || {};
  let detail = null;
  if (state === 'waivers' && availability.availableAt) {
    const soon = clearsUnderHour(availability.availableAt, now);
    detail = (
      <Box
        component="span"
        data-testid="player-row-status-detail"
        title={new Date(availability.availableAt).toLocaleString()}
        sx={{
          display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px',
          color: soon ? 'var(--ps-danger)' : 'var(--ps-dim)', fontWeight: soon ? 600 : 400,
        }}
      >
        {soon && <PixelClock />}
        {clearsText(availability.availableAt)}
      </Box>
    );
  } else if (state === 'rostered' && availability.teamName) {
    detail = (
      <Box component="span" data-testid="player-row-status-detail" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>
        {availability.teamName}
      </Box>
    );
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: align, gap: '1px', minWidth: 0 }}>
      <Box component="span" sx={{ fontSize: '14px', fontWeight: 600 }}>{STATE_LABEL[state] || STATE_LABEL.free_agent}</Box>
      {detail}
    </Box>
  );
}

function Chevron({ open }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" shapeRendering="crispEdges">
      <path
        d={open ? 'M5 3h2v2h2v2h2v2H9V7H7V5H5v2H3v2H1V7h2V5h2z' : 'M1 3h2v2h2v2h2V5h2V3h2v2H9v2H7v2H5V7H3V5H1z'}
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}

function ExpandToggle({ expansion, playerName }) {
  if (!expansion) return null;
  return (
    <Box
      component="button"
      type="button"
      aria-label={`Show details for ${playerName}`}
      aria-expanded={expansion.expanded}
      aria-controls={expansion.expanded ? expansion.panelId : undefined}
      onClick={expansion.onToggle}
      data-testid="player-row-expand"
      sx={{
        width: '44px', height: '44px', padding: 0, display: 'grid', placeItems: 'center', flex: 'none', boxSizing: 'border-box',
        borderRadius: 0, background: 'transparent', border: '2px solid transparent', color: 'var(--ps-ink)',
      }}
    >
      <Chevron open={expansion.expanded} />
    </Box>
  );
}

// The row's one action: ghost, or the page's one filled action when `action.fill`. A helper sentence
// is the button's description, never its name.
function Action({ action, playerId }) {
  if (!action) return null;
  const helperId = action.helper ? `player-row-helper-${playerId}` : undefined;
  return (
    <>
      <PsButton
        variant={action.fill ? 'fill' : 'ghost'}
        to={action.kind === 'link' ? action.to : undefined}
        onClick={action.onClick}
        disabled={action.disabled}
        ariaLabel={action.ariaLabel}
        describedBy={helperId}
      >
        {action.label}
      </PsButton>
      {helperId && <Box component="span" id={helperId} sx={SR_ONLY_SX}>{action.helper}</Box>}
    </>
  );
}

const cursorColor = (cursor) => (cursor === 'urgent' ? 'var(--ps-danger)' : 'var(--ps-cursor)');

/**
 * `cursor`: undefined, `'cursor'` or `'urgent'`. In a table the frame is `border-color: inherit` on
 * every cell of a `tr.cursor`, so the row is the one `.cursor` element (the blink animates the row's
 * colour and the cells follow).
 */
export default function PlayerRowPlayselect({
  player, action, expansion, bestBall = false, variant = 'row', onOpenPlayer, hideOwnership = false, cursor, now,
}) {
  const showUpgrade = !bestBall;
  const currentWeek = player.projWeek?.week;
  const noHistory = hasNoHistory(player);
  const note = cursor ? <Box component="span" sx={SR_ONLY_SX}>{CURSOR_NOTE}</Box> : null;

  if (variant === 'card') {
    const inner = (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <Box sx={{ minWidth: 0 }}><Identity player={player} onOpenPlayer={onOpenPlayer} wrap /></Box>
          <Box sx={{ flex: 'none' }}><Status player={player} align="flex-end" now={now} /></Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px' }}>
          <Box sx={{ display: 'flex', gap: '16px' }}>
            <Metric label="Proj Wk"><ProjWeekCell projWeek={player.projWeek} noHistory={noHistory} /></Metric>
            <Metric label="ROS">{formatPoints(player.ros?.points)}</Metric>
            {showUpgrade && player.upgrade?.points > 0 && (
              <Metric label="Upgrade"><UpgradeBadge upgrade={player.upgrade} currentWeek={currentWeek} /></Metric>
            )}
          </Box>
          <WeekSpark weeks={player.weeks} currentWeek={currentWeek} barWidth={4} />
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px' }}>
          <ExpandToggle expansion={expansion} playerName={player.name} />
          <Action action={action} playerId={player.id} />
        </Box>
        {expansion?.expanded && expansion.panel}
      </Box>
    );
    return (
      <Box
        data-testid="player-row-card"
        className={cursor ? 'cursor' : undefined}
        sx={{
          boxSizing: 'border-box',
          backgroundColor: 'var(--ps-panel)',
          ...(cursor
            ? { border: `4px solid ${cursorColor(cursor)}`, padding: '8px 10px' }
            : { border: '2px solid var(--ps-frame-2)', padding: '10px 12px' }),
        }}
      >
        {note}
        {inner}
      </Box>
    );
  }

  const cells = [
    <Identity key="id" player={player} onOpenPlayer={onOpenPlayer} />,
    <ProjWeekCell key="proj" projWeek={player.projWeek} noHistory={noHistory} />,
    formatPoints(player.ros?.points),
    ...(hideOwnership ? [] : [<OwnershipCell key="own" ownership={player.ownership} />]),
    ...(showUpgrade ? [<UpgradeBadge key="up" upgrade={player.upgrade} currentWeek={currentWeek} />] : []),
    <WeekSpark key="wk" weeks={player.weeks} currentWeek={currentWeek} />,
    <Status key="st" player={player} now={now} />,
    <Box key="act" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
      <ExpandToggle expansion={expansion} playerName={player.name} />
      <Action action={action} playerId={player.id} />
    </Box>,
  ];
  // Player, then the figure columns (right-aligned), Weeks and Status left, Action right.
  const rightFrom = 1;
  const rightTo = 3 + (hideOwnership ? 0 : 1) + (showUpgrade ? 1 : 0);
  const align = (i) => (i === cells.length - 1 || (i >= rightFrom && i < rightTo) ? 'right' : 'left');
  const open = expansion?.expanded;
  const ruleBelow = open ? 'none' : '2px solid var(--ps-rule)';
  const frame = (i) => (cursor
    ? {
      borderTop: '4px solid',
      borderBottom: '4px solid',
      ...(i === 0 ? { borderLeft: '4px solid' } : null),
      ...(i === cells.length - 1 ? { borderRight: '4px solid' } : null),
      // After the side shorthands, which would reset their colour.
      borderColor: 'inherit',
    }
    : { borderBottom: ruleBelow });

  return (
    <>
      <Box
        component="tr"
        data-testid="player-row"
        className={cursor ? 'cursor' : undefined}
        sx={cursor ? { borderColor: cursorColor(cursor) } : undefined}
      >
        {cells.map((cell, i) => (
          <Box
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            component={i === 0 ? 'th' : 'td'}
            scope={i === 0 ? 'row' : undefined}
            sx={{
              ...CELL,
              textAlign: align(i),
              fontVariantNumeric: 'tabular-nums',
              ...frame(i),
              ...(i === 0 ? { position: 'sticky', left: 0, zIndex: 1, fontWeight: 600 } : null),
            }}
          >
            {cell}
            {i === 0 ? note : null}
          </Box>
        ))}
      </Box>
      {open && (
        <tr>
          <Box
            component="td"
            colSpan={playerRowColumnCount(bestBall, hideOwnership)}
            sx={{ padding: 0, backgroundColor: 'var(--ps-panel)', borderBottom: '2px solid var(--ps-rule)' }}
          >
            {expansion.panel}
          </Box>
        </tr>
      )}
    </>
  );
}

function Metric({ label, children }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <Box component="span" sx={{ fontSize: '13px', letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ps-dim)' }}>{label}</Box>
      <Box component="span" sx={{ fontSize: '16px', fontWeight: 700, minHeight: '24px', display: 'flex', alignItems: 'center' }}>{children}</Box>
    </Box>
  );
}
