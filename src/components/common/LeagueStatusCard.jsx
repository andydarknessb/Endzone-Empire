import React from 'react';
import { Box } from '@mui/material';
import { useSnackbar } from '../Snackbar/SnackbarProvider';
import { formatViewerLocalSchedule } from '../../lib/draftTimeFormat';
import { formatInstant } from '../../shared/lib/instantFormat';
import { deriveLeaguePhase, LEAGUE_PHASE, LEAGUE_PHASE_META } from '../../shared/lib/leaguePhase';
// The narrow module, not the entity index: this card is in the initial chunk
// and the index drags the hooks, the supabase client and their lazy routes in.
import { matchupBoard } from '../../entities/matchup/model/matchupBoard';
import { teamStandingFromRow } from '../../entities/standings';
import { PsButton, PsLink, OddsBar, Pictogram, SR_ONLY_SX, pixelSx } from '../../shared/ui/playselect';
import { LeagueLinks, LeaguePanel, PickemTile, ScoreTile } from '../UserPage/home';

/**
 * One league on /user, told through its status block (GET /api/league?include=status,
 * Contract B), in the Home Play-select face (DESIGN.md "Play-select"). Five
 * faces, chosen by which keys the server put on `status` (absent means not
 * applicable, never zero):
 *
 *   - fantasy: `matchup` is present (null on a bye week). A ScoreTile while the
 *     matchup is live, else a panel: projected sides and the odds bar before
 *     kickoff, the result when final.
 *   - pickem: `pickem` without a matchup. A panel with the standing; a PickemTile
 *     on game day.
 *   - draft: `draft` (pre-draft or drafting). The draft line, seats, invite code.
 *   - basic: a status with none of those (the offseason, say).
 *   - fallback: no status, or one the server flagged `statusError`: the league's
 *     name and a link in, so a failed status never costs the manager their league.
 *
 * Season points are not on the status (#2316), so none are shown or invented.
 */

const LIVE_PHASES = [LEAGUE_PHASE.IN_SEASON, LEAGUE_PHASE.PLAYOFFS];

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

function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
}

// The Record has one home, the standings entity (CONTEXT.md, Record): this
// only guards a status with no record (not applicable, never zero).
function recordText(record) {
  return record ? teamStandingFromRow(record).record : null;
}

const pointsText = (n) => `${n} point${n === 1 ? '' : 's'}`;
const standingText = (standing) => (standing ? `${ordinal(standing.rank)} of ${standing.of}` : null);

const finiteOrNull = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const fmt = (v) => {
  const n = finiteOrNull(v);
  return n == null ? '-' : n.toFixed(1);
};

/** 0..100 chance the viewer's side wins: the server's figure once v2 ships, else v1 on the two Expected finals. */
function winPct(matchup, board) {
  const server = finiteOrNull(matchup.winProbability);
  const p = server ?? (board.winProbability ?? board.projectedWinProbability)?.first;
  return p == null ? null : Math.round(p * 100);
}

// `my` is the viewer's side and rides as home: with no viewer id the board puts home first.
const boardOf = (matchup) => matchupBoard({ status: matchup.status, home: matchup.my, away: matchup.opp });

function lineupText(lineup) {
  const problems = Array.isArray(lineup?.problems) ? lineup.problems : [];
  if (!problems.length) return null;
  return problems.length === 1 ? problems[0] : `${problems[0]} · ${problems.length - 1} more`;
}

// The links a league has; the primitive sorts them into Matchup, Lineup, Picks, Waivers, Dashboard.
function leagueLinks(league) {
  const { status } = league;
  const base = `/league/${league.id}`;
  const dashboard = { label: 'Dashboard', to: base };
  if (statusVariant(league) === 'pickem') return [{ label: 'Picks', to: `${base}/pickem` }, dashboard];
  const links = [];
  if (status.matchup) links.push({ label: 'Matchup', to: `${base}/matchups/${status.matchup.id}` });
  links.push({ label: 'Lineup', to: `${base}/lineup` });
  if (status.pickem) links.push({ label: 'Picks', to: `${base}/pickem` });
  links.push({ label: 'Waivers', to: `${base}/waivers` }, dashboard);
  return links;
}

