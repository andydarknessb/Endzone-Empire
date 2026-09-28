import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box, Button, Card, Chip, Link, Stack, Typography,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import Countdown from '../Countdown/Countdown';
import LeagueCard from './LeagueCard';
import { useSnackbar } from '../Snackbar/SnackbarProvider';
import { formatViewerLocalSchedule } from '../../lib/draftTimeFormat';
import { MIN_TOUCH_TARGET_SX } from '../../shared/lib/a11y';
import { deriveLeaguePhase, LEAGUE_PHASE, LEAGUE_PHASE_META } from '../../shared/lib/leaguePhase';
import { isPickemOnly } from '../../shared/lib/leagueType';
import { matchupWinProbability } from '../../shared/lib/winProbability';

/**
 * One league on /user, told through its status block (Home v2 slice 3,
 * GET /api/league?include=status, Contract B). Four faces, chosen by which
 * keys the server put on `status` (absent means not applicable, never zero):
 *
 *   - fantasy: `matchup` is present (null on a bye week). Scores, Expected
 *     final, the win-probability bar, the standing and lineup health.
 *   - pickem: `pickem` without a matchup. Progress and a strip of cells.
 *   - draft: `draft` (pre-draft or drafting). Seats, countdown, invite code.
 *   - basic: a status with none of those (the offseason, say).
 *
 * A row with no status, or one the server flagged `statusError`, falls back
 * to the compact LeagueCard it replaced, so a failed status never costs the
 * manager their league.
 *
 * The title is the card's link (a 44px target), not the whole card, so the
 * footer actions stay separate targets. The card is an article named by its
 * h3 (/user has one h1 and an h2 per section).
 */

const LIVE_PHASES = [LEAGUE_PHASE.IN_SEASON, LEAGUE_PHASE.PLAYOFFS];
const DRAFT_PHASES = [LEAGUE_PHASE.PRE_DRAFT, LEAGUE_PHASE.DRAFTING];

// The server copy of deriveLeaguePhase shares the client's hyphenated values;
// an underscore spelling (the contract's sample reads "in_season") is read as
// the same phase rather than as an unknown one.
export function leaguePhaseOf(league) {
  const phase = league?.status?.phase || deriveLeaguePhase(league);
  return typeof phase === 'string' ? phase.replace(/_/g, '-') : phase;
}

export function hasStatus(league) {
  return Boolean(league?.status) && league.statusError !== true;
}

export function statusVariant(league) {
  if (!hasStatus(league)) return 'fallback';
  const { status } = league;
  if (status.draft) return 'draft';
  if (Object.prototype.hasOwnProperty.call(status, 'matchup')) return 'fantasy';
  if (status.pickem) return 'pickem';
  return 'basic';
}

/**
 * The filter chips each league answers to. Live is a fantasy league in season
 * or the playoffs (its matchup is this week's news, whether or not a game is
 * on right now); Pick'em is any league with pick'em on; Drafting is pre-draft
 * or a draft in progress. A fantasy league with pick'em on is in both.
 */
export function leagueFilterKeys(league) {
  const phase = leaguePhaseOf(league);
  const keys = [];
  if (!isPickemOnly(league) && LIVE_PHASES.includes(phase)) keys.push('live');
  if (isPickemOnly(league) || league?.status?.pickem || league?.pickem_settings?.enabled === true) keys.push('pickem');
  if (!isPickemOnly(league) && DRAFT_PHASES.includes(phase)) keys.push('drafting');
  return keys;
}

const SCORING_LABELS = { standard: 'Standard', half_ppr: 'Half PPR', ppr: 'PPR' };

function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
}

function recordText(record) {
  if (!record) return null;
  const base = `${record.wins}–${record.losses}`;
  return record.ties ? `${base}–${record.ties}` : base;
}

function formatScore(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(1) : '-';
}

function roleLabel(league) {
  if (league.is_owner === true) return 'Commissioner';
  if (league.is_commissioner === true) return 'Co-Commissioner';
  return null;
}

function formatLockTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(date);
}

function formatDraftDay(iso, timeZone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const options = { month: 'short', day: 'numeric' };
  try {
    return new Intl.DateTimeFormat(undefined, timeZone ? { ...options, timeZone } : options).format(date);
  } catch (err) {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  }
}

/** 0..1 chance the viewer's side wins: the server's figure once v2 ships, else v1. */
function myWinProbability(matchup) {
  if (typeof matchup.winProbability === 'number' && Number.isFinite(matchup.winProbability)) {
    return matchup.winProbability;
  }
  return matchupWinProbability({
    homeScore: matchup.my?.score,
    awayScore: matchup.opp?.score,
    homeExpectedFinal: matchup.my?.expectedFinal,
    awayExpectedFinal: matchup.opp?.expectedFinal,
  }).home;
}

