import React, { useState, useEffect, useId } from 'react';
import { useParams } from 'react-router-dom';
import { Box } from '@mui/material';
import apiClient from '../../api/apiClient';
import { readHttpFailure } from '../../lib/httpFailure';
import { useLeague } from '../../hooks/useLeague';
import { isPickemOnly } from '../../shared/lib/leagueType';
import { activityFromRow } from '../../entities/activity';
import LeagueBreadcrumb from '../LeagueBreadcrumb/LeagueBreadcrumb';
import PlayerDecisionCard, { fromCard } from '../../widgets/player-decision-card';
import { PlayerNameLink } from '../../entities/player';
import { formatTimeSince } from '../../shared/lib/formatTimeSince';
import SegmentedControl from '../../shared/ui/SegmentedControl';
import {
  ErrorPanel, PsButton, Skel,
} from '../../shared/ui/playselect/Controls';
import { Frame, PixelHeading } from '../../shared/ui/playselect/Frame';
import { PosTag, Tag, TeamMark } from '../../shared/ui/playselect/Marks';
import { psRootSx } from '../../shared/ui/playselect/root';
import '../../shared/ui/playselect/playselect.css';

const PAGE_SIZE = 30;

// Kind tag label per transaction type; an unlisted type prints its own word.
const TYPE_LABEL = {
  add: 'Add',
  drop: 'Drop',
  waiver: 'Waiver',
  trade: 'Trade',
  commissioner: 'Settings',
  stat_correction: 'Stat correction',
  recap: 'Recap',
};
const kindLabel = (type) => TYPE_LABEL[type] || (type ? `${type[0].toUpperCase()}${type.slice(1)}` : 'Activity');