/**
 * Which tile a league wears: 'score' for a live matchup that has a win
 * probability (the tile's bar needs one; without it the league stays a panel),
 * 'pickem' for a pick'em-only league on game day, else null.
 */
export function tileKind(league, live = false) {
  const variant = statusVariant(league);
  if (variant === 'fantasy') {
    const { matchup } = league.status;
    if (matchup?.status !== 'live') return null;
    return winPct(matchup, boardOf(matchup)) == null ? null : 'score';
  }
  return live && variant === 'pickem' && LIVE_PHASES.includes(leaguePhaseOf(league)) ? 'pickem' : null;
}

/**
 * The live score as the tile shows it ("87.4|71.2", no figure reads as 0.0), so
 * a refresh that changes what is on screen can be told from one that does not.
 */
export function scoreSignature(league) {
  const { my, opp } = league.status.matchup;
  const shown = (score) => (finiteOrNull(score) ?? 0).toFixed(1);
  return `${shown(my?.score)}|${shown(opp?.score)}`;
}

const lineSx = { fontSize: '15px', fontWeight: 600 };
const dimLineSx = { fontSize: '14px', color: 'var(--ps-dim)' };

function StatusLine({ league, sub }) {
  const { status } = league;
  const main = [recordText(status.record), standingText(status.standing)].filter(Boolean).join(' · ');
  if (!main && !sub) return null;
  return (
    <Box>
      {main && <Box sx={lineSx}>{main}</Box>}
      {sub && <Box sx={dimLineSx}>{sub}</Box>}
    </Box>
  );
}

function PanelSides({
  you, opp, mid, youColor = 'var(--ps-ink)', oppColor = 'var(--ps-ink)',
}) {
  const fig = (value, color) => (
    <Box sx={{
      ...pixelSx(24), lineHeight: 1.2, color, fontSize: { xs: '16px', md: '24px' },
    }}
    >
      {value}
    </Box>
  );
  return (
    <Box sx={{
      display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', alignItems: 'end', gap: '12px',
    }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Box sx={dimLineSx}>You</Box>
        {fig(you, youColor)}
      </Box>
      <Box sx={{ fontSize: '13px', color: 'var(--ps-dim)', pb: '4px' }}>{mid}</Box>
      <Box sx={{ minWidth: 0, textAlign: 'right' }}>
        <Box sx={{ ...dimLineSx, overflowWrap: 'anywhere' }}>{opp.name}</Box>
        {fig(opp.score, oppColor)}
      </Box>
    </Box>
  );
}

function PicksLine({ pickem, week }) {
  if (!pickem || !(pickem.total > 0)) return null;
  return <Box sx={lineSx}>{`${week ? `Week ${week} picks` : 'Picks'}: ${pickem.made} of ${pickem.total} made`}</Box>;
}

// The foot for panels whose links are not the four league links (draft room, dashboard).
function PanelNav({ league, links }) {
  return (
    <Box
      component="nav"
      aria-label={league.name}
      sx={{
        marginTop: 'auto', display: 'flex', flexWrap: 'wrap', padding: '4px 6px', borderTop: '2px solid var(--ps-rule)',
      }}
    >
      {links.map((l) => (
        <PsLink key={l.label} to={l.to} ariaLabel={`${league.name} ${l.label.toLowerCase()}`}>{l.label}</PsLink>
      ))}
    </Box>
  );
}

function resultOf(matchup) {
  const my = finiteOrNull(matchup.my?.score);
  const opp = finiteOrNull(matchup.opp?.score);
  if (my == null || opp == null) return null;
  if (my > opp) return 'won';
  if (my < opp) return 'lost';
  return 'tied';
}

const RESULT_WORDS = { won: 'You won', lost: 'You lost', tied: 'Tied' };

function FinalBody({ league }) {
  const { status } = league;
  const { matchup } = status;
  const result = resultOf(matchup);
  const opp = { name: matchup.opponent?.name || 'Opponent', score: fmt(matchup.opp?.score) };
  const you = fmt(matchup.my?.score);
  const record = recordText(status.record);
  const standing = standingText(status.standing);
  const now = record ? `Now ${record}${standing ? `, ${standing}` : ''}.` : null;
  const sentence = [
    `Final: you ${you}, ${opp.name} ${opp.score}.`, result && `${RESULT_WORDS[result]}.`, now,
  ].filter(Boolean).join(' ');
  // Ink for a win or a loss: green is the one filled action and live state, and a loss is not an error.
  const ink = 'var(--ps-ink)';
  return (
    <>
      <Box sx={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: '16px',
      }}
      >
        <Box
          component="span"
          sx={{
            alignSelf: 'flex-start', display: 'inline-flex', padding: '8px 10px', border: `2px solid ${ink}`, color: ink, ...pixelSx(16), lineHeight: 1,
          }}
        >
          {result ? `Final · ${RESULT_WORDS[result]}` : 'Final'}
        </Box>
        {result === 'won' && (
          <Box data-testid="trophy" sx={{ '& svg': { color: `${ink} !important` } }}>
            <Pictogram kind="trophy" width={96} />
          </Box>
        )}
        <Box component="span" sx={SR_ONLY_SX}>{sentence}</Box>
      </Box>
      <Box aria-hidden="true">
        <PanelSides
          you={you}
          opp={opp}
          mid="Final"
          youColor={result === 'lost' ? 'var(--ps-dim)' : ink}
          oppColor={result === 'won' ? 'var(--ps-dim)' : ink}
        />
      </Box>
      {now && <Box sx={{ fontSize: '15px' }}>{now}</Box>}
      <PicksLine pickem={status.pickem} week={status.week} />
    </>
  );
}

