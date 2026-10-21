import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Box } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { AbbreviationTooltip, SegmentedControl } from '../../shared/ui';
import {
  Frame, FrameHead, PixelHeading, Skel, Tag, TeamMark, psRootSx,
} from '../../shared/ui/playselect';
import { teamStandingFromRow } from '../../entities/standings';
import { seasonView, useLeagueHistory } from '../../entities/season-archive';
import { teamNameLabel, teamRowKey } from '../../shared/lib';
import LeagueBreadcrumb from '../../components/LeagueBreadcrumb/LeagueBreadcrumb';
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
 * `/league/:leagueId/history` route, painted on Play-select (ADR 0067 wave 5).
 *
 * Composes the Season archive entity's `useLeagueHistory` (one read of
 * `GET /api/league/:leagueId/history`, kept live over Team-profile updates)
 * with the standings entity's `teamStandingFromRow` for the Record rule
 * (CONTEXT.md "Record") - the one place this page reaches for a second
 * entity, which ADR 0029 permits directly at a page. Two views: "Season
 * History" (every archived season) beside "All-Time" (championships and
 * all-time Record per Team from `allTime[]`, #1212).
 *
 * The server already decided champions and outcome
 * (`server/services/seasonArchive.service.js`); this page's only client-side
 * work is the standings-shape/pick'em detection and the champion-to-standing
 * join the entity's `seasonView` does, plus formatting the Record or the
 * points/correct caption from whichever row it found.
 */
