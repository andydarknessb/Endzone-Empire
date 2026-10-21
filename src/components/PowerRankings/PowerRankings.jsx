import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Box, useMediaQuery } from '@mui/material';
import apiClient from '../../api/apiClient';
import { readHttpFailure } from '../../lib/httpFailure';
import { applyTeamProfileUpdate, subscribeToTeamProfileUpdates } from '../../lib/teamProfileEvents';
import { recordsByTeamId } from '../../entities/standings';
import LeagueBreadcrumb from '../LeagueBreadcrumb/LeagueBreadcrumb';
import { ErrorPanel, Skel } from '../../shared/ui/playselect/Controls';
import { Frame, PixelHeading } from '../../shared/ui/playselect/Frame';
import { PixelArrow } from '../../shared/ui/playselect/Icons';
import { TeamMark, YouTag } from '../../shared/ui/playselect/Marks';
import { psRootSx } from '../../shared/ui/playselect/root';
import '../../shared/ui/playselect/playselect.css';

const PHONE_QUERY = '(max-width:599.95px)';

function Dim({ children, sx, ...rest }) {
  return (
    <Box component="p" {...rest} sx={{ m: 0, fontSize: '15px', color: 'var(--ps-dim)', ...sx }}>{children}</Box>
  );
}

function Shell({ children }) {
  return (
    <Box className="ps-root" sx={{ ...psRootSx, minHeight: '100%' }}>
      <Box
        data-testid="power-rankings"
        sx={{
          maxWidth: '1280px',
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

// Odds read as a bar on a ruled track; the percentage sits beside it.
function OddsCell({ value, label }) {
  const pct = Math.round((value || 0) * 1000) / 10;
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 140 }}>
      <Box
        role="progressbar"
        aria-label={`${label} ${pct}%`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        sx={{ flexGrow: 1, height: '10px', border: '2px solid var(--ps-rule)', boxSizing: 'border-box' }}
      >
        <Box sx={{ height: '100%', width: `${clamped}%`, backgroundColor: 'var(--ps-play)' }} />
      </Box>
      <Box component="span" sx={{ minWidth: 48, textAlign: 'right' }}>{pct}%</Box>
    </Box>
  );
}

// Movement is Ink: a PixelArrow (up or down) and a signed number. The arrow points right, so it turns.
function Move({ change, suffix = '' }) {
  const up = change > 0;
  const n = Math.abs(change);
  return (
    <Box
      component="span"
      data-testid="movement"
      aria-label={`${up ? 'up' : 'down'} ${n}`}
      sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--ps-ink)', whiteSpace: 'nowrap' }}
    >
      <Box component="span" data-testid="movement-arrow" aria-hidden="true" sx={{ display: 'inline-flex', transform: `rotate(${up ? -90 : 90}deg)` }}>
        <PixelArrow />
      </Box>
      <span>{up ? '+' : '-'}{n}{suffix}</span>
    </Box>
  );
}

function MovementCell({ change }) {
  if (change === null || change === undefined) {
    return (
      <Box
        component="span"
        data-testid="movement-new"
        sx={{ border: '2px solid var(--ps-rule)', padding: '2px 6px', fontSize: '13px', fontWeight: 700 }}
      >
        NEW
      </Box>
    );
  }
  if (change === 0) {
    return <Box component="span" aria-label="no change" sx={{ color: 'var(--ps-dim)' }}>–</Box>;
  }
  return <Move change={change} />;
}

// The Record arrives FORMATTED from the standings entity (src/entities/
// standings, #959/#1044); this only masks a missing standing, exactly as it
// always has.
function formatRecord(record) {
  return record || '-';
}

function TeamName({ team, size, isViewer }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
      <TeamMark name={team.name} avatarUrl={team.avatarUrl} avatarStaticUrl={team.avatarStaticUrl} size={size} />
      <span>{team.name}</span>
      {isViewer && <YouTag />}
    </Box>
  );
}