function FantasyBody({ league }) {
  const { status } = league;
  const { matchup } = status;
  if (!matchup) {
    return (
      <>
        <StatusLine league={league} />
        <Box>
          <Box sx={lineSx}>Bye week</Box>
          <Box sx={dimLineSx}>No matchup this week.</Box>
        </Box>
        <PicksLine pickem={status.pickem} week={status.week} />
      </>
    );
  }
  // A settled week states no Expected final (#2048); the board nulls it.
  const board = boardOf(matchup);
  if (board.isFinal) return <FinalBody league={league} />;
  const opponent = matchup.opponent?.name || 'Opponent';
  // The matchup's own first kickoff when the server sent it, else the lineup's next lock.
  const kickoffAt = matchup.kickoffAt || status.lineup?.nextLockAt;
  const kickoff = matchup.status === 'scheduled' && kickoffAt && Date.parse(kickoffAt) > Date.now()
    ? formatInstant(kickoffAt, 'weekdayTime')
    : null;
  const sub = [`vs ${opponent}`, kickoff && `kicks off ${kickoff}`].filter(Boolean).join(' · ');
  if (board.settled) {
    // Played, awaiting the final: the scores stand, no projection and no odds.
    return (
      <>
        <StatusLine league={league} sub={sub} />
        <PanelSides you={fmt(matchup.my?.score)} opp={{ name: opponent, score: fmt(matchup.opp?.score) }} mid="Played" />
        <Box sx={dimLineSx}>Awaiting final scores.</Box>
        <PicksLine pickem={status.pickem} week={status.week} />
      </>
    );
  }
  const projected = board.first.expectedFinal != null && board.second.expectedFinal != null;
  const pct = winPct(matchup, board);
  const lineup = status.lineup && (lineupText(status.lineup) || 'Lineup set');
  return (
    <>
      <StatusLine league={league} sub={sub} />
      {projected && (
        <PanelSides
          you={fmt(board.first.expectedFinal)}
          opp={{ name: opponent, score: fmt(board.second.expectedFinal) }}
          mid="Projected"
        />
      )}
      {/* Frame colour, never green: green is live state only. */}
      {pct != null && <OddsBar pct={pct} live={false} />}
      {lineup && <Box sx={{ fontSize: '15px' }}>{lineup}</Box>}
      <PicksLine pickem={status.pickem} week={status.week} />
    </>
  );
}

// "1st place has 447 points. Week 5 earned you 71.": each sentence only when its figures came.
function pickemNote({ standing, pickem }) {
  const leader = finiteOrNull(pickem?.leaderPoints);
  const lastWeek = pickem?.lastWeek;
  return [
    standing?.rank > 1 && leader != null ? `${ordinal(1)} place has ${pointsText(leader)}.` : null,
    lastWeek ? `Week ${lastWeek.week} earned you ${lastWeek.points}.` : null,
  ].filter(Boolean).join(' ');
}