const actionSx = { ...MIN_TOUCH_TARGET_SX, px: 1.5, fontWeight: 600 };

function ActionLink({ to, children, primary = false }) {
  return (
    <Button component={RouterLink} to={to} variant={primary ? 'contained' : 'text'} sx={actionSx}>
      {children}
    </Button>
  );
}

const chipSx = { fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' };

function StatusChip({ variant, label }) {
  const color = { live: 'error', pickem: 'primary', draft: 'primary', warning: 'warning' }[variant] || 'default';
  return <Chip size="small" color={color} variant={variant === 'live' ? 'filled' : 'outlined'} label={label} sx={chipSx} />;
}

function CardHeader({ league, headingId, subline, chip }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 2.5, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
      <Box
        aria-hidden="true"
        sx={{
          width: 40, height: 40, flexShrink: 0, borderRadius: 2.5, bgcolor: 'action.selected',
          display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 20,
        }}
      >
        {(league.name || '?').trim().charAt(0).toUpperCase()}
      </Box>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="subtitle1" component="h3" id={headingId} sx={{ fontWeight: 600, m: 0 }}>
          <Link
            component={RouterLink}
            to={`/league/${league.id}`}
            color="text.primary"
            underline="hover"
            title={league.name}
            sx={{
              display: 'flex', alignItems: 'center', minHeight: 44,
              overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
            }}
          >
            <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{league.name}</Box>
          </Link>
        </Typography>
        {subline && (
          <Typography variant="body2" color="text.secondary" noWrap title={subline}>{subline}</Typography>
        )}
      </Box>
      {chip}
    </Stack>
  );
}

function CardFooter({ children }) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      flexWrap="wrap"
      useFlexGap
      spacing={1.5}
      sx={{ mt: 'auto', pl: 2.5, pr: 1.5, py: 0.75, borderTop: 1, borderColor: 'divider' }}
    >
      {children}
    </Stack>
  );
}

function FooterActions({ children }) {
  return <Stack direction="row" spacing={0.5} sx={{ ml: 'auto' }}>{children}</Stack>;
}

function Standing({ standing, extra }) {
  if (!standing) return extra ? <Typography variant="body2" color="text.secondary">{extra}</Typography> : null;
  return (
    <Typography variant="body2" color="text.secondary">
      <Box component="strong" sx={{ color: 'text.primary', fontWeight: 600 }}>{ordinal(standing.rank)}</Box>
      {` of ${standing.of}${extra ? ` · ${extra}` : ''}`}
    </Typography>
  );
}

/** Accent fill on a neutral track, one hue; the label carries both sides. */
function WinProbabilityBar({ mine, opponentName }) {
  const you = Math.round(mine * 100);
  const them = 100 - you;
  return (
    <Stack spacing={0.75}>
      <Stack direction="row" justifyContent="space-between" sx={{ typography: 'caption', fontWeight: 600 }}>
        <Box component="span" sx={{ color: 'primary.main' }}>{`You ${you}% to win`}</Box>
        <Box component="span" sx={{ color: 'text.secondary' }}>{`Them ${them}%`}</Box>
      </Stack>
      <Box
        role="img"
        aria-label={`Win probability: you ${you} percent, ${opponentName} ${them} percent`}
        sx={{ height: 8, borderRadius: 999, overflow: 'hidden', display: 'flex', bgcolor: 'action.selected' }}
      >
        <Box sx={{ width: `${you}%`, bgcolor: 'primary.main' }} />
      </Box>
    </Stack>
  );
}

function LineupHealth({ lineup }) {
  if (!lineup) return null;
  const problems = Array.isArray(lineup.problems) ? lineup.problems : [];
  if (problems.length === 0) {
    return (
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ color: 'success.main', typography: 'body2', fontWeight: 600 }}>
        <CheckCircleOutlineIcon fontSize="small" aria-hidden="true" />
        <span>Lineup set</span>
      </Stack>
    );
  }
  const text = problems.length === 1 ? problems[0] : `${problems[0]} · ${problems.length - 1} more`;
  return (
    <Stack direction="row" alignItems="center" spacing={0.75} sx={{ color: 'warning.main', typography: 'body2', fontWeight: 600, minWidth: 0 }}>
      <WarningAmberIcon fontSize="small" aria-hidden="true" />
      <span>{text}</span>
    </Stack>
  );
}

