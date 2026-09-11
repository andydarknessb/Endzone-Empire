import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Box } from '@mui/material';
import EmojiEventsOutlined from '@mui/icons-material/EmojiEventsOutlined';
import { visuallyHidden } from '@mui/utils';
import { Badge, Card, GradeChip, SegmentedControl, Skeleton, TeamAvatar } from '../../shared/ui';
import { teamStandingFromRow } from '../../entities/standings';
import { seasonView, useLeagueHistory } from '../../entities/season-archive';
import { teamNameLabel, teamRowKey } from '../../lib/teamIdentity';
// A page reaching below the island for a presentational component ADR 0031's
// #1146 amendment does not yet cover (its clause is written for widgets and
// features; a page reaching below island is already precedent -
// LeagueDashboardPage imports the whole legacy TrophyCase component the same
// way). TrophyIcon is the shared trophy glyph (no emoji in product UI) both
// the champion banner and the trophies list paint.
import { TrophyIcon } from '../../components/TrophyCase/TrophyCase';

const TAB_SEASONS = 'seasons';
const TAB_ALL_TIME = 'all-time';

const TAB_OPTIONS = [
  { value: TAB_SEASONS, label: 'Season History' },
  { value: TAB_ALL_TIME, label: 'All-Time' },
];

// A missing archived standings row for a champion is a data defect (Cory's
// 2026-09-11 ruling on #1213, settling the note #1211/PR #1222 left open):
// log it and render the champion's name alone, never invent a caption and
// never add a per-champion caption field to champions[]. Exported so the page
// test can assert on it without scraping console output.
export function logMissingChampionStanding({ leagueId, season, teamId }) {
  // eslint-disable-next-line no-console -- the deliberate log the ruling calls for
  console.error(
    `League History: champion ${teamId} has no matching archived standings row for league ${leagueId} season ${season}`
  );
}

/**
 * League History page slice (ADR 0020/0029 precedent), on the
 * `/league/:leagueId/history` route in place of the legacy `LeagueHistory`
 * component under `src/components`, which is deleted with its test.
 *
 * Composes the Season archive entity's `useLeagueHistory` (one read of
 * `GET /api/league/:leagueId/history`, kept live over Team-profile updates)
 * with the standings entity's `teamStandingFromRow` for the Record rule
 * (CONTEXT.md "Record") - the one place this page reaches for a second
 * entity, which ADR 0029 permits directly at a page. The hardcoded preview
 * podium and its "coming soon" scaffold are gone; the placeholder year tabs
 * are replaced by a real two-way view: "Season History" (every archived
 * season, ported from the legacy Accordion list) beside "All-Time"
 * (championships and all-time Record per Team from `allTime[]`, #1212).
 *
 * `seasonPresentation` is gone too - the server already decided champions and
 * outcome (`server/services/seasonArchive.service.js`); this page's only
 * client-side work is the standings-shape/pick'em detection and the
 * champion-to-standing join the entity's `seasonView` does, plus formatting
 * the Record or the points/correct caption from whichever row it found.
 */