// Adds, drops, waivers and trades are roster moves: a pick'em-only league
// has no roster, so those toggles are trimmed there and only the types that
// can occur remain (`fantasyOnly`).
const FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'add', label: 'Adds', fantasyOnly: true },
  { value: 'drop', label: 'Drops', fantasyOnly: true },
  { value: 'waiver', label: 'Waivers', fantasyOnly: true },
  { value: 'trade', label: 'Trades', fantasyOnly: true },
  { value: 'commissioner', label: 'Commissioner' },
];

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// "Today"/"Yesterday" close in, a short date beyond that (year included only
// when it isn't the current one) — mirrors formatTimeSince's date fallback.
function dayLabel(dateLike) {
  const date = new Date(dateLike);
  const now = new Date(Date.now());
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

// The Activity read model's `segments` in order (see src/entities/activity,
// #1100/#1112): a PlayerNameLink at each player part and plain text at each
// text part, so a name is a link because it IS one, never because it matched
// the flat sentence. The segment carries `playerId` and `name` (the whole
// entry the card needs, ADR 0040 ruling d) and a `position` that draws a PosTag.
function renderSegments(segments, onOpenPlayer) {
  return segments.map((seg, i) => (seg.type === 'player' ? (
    <React.Fragment key={`${seg.playerId}-${i}`}>
    <PlayerNameLink
      name={seg.name}
      playerId={seg.playerId}
      onOpen={() => onOpenPlayer({ playerId: seg.playerId, name: seg.name })}
      sx={{
        color: 'var(--ps-ink)', textDecoration: 'underline', textUnderlineOffset: '4px', fontWeight: 600, minHeight: 44,
        // The link brings its own ring; the kit's replaces it.
        '&:focus-visible, &.MuiLink-focusVisible': {
          outline: '3px solid var(--ps-focus)', outlineOffset: 0, boxShadow: '0 0 0 7px var(--ps-halo)', borderRadius: 0,
        },
      }}
    />
    {seg.position && <PosTag position={seg.position} sx={{ ml: '6px' }} />}
    </React.Fragment>
  ) : (
    <React.Fragment key={i}>{seg.value}</React.Fragment>
  )));
}

// One move: the kind Tag, the team (mark + name) and the model's sentence, with
// a relative time at the right.
function ActivityRow({ txn, onOpenPlayer, last }) {
  const { segments } = activityFromRow(txn);
  return (
    <Box
      component="li"
      data-testid={`txn-${txn.id}`}
      data-type={txn.type}
      sx={{
        display: 'grid',
        gridTemplateAreas: { xs: '"tag time" "text text"', sm: '"tag text time"' },
        gridTemplateColumns: { xs: 'auto 1fr', sm: '120px minmax(0, 1fr) auto' },
        alignItems: 'start',
        gap: { xs: '6px 12px', sm: '12px' },
        minHeight: '44px',
        boxSizing: 'border-box',
        padding: { xs: '10px 0', sm: '8px 0' },
        borderBottom: last ? 0 : '2px solid var(--ps-rule)',
      }}
    >
      <Box component="span" sx={{ gridArea: 'tag', display: 'flex' }}>
        <Tag data-testid="txn-kind">{kindLabel(txn.type)}</Tag>
      </Box>
      <Box
        data-testid="txn-desc"
        sx={{
          gridArea: 'text', minWidth: 0, fontSize: '15px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0 6px',
        }}
      >
        {txn.team_name && (
          <>
            <TeamMark
              name={txn.team_name}
              avatarUrl={txn.team_avatar_url}
              avatarStaticUrl={txn.team_avatar_static_url}
              size={24}
            />
            <Box component="span" sx={{ fontWeight: 600 }}>{txn.team_name}</Box>
            {' '}
          </>
        )}
        <span>{renderSegments(segments, onOpenPlayer)}</span>
      </Box>
      <Box
        component="span"
        title={new Date(txn.created_at).toLocaleString()}
        sx={{
          gridArea: 'time', justifySelf: 'end', whiteSpace: 'nowrap', fontSize: '14px', color: 'var(--ps-dim)', paddingTop: { sm: '5px' },
        }}
      >
        {formatTimeSince(txn.created_at)}
      </Box>
    </Box>
  );
}

// A native select on ps tokens, labelled so "Team" is its accessible name.
function TeamSelect({ value, onChange, names }) {
  const id = useId();
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: { sm: 200 } }}>
      <Box component="label" htmlFor={id} sx={{ fontSize: '14px', fontWeight: 600 }}>Team</Box>
      <Box
        component="select"
        id={id}
        value={value}
        onChange={onChange}
        sx={{
          boxSizing: 'border-box',
          height: '44px',
          borderRadius: 0,
          backgroundColor: 'var(--ps-field)',
          color: 'var(--ps-ink)',
          border: '2px solid var(--ps-dim)',
          fontFamily: 'inherit',
          fontSize: '16px',
          padding: '0 12px',
          width: '100%',
          '&:hover, &:focus': { borderColor: 'var(--ps-ink)' },
        }}
      >
        <option value="all">All Teams</option>
        {names.map((name) => <option key={name} value={name}>{name}</option>)}
      </Box>
    </Box>
  );
}