function HighlightCard({ label, team, change, up }) {
  return (
    <Frame
      component="div"
      tier="rule"
      data-testid={`highlight-card-${up ? 'mover' : 'faller'}`}
      sx={{ flex: 1, minWidth: { sm: 220 }, padding: '14px 16px' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
          <TeamMark name={team.name} avatarUrl={team.avatarUrl} avatarStaticUrl={team.avatarStaticUrl} />
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ fontSize: '13px', color: 'var(--ps-dim)', textTransform: 'uppercase' }}>{label}</Box>
            <Box component="p" sx={{ m: 0, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {team.name}
            </Box>
          </Box>
        </Box>
        <Move change={change} suffix={` Spot${Math.abs(change) === 1 ? '' : 's'}`} />
      </Box>
    </Frame>
  );
}

const CELL = { padding: '10px 8px', textAlign: 'left', borderBottom: '2px solid var(--ps-rule)', fontSize: '15px' };

function SortHead({ label, sortKey, orderBy, order, onSort, right }) {
  const active = orderBy === sortKey;
  return (
    <th
      scope="col"
      aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : undefined}
      className={right ? 'num' : undefined}
    >
      <Box
        component="button"
        type="button"
        onClick={() => onSort(sortKey)}
        sx={{
          font: 'inherit', fontWeight: 600, color: active ? 'var(--ps-ink)' : 'var(--ps-dim)', background: 'none',
          border: 0, padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px',
        }}
      >
        {label}
        {active && (
          <Box component="span" aria-hidden="true" sx={{ display: 'inline-flex', transform: `rotate(${order === 'asc' ? -90 : 90}deg)` }}>
            <PixelArrow />
          </Box>
        )}
      </Box>
    </th>
  );
}

const SORT_DEFAULT_DIRECTION = { rank: 'asc', winPct: 'desc', avgScore: 'desc' };

function sortRankings(rankings, orderBy, order) {
  const sorted = [...rankings];
  sorted.sort((a, b) => {
    const diff = (a[orderBy] || 0) - (b[orderBy] || 0);
    return order === 'asc' ? diff : -diff;
  });
  return sorted;
}

const winPct = (team) => Math.round((team.winPct || 0) * 1000) / 10;

function PowerRankings() {
  const { leagueId } = useParams();
  const isMobile = useMediaQuery(PHONE_QUERY);
  const [payload, setPayload] = useState(null);
  const [standings, setStandings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notComputed, setNotComputed] = useState(false);
  const [orderBy, setOrderBy] = useState('rank');
  const [order, setOrder] = useState('asc');

  useEffect(() => {
    fetchRankings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  useEffect(() => subscribeToTeamProfileUpdates((update) => {
    if (Number(update.leagueId) !== Number(leagueId)) return;
    setPayload((prev) => {
      const rankings = prev?.data?.rankings;
      if (!Array.isArray(rankings)) return prev;
      return {
        ...prev,
        data: { ...prev.data, rankings: rankings.map((team) => applyTeamProfileUpdate(team, update)) },
      };
    });
    setStandings((prev) => prev.map((team) => applyTeamProfileUpdate(team, update)));
  }), [leagueId]);

  const fetchRankings = async () => {
    try {
      setLoading(true);
      setError(null);
      setNotComputed(false);
      const res = await apiClient.get(`/api/scoring/league/${leagueId}/power-rankings`);
      setPayload(res.data);
      apiClient
        .get(`/api/scoring/league/${leagueId}/standings`)
        .then((standingsRes) => setStandings(standingsRes.data?.standings || []))
        .catch(() => setStandings([]));
    } catch (err) {
      if (err.response?.status === 404) {
        setNotComputed(true);
        setPayload(null);
      } else {
        setError(readHttpFailure(err).message || err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const rankings = useMemo(() => payload?.data?.rankings || [], [payload]);
  const viewerTeamId = payload?.viewerTeamId ?? null;

  const sortedRankings = useMemo(
    () => sortRankings(rankings, orderBy, order),
    [rankings, orderBy, order]
  );

  const recordByTeamId = useMemo(() => recordsByTeamId(standings), [standings]);

  const { biggestMover, biggestFaller } = useMemo(() => {
    const movers = rankings.filter((t) => typeof t.change === 'number' && t.change > 0);
    const fallers = rankings.filter((t) => typeof t.change === 'number' && t.change < 0);
    const mover = movers.reduce((best, t) => (!best || t.change > best.change ? t : best), null);
    const faller = fallers.reduce((worst, t) => (!worst || t.change < worst.change ? t : worst), null);
    return { biggestMover: mover, biggestFaller: faller };
  }, [rankings]);

  const handleSort = (key) => {
    if (orderBy === key) {
      setOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setOrderBy(key);
      setOrder(SORT_DEFAULT_DIRECTION[key]);
    }
  };

  if (loading) {
    return (
      <Shell>
        <Box data-testid="page-skeleton" aria-busy="true" sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Skel width={220} height={36} />
          <Skel width={160} height={16} />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skel key={i} width="100%" height={44} />
          ))}
        </Box>
      </Shell>
    );
  }

  return (
    <Shell>
      <Box>
        <LeagueBreadcrumb look="playselect" />
        <PixelHeading id="power-rankings-table-heading" level={1}>Power Rankings</PixelHeading>
        {payload && (
          <Dim sx={{ mt: '8px' }}>Season {payload.season} · Week {payload.week}</Dim>
        )}
      </Box>

      {error && (
        <ErrorPanel
          title="Power rankings"
          body={error}
          onRetry={fetchRankings}
          retryAriaLabel="Try again to load power rankings"
        />
      )}

      {notComputed && (
        <Frame
          component="div"
          tier="rule"
          data-testid="power-rankings-empty"
          sx={{ padding: '32px 20px', textAlign: 'center' }}
        >
          <Box component="p" sx={{ m: 0, mb: '8px', fontWeight: 700 }}>No rankings yet</Box>
          <Dim>Rankings appear after the first scored week</Dim>
        </Frame>
      )}

      {payload && (
        <>
          <Dim sx={{ fontSize: '13px' }}>
            Computed {new Date(payload.data.computedAt).toLocaleString()} · {payload.data.runs}{' '}
            simulation runs
          </Dim>

          {(biggestMover || biggestFaller) && (
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: '16px' }}>
              {biggestMover && (
                <HighlightCard label="Biggest Mover" team={biggestMover} change={biggestMover.change} up />
              )}
              {biggestFaller && (
                <HighlightCard label="Biggest Faller" team={biggestFaller} change={biggestFaller.change} up={false} />
              )}
            </Box>
          )}

          {isMobile ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {sortedRankings.map((team) => {
                const isViewer = viewerTeamId != null && team.teamId === viewerTeamId;
                return (
                  <Frame
                    key={team.teamId}
                    component="div"
                    tier="rule"
                    data-testid={`power-ranking-row-${team.teamId}`}
                    data-viewer-team={isViewer || undefined}
                    sx={{ padding: '14px 16px', fontVariantNumeric: 'tabular-nums' }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', mb: '4px' }}>
                      <TeamMark name={team.name} avatarUrl={team.avatarUrl} avatarStaticUrl={team.avatarStaticUrl} size={32} />
                      <Box component="p" sx={{ m: 0, fontWeight: 700 }}>#{team.rank} {team.name}</Box>
                      {isViewer && <YouTag />}
                      <MovementCell change={team.change} />
                    </Box>
                    <Dim sx={{ mb: '12px' }}>
                      Win {winPct(team)}% · Avg {team.avgScore} ·{' '}
                      {formatRecord(recordByTeamId.get(team.teamId))}
                    </Dim>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <Box>
                        <Dim sx={{ fontSize: '13px' }}>Playoff</Dim>
                        <OddsCell value={team.playoffOdds} label="Playoff odds" />
                      </Box>
                      <Box>
                        <Dim sx={{ fontSize: '13px' }}>Title</Dim>
                        <OddsCell value={team.titleOdds} label="Title odds" />
                      </Box>
                    </Box>
                  </Frame>
                );
              })}
            </Box>
          ) : (
            <Frame component="div">
              <Box sx={{ overflowX: 'auto' }}>
                <Box
                  component="table"
                  aria-labelledby="power-rankings-table-heading"
                  sx={{
                    width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums', color: 'var(--ps-ink)',
                    '& th': { ...CELL, color: 'var(--ps-dim)', fontWeight: 600 },
                    '& td': CELL,
                    '& tr:last-of-type td': { borderBottom: 'none' },
                    '& .num': { textAlign: 'right' },
                    '& tr[data-viewer-team] td:first-of-type': { boxShadow: 'inset 4px 0 0 var(--ps-play)' },
                  }}
                >
                  <thead>
                    <tr>
                      <SortHead label="Rank" sortKey="rank" orderBy={orderBy} order={order} onSort={handleSort} />
                      <th scope="col">Team</th>
                      <th scope="col">Record</th>
                      <th scope="col">Move</th>
                      <SortHead label="Win %" sortKey="winPct" orderBy={orderBy} order={order} onSort={handleSort} right />
                      <SortHead label="Avg Score" sortKey="avgScore" orderBy={orderBy} order={order} onSort={handleSort} right />
                      <th scope="col">Playoff Odds</th>
                      <th scope="col">Title Odds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRankings.map((team) => {
                      const isViewer = viewerTeamId != null && team.teamId === viewerTeamId;
                      return (
                        <tr
                          key={team.teamId}
                          data-testid={`power-ranking-row-${team.teamId}`}
                          data-viewer-team={isViewer || undefined}
                        >
                          <td><strong>{team.rank}</strong></td>
                          <td><TeamName team={team} size={28} isViewer={isViewer} /></td>
                          <td>{formatRecord(recordByTeamId.get(team.teamId))}</td>
                          <td><MovementCell change={team.change} /></td>
                          <td className="num">{winPct(team)}%</td>
                          <td className="num">{team.avgScore}</td>
                          <td><OddsCell value={team.playoffOdds} label="Playoff odds" /></td>
                          <td><OddsCell value={team.titleOdds} label="Title odds" /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Box>
              </Box>
            </Frame>
          )}
        </>
      )}
    </Shell>
  );
}

export default PowerRankings;