export default function LeagueHistoryPage() {
  const { leagueId } = useParams();
  const { status, seasons, allTime, error } = useLeagueHistory(leagueId);
  const [tab, setTab] = useState(TAB_SEASONS);

  if (status === 'loading') {
    return (
      <PageShell>
        <Box data-testid="page-skeleton" aria-busy="true" sx={{ display: 'grid', gap: '16px' }}>
          <Skeleton variant="text" width={220} height={40} />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={96} />
          ))}
        </Box>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Box
        component="h1"
        sx={{
          m: 0,
          mb: 2,
          fontFamily: 'var(--dash-font-display)',
          fontSize: { xs: '26px', sm: '32px' },
          fontWeight: 700,
          letterSpacing: '0.02em',
          textTransform: 'uppercase',
          color: 'var(--dash-ink)',
        }}
      >
        League History
      </Box>

      {error && (
        <Box
          role="alert"
          data-testid="league-history-error"
          sx={{ fontSize: '14px', color: 'var(--dash-ink)', mb: 2 }}
        >
          {error}
        </Box>
      )}

      {!error && seasons.length === 0 && (
        <Box
          data-testid="history-empty"
          sx={{
            display: 'grid',
            justifyItems: 'center',
            textAlign: 'center',
            gap: 1.5,
            minHeight: '50vh',
            alignContent: 'center',
            px: 2,
          }}
        >
          <EmojiEventsOutlined sx={{ fontSize: 88, color: 'var(--dash-faint)' }} />
          <Box component="p" sx={{ m: 0, fontSize: '18px', fontWeight: 600, color: 'var(--dash-ink)' }}>
            The Hall of Fame is empty.
          </Box>
          <Box component="p" sx={{ m: 0, fontSize: '14px', color: 'var(--dash-dim)', maxWidth: 420 }}>
            Complete your first season to cement your legacy.
          </Box>
        </Box>
      )}

      {!error && seasons.length > 0 && (
        <>
          <Box sx={{ mb: 2.5 }}>
            <SegmentedControl
              options={TAB_OPTIONS}
              value={tab}
              onChange={setTab}
              aria-label="League History view"
              data-testid="league-history-tabs"
            />
          </Box>

          {tab === TAB_SEASONS && (
            <Box sx={{ display: 'grid', gap: '16px' }} data-testid="league-history-seasons">
              {seasons.map((season) => (
                <SeasonCard key={season.season} season={season} leagueId={leagueId} />
              ))}
            </Box>
          )}

          {tab === TAB_ALL_TIME && <AllTimeCard rows={allTime} />}
        </>
      )}
    </PageShell>
  );
}

function SeasonCard({ season, leagueId }) {
  const {
    standings, trophies, draftGrades, champions, pickem, coChampions,
    explicitNoChampion, trophiesErrored, draftGradesErrored,
  } = seasonView(season);

  return (
    <Card title={`Season ${season.season}`} data-testid={`season-panel-${season.season}`}>
      <Box sx={{ px: 2.25, py: 2 }}>
        <Box sx={{ mb: 2 }}>
          {champions.length > 0 ? (
            <Box data-testid={`champion-${season.season}`} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {champions.map((champion) => (
                <Badge key={champion.teamId} variant="warning">
                  {`${coChampions ? 'Co-Champion' : 'Champion'}: ${teamNameLabel(champion.name)}`}
                </Badge>
              ))}
            </Box>
          ) : (
            <Badge variant="neutral">{explicitNoChampion ? 'No champion' : 'No champion recorded'}</Badge>
          )}
        </Box>

        {champions.length > 0 && (
          <Box
            data-testid={`champion-banner-${season.season}`}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              mb: 3,
              p: 2,
              backgroundColor: 'var(--dash-accent-soft)',
              borderLeft: '4px solid var(--dash-warning)',
              borderRadius: 'var(--dash-radius-sm)',
            }}
          >
            <Box component="span" sx={{ fontSize: '13px', color: 'var(--dash-ink)' }}>
              {coChampions ? 'Season Co-Champions' : 'Season Champion'}
            </Box>
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2 }}>
              {champions.map((champion) => (
                <Box key={champion.teamId} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box component="span" aria-hidden="true" sx={{ display: 'inline-flex', color: 'var(--dash-warning)' }}>
                    <TrophyIcon type="champion" size={32} />
                  </Box>
                  <TeamAvatar
                    name={champion.name}
                    avatarUrl={champion.avatarUrl}
                    avatarStaticUrl={champion.avatarStaticUrl}
                    size={48}
                  />
                  <Box>
                    <Box component="p" sx={{ m: 0, fontSize: '20px', fontWeight: 700, color: 'var(--dash-ink)' }}>
                      {teamNameLabel(champion.name)}
                    </Box>
                    <ChampionCaption pickem={pickem} champion={champion} leagueId={leagueId} season={season.season} />
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        )}

        <SectionHeading id={`season-${season.season}-standings-heading`}>Final Standings</SectionHeading>
        <StandingsTable standings={standings} pickem={pickem} labelledBy={`season-${season.season}-standings-heading`} />

        {trophiesErrored ? (
          <Box component="p" sx={{ fontSize: '13px', color: 'var(--dash-dim)', fontStyle: 'italic', mt: 2 }}>
            Couldn't load trophies for this season
          </Box>
        ) : (
          trophies.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <SectionHeading id={`season-${season.season}-trophies-heading`}>Trophies</SectionHeading>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {trophies.map((trophy) => (
                  <Badge key={trophy.id} variant="neutral">
                    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                      <TrophyIcon type={trophy.type} size={18} />
                      <Box component="span">{`${trophy.label} · ${trophy.team_name}`}</Box>
                    </Box>
                  </Badge>
                ))}
              </Box>
            </Box>
          )
        )}

        {draftGradesErrored ? (
          <Box component="p" sx={{ fontSize: '13px', color: 'var(--dash-dim)', fontStyle: 'italic', mt: 2 }}>
            Couldn't load draft grades for this season
          </Box>
        ) : (
          draftGrades
          && draftGrades.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <SectionHeading id={`season-${season.season}-draft-grades-heading`}>Draft Grades</SectionHeading>
              <DraftGradesTable rows={draftGrades} labelledBy={`season-${season.season}-draft-grades-heading`} />
            </Box>
          )
        )}
      </Box>
    </Card>
  );
}