export default function LeagueHistoryPage() {
  const { leagueId } = useParams();
  const { status, seasons, allTime, error } = useLeagueHistory(leagueId);
  const [tab, setTab] = useState(TAB_SEASONS);

  if (status === 'loading') {
    return (
      <PageShell>
        <Box data-testid="page-skeleton" aria-busy="true" sx={{ display: 'grid', gap: '16px' }}>
          <Skel width="220px" height={40} />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skel key={i} width="100%" height={96} />
          ))}
        </Box>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <LeagueBreadcrumb look="playselect" />
        <PixelHeading level={1}>League History</PixelHeading>
      </Box>

      {error && (
        <Frame
          tier="rule"
          tone="danger"
          component="div"
          role="alert"
          data-testid="league-history-error"
          sx={{ padding: '16px 20px', fontSize: '16px' }}
        >
          {error}
        </Frame>
      )}

      {!error && seasons.length === 0 && (
        <Frame
          tier="rule"
          component="div"
          data-testid="history-empty"
          sx={{
            display: 'grid', justifyItems: 'center', textAlign: 'center', gap: '12px', padding: '48px 20px',
          }}
        >
          <Box sx={{ color: 'var(--ps-dim)', display: 'inline-flex' }}><TrophyIcon type="champion" size={88} /></Box>
          <Box component="p" sx={{ m: 0, fontSize: '18px', fontWeight: 600 }}>The Hall of Fame is empty.</Box>
          <Box component="p" sx={{ m: 0, fontSize: '16px', color: 'var(--ps-dim)', maxWidth: 420 }}>
            Complete your first season to cement your legacy.
          </Box>
        </Frame>
      )}

      {!error && seasons.length > 0 && (
        <>
          <Box sx={{ alignSelf: 'flex-start' }}>
            <SegmentedControl
              look="playselect"
              options={TAB_OPTIONS}
              value={tab}
              onChange={setTab}
              aria-label="League History view"
              data-testid="league-history-tabs"
            />
          </Box>

          {tab === TAB_SEASONS && (
            <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '16px' }} data-testid="league-history-seasons">
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
  const headingId = `season-${season.season}-heading`;

  return (
    <Frame
      tier="rule"
      labelledBy={headingId}
      data-testid={`season-panel-${season.season}`}
      head={<FrameHead><PixelHeading id={headingId}>{`Season ${season.season}`}</PixelHeading></FrameHead>}
    >
      <Box sx={{ p: { xs: '14px', md: '20px' }, display: 'flex', flexDirection: 'column', gap: '24px', minWidth: 0 }}>
        <Box sx={{ minWidth: 0 }}>
          {champions.length > 0 ? (
            <Box data-testid={`champion-${season.season}`} sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {champions.map((champion) => (
                <Tag key={champion.teamId} full>
                  {`${coChampions ? 'Co-Champion' : 'Champion'}: ${teamNameLabel(champion.name)}`}
                </Tag>
              ))}
            </Box>
          ) : (
            <Tag>{explicitNoChampion ? 'No champion' : 'No champion recorded'}</Tag>
          )}
        </Box>

        {champions.length > 0 && (
          <Box
            data-testid={`champion-banner-${season.season}`}
            sx={{
              display: 'flex', flexDirection: 'column', gap: '16px', p: '16px', border: '2px solid var(--ps-rule)', minWidth: 0,
            }}
          >
            <Box component="span" sx={{ fontSize: '14px', color: 'var(--ps-dim)' }}>
              {coChampions ? 'Season Co-Champions' : 'Season Champion'}
            </Box>
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, flexWrap: 'wrap', gap: '16px' }}>
              {champions.map((champion) => (
                <Box key={champion.teamId} sx={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                  <Box component="span" aria-hidden="true" sx={{ display: 'inline-flex', color: 'var(--ps-medal-gold)' }}>
                    <TrophyIcon type="champion" size={32} />
                  </Box>
                  <TeamMark
                    name={champion.name}
                    avatarUrl={champion.avatarUrl}
                    avatarStaticUrl={champion.avatarStaticUrl}
                    size={48}
                  />
                  <Box sx={{ minWidth: 0 }}>
                    <Box component="p" sx={{ m: 0, fontSize: '20px', fontWeight: 700, overflowWrap: 'anywhere' }}>
                      {teamNameLabel(champion.name)}
                    </Box>
                    <ChampionCaption pickem={pickem} champion={champion} leagueId={leagueId} season={season.season} />
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        )}

        <Box sx={{ minWidth: 0 }}>
          <SectionHeading id={`season-${season.season}-standings-heading`}>Final Standings</SectionHeading>
          <StandingsTable standings={standings} pickem={pickem} labelledBy={`season-${season.season}-standings-heading`} />
        </Box>

        {trophiesErrored ? (
          <Note>Couldn't load trophies for this season</Note>
        ) : (
          trophies.length > 0 && (
            <Box sx={{ minWidth: 0 }}>
              <SectionHeading id={`season-${season.season}-trophies-heading`}>Trophies</SectionHeading>
              <Box
                component="ul"
                role="list"
                aria-labelledby={`season-${season.season}-trophies-heading`}
                sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: '8px' }}
              >
                {trophies.map((trophy) => (
                  <Box key={trophy.id} component="li" sx={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px' }}>
                    <TrophyIcon type={trophy.type} size={18} />
                    <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{`${trophy.label} · ${trophy.team_name}`}</Box>
                  </Box>
                ))}
              </Box>
            </Box>
          )
        )}

        {draftGradesErrored ? (
          <Note>Couldn't load draft grades for this season</Note>
        ) : (
          draftGrades
          && draftGrades.length > 0 && (
            <Box sx={{ minWidth: 0 }}>
              <SectionHeading id={`season-${season.season}-draft-grades-heading`}>Draft Grades</SectionHeading>
              <DraftGradesTable rows={draftGrades} labelledBy={`season-${season.season}-draft-grades-heading`} />
            </Box>
          )
        )}
      </Box>
    </Frame>
  );
}

function ChampionCaption({ pickem, champion, leagueId, season }) {
  const { standing } = champion;
  if (!standing) {
    logMissingChampionStanding({ leagueId, season, teamId: champion.teamId });
    return null;
  }
  return (
    <Box component="p" sx={{ m: 0, fontSize: '14px', color: 'var(--ps-dim)' }}>
      {pickem
        ? `${standing.points} points · ${standing.correct} correct`
        : `${teamStandingFromRow(standing).record} record`}
    </Box>
  );
}

function StandingsTable({ standings, pickem, labelledBy }) {
  return (
    <Box sx={{ position: 'relative', overflowX: 'auto' }}>
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
                <HeadCell align="right"><AbbreviationTooltip term="PF" /></HeadCell>
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
              <BodyCell asRowHeader>{teamNameLabel(team.name)}</BodyCell>
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
    <Box sx={{ position: 'relative', overflowX: 'auto' }}>
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
              <BodyCell asRowHeader>{teamNameLabel(row.name)}</BodyCell>
              <BodyCell align="center">
                <Tag>{row.grade}</Tag>
              </BodyCell>
              <BodyCell align="right">
                {row.rosterValue == null ? <Placeholder /> : row.rosterValue}
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
    <Frame
      tier="rule"
      labelledBy="league-history-all-time-heading"
      data-testid="league-history-all-time"
      head={<FrameHead><PixelHeading id="league-history-all-time-heading">All-Time</PixelHeading></FrameHead>}
    >
      <Box sx={{ position: 'relative', p: { xs: '14px', md: '20px' }, overflowX: 'auto' }}>
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
                <BodyCell asRowHeader>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <TeamMark name={row.name} avatarUrl={row.avatarUrl} avatarStaticUrl={row.avatarStaticUrl} size={28} />
                    <Box component="span">{teamNameLabel(row.name)}</Box>
                  </Box>
                </BodyCell>
                <BodyCell align="right">{row.championships}</BodyCell>
                {anyRecord && (
                  <BodyCell align="right">
                    {row.wins != null ? teamStandingFromRow(row).record : <Placeholder />}
                  </BodyCell>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Frame>
  );
}

// The medal marks on the standings rows, as inline stroke glyphs (no emoji in
// product UI): decorative and aria-hidden, the rank number beside them
// carries the meaning. The three colours are the ps-medal tokens.
const MEDAL_COLOR = { 1: 'var(--ps-medal-gold)', 2: 'var(--ps-medal-silver)', 3: 'var(--ps-medal-bronze)' };

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
      sx={{ m: 0, mb: '8px', fontSize: '14px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ps-dim)' }}
    >
      {children}
    </Box>
  );
}

function Note({ children }) {
  return (
    <Box component="p" sx={{ m: 0, fontSize: '14px', color: 'var(--ps-dim)', fontStyle: 'italic' }}>
      {children}
    </Box>
  );
}

function HeadCell({ children, align = 'left' }) {
  return (
    <Box
      component="th"
      scope="col"
      sx={{ textAlign: align, px: '10px', py: '8px', fontSize: '13px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ps-dim)', whiteSpace: 'nowrap', borderBottom: '2px solid var(--ps-rule)' }}
    >
      {children}
    </Box>
  );
}

// The Team cell is the row header (`th scope="row"`), matching the
// established island table convention (StandingsTable.jsx):
// a screen reader reading a number cell hears which Team it belongs to.
function BodyCell({ children, align = 'left', asRowHeader = false }) {
  return (
    <Box
      component={asRowHeader ? 'th' : 'td'}
      {...(asRowHeader ? { scope: 'row' } : {})}
      sx={{
        textAlign: align,
        px: '10px',
        py: '8px',
        fontSize: '15px',
        fontWeight: 400,
        color: 'var(--ps-ink)',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        borderBottom: '1px solid var(--ps-rule)',
      }}
    >
      {children}
    </Box>
  );
}

// The placeholder mark for a cell with no value to show: a dash, no digits.
// The dash is a visual mark only, so it is aria-hidden and a visually-hidden
// "Not available" carries the same meaning to a screen reader (matches
// StandingsTable.jsx's Placeholder and this file's own rosterValue cell).
function Placeholder() {
  return (
    <>
      <Box component="span" aria-hidden="true">-</Box>
      <Box component="span" sx={visuallyHidden}>Not available</Box>
    </>
  );
}

function PageShell({ children }) {
  return (
    <Box className="ps-root" sx={{ ...psRootSx, minHeight: '100%' }}>
      <Box
        data-testid="league-history"
        sx={{
          maxWidth: '1100px',
          marginX: 'auto',
          boxSizing: 'border-box',
          padding: { xs: '14px 16px 48px', sm: '24px 32px 64px' },
          display: 'flex',
          flexDirection: 'column',
          gap: { xs: '16px', sm: '24px' },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
