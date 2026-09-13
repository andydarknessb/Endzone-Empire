import React from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  TableCell,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { PositionChip, PlayerAvatar } from '../../../shared/ui';
import { MIN_TOUCH_TARGET_SX } from '../../../lib/a11y';
import { formatPoints } from '../../../shared/lib';
import { formatRelative } from '../../../utils/formatRelative';
import { WeeklyPointsBars, PlayerNameLink } from '../../../entities/player';
import { weeksForSparkline } from '../model/weeksAdapter';

// Availability state -> Status column color + label (#1310, Players.dc.html /
// Row.dc.html canvases). One map read by both the state dot and the label,
// so a state that's missing from it can never show a dot in one color and
// text in another.
const STATE_VIEW = {
  free_agent: { label: 'Free agent', color: 'var(--success)' },
  waivers: { label: 'On waivers', color: 'var(--warning)' },
  rostered: { label: 'Rostered', color: 'var(--text-muted)' },
  my_team: { label: 'Your team', color: 'var(--accent)' },
};

function availabilityOf(player) {
  return player.availability?.state || 'free_agent';
}

/** Status column: the state dot + label, and the one fact the state itself
 * carries (#1310, ADR 0040 Lead correction item 2) - the owning team for a
 * rostered player, the clears time for one on waivers. Neither is guessed
 * for free_agent/my_team, which show the label alone. */
function StatusDetail({ player }) {
  const state = availabilityOf(player);
  const availability = player.availability || {};
  if (state === 'rostered' && availability.teamName) {
    return (
      <Typography
        data-testid="player-row-status-detail"
        sx={{ fontSize: 12, color: 'var(--text-muted)' }}
        noWrap
      >
        {availability.teamName}
      </Typography>
    );
  }
  if (state === 'waivers' && availability.availableAt) {
    return (
      <Tooltip title={new Date(availability.availableAt).toLocaleString()}>
        <Typography data-testid="player-row-status-detail" sx={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {`Clears ${formatRelative(availability.availableAt)}`}
        </Typography>
      </Tooltip>
    );
  }
  return null;
}

function StatusCell({ player }) {
  const state = availabilityOf(player);
  const view = STATE_VIEW[state] || STATE_VIEW.free_agent;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 }}>
      <Typography
        component="span"
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, fontSize: 13, fontWeight: 700, color: view.color }}
      >
        <Box
          aria-hidden="true"
          sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: view.color, flexShrink: 0 }}
        />
        {view.label}
      </Typography>
      <StatusDetail player={player} />
    </Box>
  );
}

/** Proj Wk / ROS: a points figure, or - for a week the player can't play -
 * the reason itself, never a fabricated number (ADR 0040: "Unavailable
 * players show the reason, never a number, in the list and on the bars"). */
function ProjWeekCell({ projWeek }) {
  if (!projWeek) return <span>-</span>;
  if (projWeek.reason) return <span>{projWeek.reason}</span>;
  return <span>{formatPoints(projWeek.points)}</span>;
}

/** Upgrade pill: hidden outright rather than an empty label when there is
 * nothing to show (best ball, or a row the server never scores an Upgrade
 * for - the caller's own roster) - the same null-hides-the-tile rule
 * DecisionStrip's own Upgrade tile applies. */
function UpgradeCell({ upgrade }) {
  if (upgrade == null || upgrade.points == null) return null;
  const positive = upgrade.points >= 0;
  return (
    <Box
      component="span"
      data-testid="player-row-upgrade"
      sx={{
        display: 'inline-flex',
        px: 0.75,
        borderRadius: 'var(--radius-pill)',
        border: '1px solid',
        borderColor: positive ? 'var(--success)' : 'var(--border-subtle, var(--text-muted))',
        color: positive ? 'var(--success)' : 'var(--text-muted)',
        fontWeight: 700,
        fontSize: 13,
      }}
    >
      {positive ? '+' : ''}
      {formatPoints(upgrade.points)}
    </Box>
  );
}

/** Ownership: null on every row until #1308 lands (ADR 0040 Lead correction
 * item 4) - renders nothing, not an "unavailable" label or a dash glyph. */
function OwnershipCell({ ownership }) {
  const value = typeof ownership === 'number' ? ownership : ownership?.share;
  if (value == null) return null;
  return <span>{`${value}%`}</span>;
}