function ChampionCaption({ pickem, champion, leagueId, season }) {
  const { standing } = champion;
  if (!standing) {
    logMissingChampionStanding({ leagueId, season, teamId: champion.teamId });
    return null;
  }
  return (
    <Box component="p" sx={{ m: 0, fontSize: '13px', color: 'var(--dash-dim)' }}>
      {pickem
        ? `${standing.points} points · ${standing.correct} correct`
        : `${teamStandingFromRow(standing).record} record`}
    </Box>
  );
}

function StandingsTable({ standings, pickem, labelledBy }) {
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box component="table" aria-labelledby={labelledBy} sx={{ width: '100%', borderCollapse: 'collapse' }}>
        <Box component="thead">
          <Box component="tr">
            <HeadCell>Rank</HeadCell>
            <HeadCell>Team</HeadCell>
            {pickem ? (
              <>
                <HeadCell align="right">Points</HeadCell>
                <HeadCell align="right">Correct</HeadCell>
                <HeadCell align="right">Pushes</HeadCell>
              </>
            ) : (
              <>
                <HeadCell align="right">Record</HeadCell>
                <HeadCell align="right">PF</HeadCell>
              </>
            )}
          </Box>
        </Box>
        <Box component="tbody">
          {standings.map((team, index) => (
            <Box component="tr" key={teamRowKey(team.teamId, index)}>
              <BodyCell>
                <MedalIcon rank={team.rank} />
                {team.rank}
              </BodyCell>
              {/* One shared render for both League types (a pick'em archive's
                  null name is an expected departed manager; a fantasy row's
                  null name is a data bug either way, so there is no reason to
                  branch). */}
              <BodyCell>{teamNameLabel(team.name)}</BodyCell>
              {pickem ? (
                <>
                  <BodyCell align="right">{team.points}</BodyCell>
                  <BodyCell align="right">{team.correct}</BodyCell>
                  <BodyCell align="right">{team.pushes ?? 0}</BodyCell>
                </>
              ) : (
                <>
                  <BodyCell align="right">{teamStandingFromRow(team).record}</BodyCell>
                  <BodyCell align="right">{team.pf}</BodyCell>
                </>
              )}
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

function DraftGradesTable({ rows, labelledBy }) {
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box component="table" aria-labelledby={labelledBy} sx={{ width: '100%', borderCollapse: 'collapse' }}>
        <Box component="thead">
          <Box component="tr">
            <HeadCell>Rank</HeadCell>
            <HeadCell>Team</HeadCell>
            <HeadCell align="center">Grade</HeadCell>
            <HeadCell align="right">Roster Value</HeadCell>
          </Box>
        </Box>
        <Box component="tbody">
          {rows.map((row) => (
            <Box component="tr" key={row.teamId}>
              <BodyCell>{row.rank}</BodyCell>
              <BodyCell>{teamNameLabel(row.name)}</BodyCell>
              <BodyCell align="center">
                <GradeChip grade={row.grade} />
              </BodyCell>
              <BodyCell align="right">
                {row.rosterValue == null ? (
                  <>
                    <Box component="span" aria-hidden="true">-</Box>
                    <Box component="span" sx={visuallyHidden}>Not available</Box>
                  </>
                ) : (
                  row.rosterValue
                )}
              </BodyCell>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

// The All-Time table shows a Record column only when at least one Team has a
// numeric one (R2, server/services/seasonArchive.service.js): a pick'em-only
// League's roster is every row null, and the column would otherwise promise
// a fact no Team there has. A single null-wins row in a mixed table gets an
// empty Record cell instead of inventing 0-0.
function AllTimeCard({ rows }) {
  const anyRecord = rows.some((row) => row.wins != null);
  return (
    <Card title="All-Time" data-testid="league-history-all-time">
      <Box sx={{ px: 2.25, py: 2, overflowX: 'auto' }}>
        <Box component="table" aria-label="All-Time Records" sx={{ width: '100%', borderCollapse: 'collapse' }}>
          <Box component="thead">
            <Box component="tr">
              <HeadCell>Team</HeadCell>
              <HeadCell align="right">Championships</HeadCell>
              {anyRecord && <HeadCell align="right">Record</HeadCell>}
            </Box>
          </Box>
          <Box component="tbody">
            {rows.map((row, index) => (
              <Box component="tr" key={teamRowKey(row.teamId, index)}>
                <BodyCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                    <TeamAvatar name={row.name} avatarUrl={row.avatarUrl} size={24} />
                    <Box component="span">{teamNameLabel(row.name)}</Box>
                  </Box>
                </BodyCell>
                <BodyCell align="right">{row.championships}</BodyCell>
                {anyRecord && (
                  <BodyCell align="right">
                    {row.wins != null ? teamStandingFromRow(row).record : null}
                  </BodyCell>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Card>
  );
}

// The medal marks on the standings rows, as inline stroke glyphs (no emoji in
// product UI): decorative and aria-hidden, the rank number beside them
// carries the meaning.
const MEDAL_COLOR = { 1: 'var(--dash-warning)', 2: 'var(--medal-silver)', 3: 'var(--medal-bronze)' };

function MedalIcon({ rank }) {
  const color = MEDAL_COLOR[rank];
  if (!color) return null;
  return (
    <Box
      component="svg"
      width={16}
      height={16}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-medal={rank}
      sx={{ color, mr: 0.5, verticalAlign: 'text-bottom' }}
    >
      <circle cx="10" cy="12.5" r="4.5" />
      <path d="M7 8.4 5 3.5h10l-2 4.9" />
    </Box>
  );
}

function SectionHeading({ id, children }) {
  return (
    <Box
      component="h3"
      id={id}
      sx={{ m: 0, mb: 1, fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--dash-faint)' }}
    >
      {children}
    </Box>
  );
}

function HeadCell({ children, align = 'left' }) {
  return (
    <Box
      component="th"
      scope="col"
      sx={{ textAlign: align, px: 1.25, py: 1, fontSize: '11px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--dash-faint)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--dash-line)' }}
    >
      {children}
    </Box>
  );
}

function BodyCell({ children, align = 'left' }) {
  return (
    <Box
      component="td"
      sx={{ textAlign: align, px: 1.25, py: 1, fontSize: '13.5px', color: 'var(--dash-ink)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', borderBottom: '1px solid var(--dash-line)' }}
    >
      {children}
    </Box>
  );
}

function PageShell({ children }) {
  return (
    <Box sx={{ backgroundColor: 'var(--dash-bg)', color: 'var(--dash-ink)', fontFamily: 'var(--dash-font-body)', minHeight: '100%' }}>
      <Box sx={{ maxWidth: 1100, mx: 'auto', px: { xs: 2, sm: 3 }, py: { xs: 2.5, sm: 3.5 } }}>
        {children}
      </Box>
    </Box>
  );
}