function ScoreSide({ eyebrow, name, score, expectedFinal, playersRemaining, align = 'left', mine = false }) {
  const proj = expectedFinal != null ? `Proj ${formatScore(expectedFinal)}` : null;
  const left = playersRemaining != null ? `${playersRemaining} yet to play` : null;
  const detail = [proj, left].filter(Boolean).join(' · ');
  return (
    <Stack spacing={0.25} sx={{ minWidth: 0, alignItems: align === 'right' ? 'flex-end' : 'flex-start', textAlign: align }}>
      {eyebrow && (
        <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: '0.08em', color: mine ? 'primary.main' : 'text.secondary' }}>
          {eyebrow}
        </Typography>
      )}
      <Typography variant="body2" sx={{ fontWeight: 600, maxWidth: '100%' }} noWrap title={name}>{name}</Typography>
      <Typography sx={{ fontSize: 40, fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{formatScore(score)}</Typography>
      {detail && <Typography variant="caption" color="text.secondary">{detail}</Typography>}
    </Stack>
  );
}

const MATCHUP_CHIP = {
  live: { variant: 'live', label: 'Live' },
  played: { variant: 'warning', label: 'Awaiting final' },
  final: { variant: 'default', label: 'Final' },
  scheduled: { variant: 'default', label: 'Scheduled' },
};

function resultText(matchup) {
  const my = Number(matchup.my?.score);
  const opp = Number(matchup.opp?.score);
  if (!Number.isFinite(my) || !Number.isFinite(opp)) return null;
  if (my > opp) return 'You won';
  if (my < opp) return 'You lost';
  return 'Tied';
}

function PickemLine({ pickem }) {
  return (
    <Typography variant="body2" color="text.secondary">
      {`Picks · ${pickem.made} of ${pickem.total} made`}
    </Typography>
  );
}

function FantasyBody({ league, status }) {
  const { matchup } = status;
  if (!matchup) {
    return (
      <Box sx={{ px: 2.5, py: 2.5 }}>
        <Typography variant="h6" component="p" sx={{ fontWeight: 600 }}>Bye week</Typography>
        <Typography variant="body2" color="text.secondary">No matchup this week.</Typography>
        {status.pickem && <PickemLine pickem={status.pickem} />}
      </Box>
    );
  }
  const record = recordText(status.record);
  const showOdds = ['scheduled', 'live', 'played'].includes(matchup.status);
  const opponentName = matchup.opponent?.name || 'Opponent';
  return (
    <>
      <Box
        sx={{
          px: 2.5, pt: 2.5, pb: 1, display: 'grid', gap: 1.5, alignItems: 'center',
          gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
        }}
      >
        <ScoreSide
          mine
          eyebrow={record ? `You · ${record}` : 'You'}
          name={league.my_team_name || 'Your team'}
          score={matchup.my?.score}
          expectedFinal={matchup.my?.expectedFinal}
          playersRemaining={matchup.my?.playersRemaining}
        />
        <Typography
          component="span"
          sx={{ fontWeight: 600, color: 'text.secondary', border: 1, borderColor: 'divider', borderRadius: 999, px: 1.25, py: 0.5, fontSize: 14 }}
        >
          VS
        </Typography>
        <ScoreSide
          align="right"
          name={opponentName}
          score={matchup.opp?.score}
          expectedFinal={matchup.opp?.expectedFinal}
          playersRemaining={matchup.opp?.playersRemaining}
        />
      </Box>
      <Box sx={{ px: 2.5, pt: 1, pb: 2 }}>
        {showOdds && <WinProbabilityBar mine={myWinProbability(matchup)} opponentName={opponentName} />}
        {matchup.status === 'final' && resultText(matchup) && (
          <Typography variant="body2" sx={{ fontWeight: 700 }}>{resultText(matchup)}</Typography>
        )}
        {status.pickem && <Box sx={{ mt: 1 }}><PickemLine pickem={status.pickem} /></Box>}
      </Box>
    </>
  );
}

