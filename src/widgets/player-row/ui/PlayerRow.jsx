import React from 'react';
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  IconButton,
  Stack,
  TableCell,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import { PositionChip, PlayerAvatar } from '../../../shared/ui';
import { MIN_TOUCH_TARGET_SX, formatPoints } from '../../../shared/lib';
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
      // Risk-review finding (accessibility): `describeChild` keeps this
      // Typography's own visible text ("Clears in 3 days") as its
      // accessible name and links the absolute timestamp in as an
      // `aria-describedby` instead - without it, MUI's default Tooltip
      // behavior overwrites the accessible name with the raw
      // `toLocaleString()` string, so a screen reader announces the
      // timestamp in place of the relative text a sighted user reads.
      <Tooltip title={new Date(availability.availableAt).toLocaleString()} describeChild>
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

// `nameAsLink` is false for the card variant: its whole identity block sits
// inside a CardActionArea (below) that already opens the Decision card, so
// the name renders as plain text there rather than a second, nested
// interactive element (a <button> inside a <button> is invalid HTML, and
// the OLD mobile card never gave the name its own separate target either -
// risk-review finding: without this, the mobile card's ONLY route into the
// Decision card was the name's own ~24px-tall inline link, far under the
// 44px minimum every other action on this card carries).
function PlayerIdentity({ player, onOpenPlayer, nameAsLink = true }) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
      <PlayerAvatar name={player.name} position={player.position} photoUrl={player.photo_url} />
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} alignItems="center">
          {nameAsLink ? (
            <PlayerNameLink name={player.name} playerId={player.id} onOpen={onOpenPlayer} />
          ) : (
            <Typography sx={{ fontWeight: 600 }} noWrap>
              {player.name}
            </Typography>
          )}
          {player.injury_status && (
            <Chip size="small" color="warning" label={player.injury_status} />
          )}
        </Stack>
        <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
          <PositionChip position={player.position} size="small" />
          <Typography variant="caption" color="text.secondary">
            {player.nfl_team || 'NFL team unavailable'}
          </Typography>
          {/* #1574: the week's NFL opponent, "vs BUF" with no home/away marker
              (the MyTeamSummary / Decision card convention), or the bye when
              there is none. The row shows no other week number, so the bye
              keeps its "Bye N". Nothing when both are unknown. */}
          {player.nfl_opponent ? (
            <Typography variant="caption" color="text.secondary" data-testid="player-row-opponent">
              {`vs ${player.nfl_opponent}`}
            </Typography>
          ) : (
            player.bye_week != null && (
              <Typography variant="caption" color="text.secondary" data-testid="player-row-opponent">
                {`Bye ${player.bye_week}`}
              </Typography>
            )
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
  // describeChild (the same risk-review finding as StatusDetail's Clears
  // tooltip): keeps the control's own accessible name (its label) intact
  // and links the helper sentence in as a description, rather than MUI's
  // default of overwriting the name with the helper text outright.
  return action.helper ? <Tooltip title={action.helper} describeChild><span>{control}</span></Tooltip> : control;
}

/**
 * The Watch toggle (#1312, ADR 0040 follow-up, grill ruling Q6): a compact
 * icon control, not a second full-text action button crowding the row's own
 * Action column - copy "Watch"/"Watching" (issue ruling), the same words the
 * Decision card's own full-text button uses. `watchAction` is a plain data
 * object the caller builds (`{ watching, onClick, pending }`), the SAME
 * "page builds the action, widget renders it" shape `action` already uses on
 * this row - hidden entirely when the caller omits it (no league selected,
 * or a consumer, like WaiverWire, that has not wired watch state in).
 *
 * Risk review (accessibility): the icon carries no visible text, so a bare
 * "Watch"/"Watching" accessible name is identical across every row in a
 * multi-row page - a Voice Control/Dragon user saying "click Watch" gets a
 * numbered-overlay guess, and a screen reader's elements list reads
 * "Watch, Watch, Watch...". `playerName` folds the player's own name into
 * the name (`aria-label="Watch Josh Allen"`) so each row's control is
 * unique, the same disambiguation `PlayerNameLink`'s own accessible name
 * already gives the identity column.
 */
function WatchToggle({ watchAction, playerName }) {
  if (!watchAction) return null;
  const Icon = watchAction.watching ? StarIcon : StarBorderIcon;
  const label = watchAction.watching ? 'Watching' : 'Watch';
  return (
    <IconButton
      aria-label={playerName ? `${label} ${playerName}` : label}
      aria-pressed={watchAction.watching}
      onClick={watchAction.onClick}
      disabled={watchAction.pending}
      size="small"
      sx={MIN_TOUCH_TARGET_SX}
      data-testid="player-row-watch"
    >
      <Icon fontSize="small" color={watchAction.watching ? 'warning' : 'inherit'} />
    </IconButton>
  );
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
 * copy of the button. `watchAction` (#1312, ADR 0040 follow-up, grill ruling
 * Q6) is the same shape's sibling for the Watch toggle - `{ watching,
 * onClick, pending? }` - and renders nothing when the caller omits it, so a
 * consumer with no watch state wired in (or no league selected) is unchanged.
 */
export default function PlayerRow({ player, action, watchAction, bestBall = false, variant = 'row', onOpenPlayer }) {
  const weeks = weeksForSparkline(player.weeks);
  const showWeeks = weeks.length > 0;
  const showUpgrade = !bestBall;

  if (variant === 'card') {
    return (
      <Card variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }} data-testid="player-row-card">
        <CardActionArea onClick={() => onOpenPlayer?.(player.id)} sx={{ textAlign: 'left' }}>
          <Box sx={{ p: 2, pb: 1.25 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
              <PlayerIdentity player={player} onOpenPlayer={onOpenPlayer} nameAsLink={false} />
              <StatusCell player={player} />
            </Stack>
          </Box>
        </CardActionArea>
        <CardContent sx={{ pt: 0, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
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
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 0.5 }}>
            <WatchToggle watchAction={watchAction} playerName={player.name} />
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
      {/* Desktop table (2026-09-15 report): the full strip made this column
          440px and the Status column grew to its longest team name, which
          together pushed the table past its container and cut the Action
          column off the right edge. The dense strip sits near the design's
          152px Weeks column, and a capped Status cell lets a long team name
          ellipsise (its own `noWrap`) instead of widening the table. */}
      <TableCell>
        {showWeeks && <WeeklyPointsBars weeks={weeks} currentWeek={player.projWeek?.week} dense />}
      </TableCell>
      <TableCell sx={{ maxWidth: 180 }}>
        <StatusCell player={player} />
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={0.5} justifyContent="flex-end" alignItems="center">
          <WatchToggle watchAction={watchAction} playerName={player.name} />
          <ActionControl action={action} />
        </Stack>
      </TableCell>
    </TableRow>
  );
}