function Shell({ children, ...rest }) {
  return (
    <Box className="ps-root" sx={{ ...psRootSx, minHeight: '100%' }}>
      <Box
        {...rest}
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

function TransactionLog() {
  const { leagueId } = useParams();
  // Shared league row (the dashboard reads the same entry, so the usual hop
  // costs no request). The page waits for it before showing the filter bar,
  // as FantasyOnly does, so a pick'em league never flashes the roster-move
  // toggles; if the row cannot be loaded at all the page keeps its fantasy
  // shape, which is also what an older cached row without the flag gets.
  const { league, loading: leagueLoading } = useLeague(leagueId);
  const pickemOnly = isPickemOnly(league);
  const filterOptions = FILTER_OPTIONS.filter((opt) => !opt.fantasyOnly || !pickemOnly);
  const [transactions, setTransactions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedType, setSelectedType] = useState('all');
  // A toggle picked before the league row resolved as pick'em would vanish
  // while still filtering; the effective filter is always a visible option.
  const typeFilter = filterOptions.some((opt) => opt.value === selectedType) ? selectedType : 'all';
  const [teamFilter, setTeamFilter] = useState('all');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [decisionCardEntry, setDecisionCardEntry] = useState(null);

  useEffect(() => {
    // Filters and rows are per league: an in-place league switch (hash edit
    // between two leagues keeps this element mounted) starts clean.
    setTransactions(null);
    setSelectedType('all');
    setTeamFilter('all');
    fetchTransactions();
    // fetchTransactions closes over leagueId, which is the explicit trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [typeFilter, teamFilter]);

  const fetchTransactions = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient.get(`/api/league/${leagueId}/transactions`);
      setTransactions(res.data);
    } catch (err) {
      setError(readHttpFailure(err).message || err.message);
    } finally {
      setLoading(false);
    }
  };

  if ((loading && !transactions) || (!league && leagueLoading)) {
    return (
      <Shell data-testid="page-skeleton">
        <Skel width={220} height={48} />
        <Skel width="100%" height={44} />
        <Skel width="100%" height={320} />
      </Shell>
    );
  }

  const teamNames = transactions
    ? Array.from(new Set(transactions.map((t) => t.team_name).filter(Boolean))).sort()
    : [];

  const filtered = (transactions || []).filter((t) => {
    if (typeFilter !== 'all' && t.type !== typeFilter) return false;
    if (teamFilter !== 'all' && t.team_name !== teamFilter) return false;
    return true;
  });
  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  // Cluster consecutive same-day rows under a single date heading (assumes
  // `visible` is already ordered newest-first).
  const dayGroups = [];
  visible.forEach((t) => {
    const label = dayLabel(t.created_at);
    const lastGroup = dayGroups[dayGroups.length - 1];
    if (lastGroup && lastGroup.label === label) {
      lastGroup.items.push(t);
    } else {
      dayGroups.push({ label, items: [t] });
    }
  });

  return (
    <Shell data-testid="transaction-log">
      <Box>
        <LeagueBreadcrumb look="playselect" />
        <PixelHeading level={1}>League Activity</PixelHeading>
      </Box>
      {error && (
        <ErrorPanel
          title="League activity"
          body={error}
        />
      )}

      {transactions && (
        <>
          <Box
            sx={{
              display: 'flex',
              flexDirection: { xs: 'column', sm: 'row' },
              alignItems: { xs: 'stretch', sm: 'flex-end' },
              justifyContent: 'space-between',
              gap: '16px',
            }}
          >
            <SegmentedControl
              look="playselect"
              scrollable
              options={filterOptions}
              value={typeFilter}
              onChange={setSelectedType}
              aria-label="Filter by transaction type"
              data-testid="txn-type-filter"
            />
            <TeamSelect value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} names={teamNames} />
          </Box>

          {filtered.length === 0 ? (
            <Frame tier="rule" sx={{ p: { xs: '16px', sm: '24px' }, fontSize: '15px' }}>
              {transactions.length === 0 ? (
                // The pick'em copy promises only what can appear today: pick'em
                // season events get a transactions row only if #31's proposal 2
                // is ruled in, and the copy widens with it.
                pickemOnly
                  ? 'The league is quiet. Commissioner actions will appear here.'
                  : 'The league is quiet. Recent transactions, trades, and commissioner actions will appear here.'
              ) : 'No activity matches these filters'}
            </Frame>
          ) : (
            <Frame tier="rule" sx={{ p: { xs: '12px', sm: '20px' } }}>
              {dayGroups.map((group) => (
                <Box key={`${group.label}-${group.items[0].id}`} sx={{ mb: '12px' }}>
                  <Box
                    data-testid="day-header"
                    sx={{
                      fontSize: '14px', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ps-dim)', pb: '4px',
                    }}
                  >
                    {group.label}
                  </Box>
                  <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                    {group.items.map((txn, i) => (
                      <ActivityRow
                        key={txn.id}
                        txn={txn}
                        onOpenPlayer={setDecisionCardEntry}
                        last={i === group.items.length - 1}
                      />
                    ))}
                  </Box>
                </Box>
              ))}
              {hasMore && (
                <Box sx={{ textAlign: 'center', pt: '8px' }}>
                  <PsButton variant="ghost" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>Show more</PsButton>
                </Box>
              )}
            </Frame>
          )}
        </>
      )}

      <PlayerDecisionCard
        open={decisionCardEntry != null}
        onClose={() => setDecisionCardEntry(null)}
        entry={decisionCardEntry}
        leagueId={Number(leagueId)}
        look="playselect"
        // #1514: TransactionLog's activity segments carry only
        // { playerId, name } (plus a display-only position), no roster fact to classify by, so
        // it defers kind to the fetched card's own Availability (ADR 0040
        // ruling c) via the fromCard() builder.
        context={fromCard()}
      />
    </Shell>
  );
}

export default TransactionLog;