/** One cell per game: made is a filled cell with a check, open a dashed outline. */
function PicksStrip({ made, total, week }) {
  const count = Math.max(0, Math.min(Number(total) || 0, 32));
  if (count === 0) return null;
  const label = `${week ? `Week ${week} picks` : 'Picks'}: ${made} of ${total} made`;
  return (
    <Box
      role="img"
      aria-label={label}
      sx={{ display: 'grid', gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`, gap: 0.5 }}
    >
      {Array.from({ length: count }, (_, i) => (i < made ? (
        <Box
          key={i}
          data-testid="pick-cell-made"
          sx={{ height: 28, borderRadius: 1.5, bgcolor: 'primary.main', color: 'primary.contrastText', display: 'grid', placeItems: 'center' }}
        >
          <CheckIcon sx={{ fontSize: 14 }} aria-hidden="true" />
        </Box>
      ) : (
        <Box
          key={i}
          data-testid="pick-cell-open"
          sx={{ height: 28, boxSizing: 'border-box', borderRadius: 1.5, border: '2px dashed', borderColor: 'text.secondary' }}
        />
      )))}
    </Box>
  );
}

function PickemBody({ status }) {
  const { made, total } = status.pickem;
  return (
    <Stack spacing={1.75} sx={{ p: 2.5 }}>
      <Stack direction="row" alignItems="baseline" spacing={1.25}>
        <Typography component="span" sx={{ fontSize: 40, fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {made}
          <Box component="span" sx={{ color: 'text.secondary' }}>{`/${total}`}</Box>
        </Typography>
        <Typography component="span" variant="body2" color="text.secondary">
          {status.week ? `Week ${status.week} picks made` : 'Picks made'}
        </Typography>
      </Stack>
      <PicksStrip made={made} total={total} week={status.week} />
    </Stack>
  );
}

/** Counts only: Contract B carries no team names, so no initials are shown. */
function SeatGrid({ filled, max }) {
  const total = Math.max(0, Math.min(Number(max) || 0, 50));
  if (total === 0) return null;
  return (
    <Box
      component="ul"
      aria-hidden="true"
      sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 1 }}
    >
      {Array.from({ length: total }, (_, i) => (i < filled ? (
        <Box
          component="li"
          key={i}
          data-testid="seat-filled"
          sx={{ height: 40, borderRadius: 2.5, bgcolor: 'action.selected', display: 'grid', placeItems: 'center', typography: 'caption', fontWeight: 700 }}
        >
          {i === 0 ? 'You' : ''}
        </Box>
      ) : (
        <Box
          component="li"
          key={i}
          data-testid="seat-open"
          sx={{
            height: 40, boxSizing: 'border-box', borderRadius: 2.5, border: '2px dashed', borderColor: 'text.secondary',
            display: 'grid', placeItems: 'center', typography: 'caption', color: 'text.secondary',
          }}
        >
          Open
        </Box>
      )))}
    </Box>
  );
}

function InviteCode({ code }) {
  const notify = useSnackbar();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      notify('Invite code copied');
    } catch (err) {
      notify("Couldn't copy the invite code", { severity: 'error' });
    }
  };
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1.25}
      sx={{ pl: 1.75, pr: 1, py: 1, borderRadius: 2.5, bgcolor: 'action.hover', border: 1, borderColor: 'divider' }}
    >
      <Typography variant="caption" sx={{ fontWeight: 600, letterSpacing: '0.07em', color: 'text.secondary', textTransform: 'uppercase' }}>
        Invite code
      </Typography>
      <Box component="code" sx={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 600, letterSpacing: '0.06em' }}>{code}</Box>
      <Button
        variant="outlined"
        onClick={copy}
        aria-label={`Copy invite code ${code}`}
        startIcon={<ContentCopyIcon aria-hidden="true" />}
        sx={{ ...MIN_TOUCH_TARGET_SX, ml: 'auto !important' }}
      >
        Copy
      </Button>
    </Stack>
  );
}

function DraftBody({ league, status }) {
  const { draft } = status;
  const seatsFilled = draft.seatsFilled ?? league.team_count ?? 0;
  const maxTeams = draft.maxTeams ?? league.max_teams ?? 0;
  const drafting = leaguePhaseOf(league) === LEAGUE_PHASE.DRAFTING;
  const showInvite = !drafting && league.invite_code && seatsFilled < maxTeams;
  return (
    <Stack spacing={1.75} sx={{ p: 2.5 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline">
        <Typography variant="body2" sx={{ fontWeight: 600 }}>Seats</Typography>
        <Typography variant="body2" color="text.secondary">{`${seatsFilled} of ${maxTeams} seats filled`}</Typography>
      </Stack>
      <SeatGrid filled={seatsFilled} max={maxTeams} />
      {!drafting && draft.date && (
        <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
          <Countdown variant="chip" date={draft.date} timeZone={draft.timezone} />
          <Typography variant="body2" color="text.secondary">{formatViewerLocalSchedule(draft.date)}</Typography>
        </Stack>
      )}
      {!drafting && !draft.date && (
        <Typography variant="body2" color="text.secondary">Draft not scheduled yet</Typography>
      )}
      {showInvite && <InviteCode code={league.invite_code} />}
    </Stack>
  );
}

function BasicBody({ league, status }) {
  const meta = LEAGUE_PHASE_META[leaguePhaseOf(league)];
  const record = recordText(status.record);
  return (
    <Stack spacing={0.5} sx={{ p: 2.5 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{meta?.label || 'League'}</Typography>
      {record && <Typography variant="body2" color="text.secondary">{`Record ${record}`}</Typography>}
    </Stack>
  );
}

function LeagueStatusCard({ league }) {
  const variant = statusVariant(league);
  if (variant === 'fallback') {
    return <LeagueCard league={league} compact titleComponent="h3" />;
  }

  const { status } = league;
  const headingId = `league-status-${league.id}`;
  const role = roleLabel(league);
  const base = `/league/${league.id}`;
  let subline;
  let chip;
  let body;
  let footer;

  if (variant === 'fantasy') {
    const { matchup } = status;
    const chipMeta = matchup ? MATCHUP_CHIP[matchup.status] : null;
    subline = [league.my_team_name, role, SCORING_LABELS[league.scoring_preset]].filter(Boolean).join(' · ');
    chip = chipMeta
      ? <StatusChip variant={chipMeta.variant} label={chipMeta.label} />
      : status.week != null && <StatusChip label={`Week ${status.week}`} />;
    body = <FantasyBody league={league} status={status} />;
    footer = (
      <>
        <Standing standing={status.standing} />
        <LineupHealth lineup={status.lineup} />
        <FooterActions>
          <ActionLink to={`${base}/lineup`}>Lineup</ActionLink>
          {matchup && <ActionLink to={`${base}/matchups/${matchup.id}`}>Matchup</ActionLink>}
          {status.pickem ? <ActionLink to={`${base}/pickem`}>Picks</ActionLink> : <ActionLink to={`${base}/waivers`}>Waivers</ActionLink>}
        </FooterActions>
      </>
    );
  } else if (variant === 'pickem') {
    const { made, total, nextLockAt } = status.pickem;
    const done = total > 0 && made >= total;
    const managers = league.team_count != null ? `${league.team_count} managers` : null;
    const lock = nextLockAt ? formatLockTime(nextLockAt) : null;
    subline = [league.my_team_name, role, managers].filter(Boolean).join(' · ');
    chip = <StatusChip variant={done ? 'default' : 'pickem'} label={done ? 'Picks in' : 'Picks open'} />;
    body = <PickemBody status={status} />;
    footer = (
      <>
        <Standing standing={status.standing} extra={recordText(status.record) ? `${recordText(status.record)} season` : null} />
        {lock && !done && <Typography variant="body2" color="text.secondary">{`Next lock ${lock}`}</Typography>}
        <FooterActions>
          <ActionLink primary={!done} to={`${base}/pickem`}>{done ? 'View picks' : 'Finish picks'}</ActionLink>
        </FooterActions>
      </>
    );
  } else if (variant === 'draft') {
    const drafting = leaguePhaseOf(league) === LEAGUE_PHASE.DRAFTING;
    const day = status.draft.date ? formatDraftDay(status.draft.date, status.draft.timezone) : null;
    subline = [league.my_team_name, role, SCORING_LABELS[league.scoring_preset]].filter(Boolean).join(' · ');
    let chipLabel = 'Pre-draft';
    if (drafting) chipLabel = 'Draft live';
    else if (day) chipLabel = `Draft ${day}`;
    chip = <StatusChip variant={drafting ? 'live' : 'draft'} label={chipLabel} />;
    body = <DraftBody league={league} status={status} />;
    footer = (
      <FooterActions>
        <ActionLink primary={drafting} to={`${base}/draft`}>{drafting ? 'Open Draft Room' : 'Draft Room'}</ActionLink>
        {!drafting && league.is_commissioner === true && <ActionLink to={`${base}/draft-settings`}>Draft settings</ActionLink>}
      </FooterActions>
    );
  } else {
    subline = [league.my_team_name, role].filter(Boolean).join(' · ');
    body = <BasicBody league={league} status={status} />;
    footer = (
      <>
        <Standing standing={status.standing} />
        <FooterActions>
          <ActionLink to={base}>League home</ActionLink>
        </FooterActions>
      </>
    );
  }

  return (
    <Card
      component="article"
      variant="outlined"
      aria-labelledby={headingId}
      data-testid="league-status-card"
      sx={{ bgcolor: 'background.paper', height: '100%', display: 'flex', flexDirection: 'column', borderRadius: 4 }}
    >
      <CardHeader league={league} headingId={headingId} subline={subline} chip={chip} />
      {body}
      <CardFooter>{footer}</CardFooter>
    </Card>
  );
}

export default LeagueStatusCard;