function PickemBody({ league }) {
  const { status } = league;
  const managers = league.team_count != null ? `${league.team_count} managers` : null;
  const points = finiteOrNull(status.pickem?.points);
  const note = points != null ? pickemNote(status) : '';
  return (
    <>
      <Box>
        <Box sx={lineSx}>Pick&apos;em</Box>
        <Box sx={dimLineSx}>{[managers, 'season standings'].filter(Boolean).join(' · ')}</Box>
      </Box>
      {status.standing && (
        <Box sx={{
          display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap',
        }}
        >
          <Box component="span" sx={{ ...pixelSx(24), lineHeight: 1.2 }}>{ordinal(status.standing.rank)}</Box>
          <Box component="span" sx={{ fontSize: '15px', color: 'var(--ps-dim)' }}>{`of ${status.standing.of}${points != null ? ` · ${pointsText(points)}` : ''}`}</Box>
        </Box>
      )}
      {note && <Box sx={dimLineSx}>{note}</Box>}
      <PicksLine pickem={status.pickem} week={status.week} />
    </>
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
    <Box sx={{
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 12px',
    }}
    >
      <Box component="span" sx={dimLineSx}>Invite code</Box>
      <Box component="code" sx={{ fontFamily: 'monospace', fontSize: '15px', fontWeight: 600, letterSpacing: '0.06em' }}>{code}</Box>
      <PsButton variant="quiet" onClick={copy} ariaLabel={`Copy invite code ${code}`}>Copy</PsButton>
    </Box>
  );
}

function DraftBody({ league }) {
  const { draft } = league.status;
  const seatsFilled = draft.seatsFilled ?? league.team_count ?? 0;
  const maxTeams = draft.maxTeams ?? league.max_teams ?? 0;
  const drafting = leaguePhaseOf(league) === LEAGUE_PHASE.DRAFTING;
  const showInvite = !drafting && league.invite_code && seatsFilled < maxTeams;
  const day = draft.date ? formatInstant(draft.date, 'day') : null;
  let headline = 'Draft not scheduled yet';
  if (drafting) headline = 'Draft in progress';
  else if (day) headline = `Draft ${day}`;
  return (
    <>
      <Box>
        <Box sx={lineSx}>{headline}</Box>
        {!drafting && draft.date && <Box sx={dimLineSx}>{formatViewerLocalSchedule(draft.date)}</Box>}
      </Box>
      <Box sx={{ fontSize: '15px' }}>{`${seatsFilled} of ${maxTeams} seats filled`}</Box>
      {showInvite && <InviteCode code={league.invite_code} />}
    </>
  );
}

function BasicBody({ league }) {
  const meta = LEAGUE_PHASE_META[leaguePhaseOf(league)];
  return (
    <>
      <Box sx={lineSx}>{meta?.label || 'League'}</Box>
      <StatusLine league={league} />
    </>
  );
}

const playersNote = (n) => (n == null ? null : `${n} ${n === 1 ? 'player' : 'players'} remaining`);

function ScoreTileFor({ league, scored }) {
  const { status } = league;
  const { matchup } = status;
  const board = boardOf(matchup);
  const my = finiteOrNull(matchup.my?.score) ?? 0;
  const theirs = finiteOrNull(matchup.opp?.score) ?? 0;
  const diff = Math.round(Math.abs(my - theirs) * 10) / 10;
  let margin = 'Tied';
  let verb = 'you are tied with';
  if (diff > 0 && my > theirs) {
    margin = `Up ${diff.toFixed(1)}`;
    verb = 'you lead';
  } else if (diff > 0) {
    margin = `Down ${diff.toFixed(1)}`;
    verb = 'you trail';
  }
  const pct = winPct(matchup, board);
  const opponent = matchup.opponent?.name || 'Opponent';
  const myLeft = finiteOrNull(matchup.my?.playersRemaining);
  const theirLeft = finiteOrNull(matchup.opp?.playersRemaining);
  const left = myLeft != null && theirLeft != null ? ` ${myLeft} of your players and ${theirLeft} of theirs remain.` : '';
  const statusLine = [
    [recordText(status.record), standingText(status.standing)].filter(Boolean).join(' · '),
    lineupText(status.lineup),
  ].filter(Boolean).join(', ');
  const pickem = status.pickem?.total > 0 ? `${status.pickem.made} of ${status.pickem.total} picks in` : null;
  return (
    <ScoreTile
      league={league.name}
      status={statusLine}
      you={{ name: 'You', score: board.first.scoreLabel, note: playersNote(myLeft) }}
      opp={{ name: opponent, score: board.second.scoreLabel, note: playersNote(theirLeft) }}
      youLeads={my >= theirs}
      margin={margin}
      pct={pct}
      to={`/league/${league.id}/matchups/${matchup.id}`}
      ariaLabel={`${league.name} matchup: ${verb} ${opponent} ${board.first.scoreLabel} to ${board.second.scoreLabel}, ${margin.toLowerCase()}, ${pct}% win probability.${left}`}
      links={leagueLinks(league).filter((l) => l.label !== 'Matchup')}
      extra={pickem && <Box sx={{ fontSize: '14px', color: 'var(--ps-board-dim)' }}>{pickem}</Box>}
      scored={scored}
    />
  );
}