function PlayerIdentity({ player, onOpenPlayer }) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
      <PlayerAvatar name={player.name} position={player.position} photoUrl={player.photo_url} />
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <PlayerNameLink name={player.name} playerId={player.id} onOpen={onOpenPlayer} />
          {player.injury_status && (
            <Chip size="small" color="warning" label={player.injury_status} />
          )}
        </Stack>
        <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
          <PositionChip position={player.position} size="small" />
          <Typography variant="caption" color="text.secondary">
            {player.nfl_team || 'NFL team unavailable'}
          </Typography>
          {player.bye_week != null && (
            <Typography variant="caption" color="text.secondary">
              {`Bye ${player.bye_week}`}
            </Typography>
          )}
        </Stack>
      </Box>
    </Stack>
  );
}

function ActionControl({ action }) {
  if (!action) return null;
  const sx = { ...MIN_TOUCH_TARGET_SX, borderRadius: 2, fontWeight: 800 };
  const control = action.kind === 'link'
    ? (
      <Button
        component={RouterLink}
        to={action.to}
        variant={action.variant || 'outlined'}
        sx={sx}
        data-testid="player-row-action"
      >
        {action.label}
      </Button>
    )
    : (
      <Button
        variant={action.variant || 'contained'}
        onClick={action.onClick}
        disabled={action.disabled}
        sx={sx}
        data-testid="player-row-action"
      >
        {action.label}
      </Button>
    );
  return action.helper ? <Tooltip title={action.helper}><span>{control}</span></Tooltip> : control;
}

/**
 * One Players list row (#1310, ADR 0040): every availability state renders
 * through the SAME row, columns Player / Proj Wk / ROS / Ownership / Upgrade
 * / Weeks / Status / Action - `variant="row"` (default) for the desktop
 * table PlayerManagement and WaiverWire's on-waivers table compose inside
 * their own `<Table>`, `variant="card"` for the under-600px stacked layout
 * (RowMobile.dc.html). `action` is a plain data object the caller builds
 * (`{ kind: 'button'|'link', label, onClick|to, disabled?, helper?, variant?
 * }`) rather than this widget importing add-player/claim-player/propose-trade
 * itself - the same "page builds the action, widget renders it" shape
 * PlayerDecisionCard already uses for its own action bar, and it is what lets
 * WaiverWire reuse this row with its own claim submission instead of a second
 * copy of the button.
 */
export default function PlayerRow({ player, action, bestBall = false, variant = 'row', onOpenPlayer }) {
  const weeks = weeksForSparkline(player.weeks);
  const showWeeks = weeks.length > 0;
  const showUpgrade = !bestBall;

  if (variant === 'card') {
    return (
      <Card variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }} data-testid="player-row-card">
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
            <PlayerIdentity player={player} onOpenPlayer={onOpenPlayer} />
            <StatusCell player={player} />
          </Stack>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Box>
              <Typography sx={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Proj Wk
              </Typography>
              <Typography sx={{ fontWeight: 700 }}>
                <ProjWeekCell projWeek={player.projWeek} />
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                ROS
              </Typography>
              <Typography sx={{ fontWeight: 700 }}>{formatPoints(player.ros?.points)}</Typography>
            </Box>
            {showUpgrade && player.upgrade != null && (
              <Box>
                <Typography sx={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Upgrade
                </Typography>
                <UpgradeCell upgrade={player.upgrade} />
              </Box>
            )}
          </Stack>
          {showWeeks && <WeeklyPointsBars weeks={weeks} currentWeek={player.projWeek?.week} />}
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <ActionControl action={action} />
          </Box>
        </CardContent>
      </Card>
    );
  }

  return (
    <TableRow hover data-testid="player-row">
      <TableCell component="th" scope="row">
        <PlayerIdentity player={player} onOpenPlayer={onOpenPlayer} />
      </TableCell>
      <TableCell align="right">
        <ProjWeekCell projWeek={player.projWeek} />
      </TableCell>
      <TableCell align="right">{formatPoints(player.ros?.points)}</TableCell>
      <TableCell align="right">
        <OwnershipCell ownership={player.ownership} />
      </TableCell>
      {showUpgrade && (
        <TableCell align="right">
          <UpgradeCell upgrade={player.upgrade} />
        </TableCell>
      )}
      <TableCell>
        {showWeeks && <WeeklyPointsBars weeks={weeks} currentWeek={player.projWeek?.week} />}
      </TableCell>
      <TableCell>
        <StatusCell player={player} />
      </TableCell>
      <TableCell align="right">
        <ActionControl action={action} />
      </TableCell>
    </TableRow>
  );
}