function PickemTileFor({ league }) {
  const { status } = league;
  const { made, total, weekPoints, finals } = status.pickem;
  const { standing } = status;
  let managers = league.team_count != null ? `${league.team_count} managers` : null;
  let figure = standing ? ordinal(standing.rank) : `${made}/${total}`;
  let figureLabel = standing ? `of ${standing.of} this season` : 'picks made';
  let note = standing && total > 0 ? `${made} of ${total} in` : null;
  let ariaLabel = `${league.name} picks: ${figure} ${figureLabel}${note ? `, ${note}` : ''}`;
  // The week's points (a payload that has them): the figure, with the standing beside the mode.
  if (standing && finiteOrNull(weekPoints) != null && finiteOrNull(finals) != null) {
    managers = `${ordinal(standing.rank)} of ${standing.of} this season`;
    figure = String(weekPoints);
    figureLabel = `${weekPoints === 1 ? 'point' : 'points'} this week`;
    const final = `${finals} of ${total} ${total === 1 ? 'game' : 'games'} final`;
    note = `${final}.${finals < total ? ' The rest lock as each game kicks off.' : ''}`;
    ariaLabel = `${league.name} picks: ${figure} ${figureLabel}, ${final}, ${managers}`;
  }
  return (
    <PickemTile
      league={league.name}
      mode="Pick'em"
      standing={managers}
      figure={figure}
      figureLabel={figureLabel}
      note={note}
      to={`/league/${league.id}/pickem`}
      ariaLabel={ariaLabel}
      links={leagueLinks(league)}
    />
  );
}

/** One league: a tile when `tileKind` says so, else a panel. `scored` flashes a live tile's score block. */
function LeagueStatusCard({ league, live = false, scored = false }) {
  const kind = tileKind(league, live);
  if (kind === 'score') return <ScoreTileFor league={league} scored={scored} />;
  if (kind === 'pickem') return <PickemTileFor league={league} />;

  const variant = statusVariant(league);
  const base = `/league/${league.id}`;
  let body;
  let links;
  if (variant === 'fantasy' || variant === 'pickem') {
    body = variant === 'fantasy' ? <FantasyBody league={league} /> : <PickemBody league={league} />;
    links = <LeagueLinks league={league.name} links={leagueLinks(league)} />;
  } else if (variant === 'draft') {
    const drafting = leaguePhaseOf(league) === LEAGUE_PHASE.DRAFTING;
    body = <DraftBody league={league} />;
    links = (
      <PanelNav
        league={league}
        links={[
          { label: 'Draft room', to: `${base}/draft` },
          ...(!drafting && league.is_commissioner === true ? [{ label: 'Draft settings', to: `${base}/draft-settings` }] : []),
        ]}
      />
    );
  } else {
    body = variant === 'basic'
      ? <BasicBody league={league} />
      : <Box sx={dimLineSx}>Status unavailable right now.</Box>;
    links = <PanelNav league={league} links={[{ label: 'Dashboard', to: base }]} />;
  }
  return (
    <LeaguePanel id={`league-status-${league.id}`} name={league.name} to={base} right={league.my_team_name} links={links}>
      {body}
    </LeaguePanel>
  );
}

export default LeagueStatusCard;
