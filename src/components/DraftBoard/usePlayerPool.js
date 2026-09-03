import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import apiClient from '../../api/apiClient';
import { SORT_KEYS } from './sortFields';

/** Parses the `byes` URL param (comma-separated week numbers) into a sorted,
 * deduped array of finite integers — anything unparsable is dropped rather
 * than surfaced as an error, since it's just restoring a bookmarked filter. */
function parseByeWeeksParam(raw) {
  if (!raw) return [];
  return [...new Set(raw.split(',').map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
}

/** A bogus or legacy `?sort=` value (hand-edited, an old field name that no
 * longer exists) falls back to the hook's own default rather than being kept
 * in state, mirrored back into the URL, and sent to the API verbatim - the
 * one place this is validated, so every consumer of `sort` downstream (the
 * desktop table's active-column check, the mobile Sort-by Select) can trust
 * it always names a real field. */
function parseSortParam(raw) {
  return SORT_KEYS.includes(raw) ? raw : 'adp';
}

/**
 * Owns the draft board's available-players pool: filters (position/search/
 * sort/dir/hide-drafted/bye-weeks), their mirroring into the URL so a refresh
 * restores them, and fetching. Pages are fetched server-side (25 at a time)
 * but appended into one growing list — `loadMore()` fetches the next page for
 * a windowed/infinite-scroll pool instead of the old page-by-page UI.
 */
export default function usePlayerPool(leagueId) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [positionFilter, setPositionFilter] = useState(() => searchParams.get('pos') || 'All');
  const [searchInput, setSearchInput] = useState(() => searchParams.get('q') || '');
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [sort, setSort] = useState(() => parseSortParam(searchParams.get('sort')));
  const [dir, setDir] = useState(() => searchParams.get('dir') || 'asc');
  const [hideDrafted, setHideDrafted] = useState(() => searchParams.get('showDrafted') !== '1');
  const [byeWeeksFilter, setByeWeeksFilter] = useState(() => parseByeWeeksParam(searchParams.get('byes')));

  const [availablePlayers, setAvailablePlayers] = useState([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  // Only the very first fetch toggles this — later refetches (filter/sort
  // changes, a pick landing) swap the list in place without re-showing the
  // full-page skeleton. `loadingMore` covers the append-on-scroll fetches.
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const didMountRef = useRef(false);
  const hasLoadedOnceRef = useRef(false);
  // Bumped on every fetch so a slow, superseded request can't clobber a
  // later one's result (e.g. rapid filter changes).
  const requestSeqRef = useRef(0);

  const fetchPage = useCallback(
    async (pageNum, { append = false, positionOverride, searchOverride } = {}) => {
      const seq = ++requestSeqRef.current;
      if (append) setLoadingMore(true);
      try {
        const params = {
          page: pageNum + 1,
          leagueId: Number(leagueId),
          // Keep the compact UI/URL key while using the server's global
          // projection sort across every page.
          sort: sort === 'proj' ? 'projected_points' : sort,
        };
        // "Hide drafted" (default) keeps the board to available players only.
        if (hideDrafted) params.available = true;
        if (dir === 'desc') params.dir = 'desc';
        const positionValue = positionOverride !== undefined ? positionOverride : positionFilter;
        if (positionValue !== 'All') params.position = positionValue;
        const searchValue = searchOverride !== undefined ? searchOverride : search;
        if (searchValue) params.search = searchValue;
        if (byeWeeksFilter.length > 0) params.byeWeeks = byeWeeksFilter.join(',');

        const res = await apiClient.get('/api/players', { params });
        if (seq !== requestSeqRef.current) return; // superseded by a newer request
        setAvailablePlayers((prev) => (append ? [...prev, ...res.data.players] : res.data.players));
        setTotalPages(res.data.totalPages);
        setPage(pageNum);
      } catch {
        // A fetch failure is swallowed: the pool has never surfaced one to the
        // room (the old `error` state was returned but read nowhere), and the
        // `finally` below already re-checks the sequence before it clears any
        // flag, so a superseded request's reject can't affect a live one.
      } finally {
        if (seq === requestSeqRef.current) {
          if (append) setLoadingMore(false);
          if (!hasLoadedOnceRef.current) {
            hasLoadedOnceRef.current = true;
            setLoading(false);
          }
        }
      }
    },
    [leagueId, sort, dir, hideDrafted, positionFilter, search, byeWeeksFilter]
  );

  // Initial load. Intentionally excludes fetchPage (identity changes with
  // every filter) — this should only re-run when the league itself changes.
  useEffect(() => {
    fetchPage(0);
    // Initial league load is separate from the filter-driven refetch below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  // Debounce the search box (avoid a request per keystroke).
  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Refetch the available list from page 1 when the committed search term,
  // sort, direction, hide-drafted toggle, or Bye-weeks filter changes. Skips
  // the initial mount, where the load-on-mount effect above already covers
  // page 1. Deliberately excludes positionFilter/fetchPage — a position
  // change goes through handlePositionFilterChange's direct fetch instead, so
  // it isn't double-fetched here.
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    fetchPage(0);
    // Position changes fetch directly; including fetchPage would double-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, sort, dir, hideDrafted, byeWeeksFilter]);

  // Mirror the table state into the URL so a refresh restores it (replace, so
  // we don't flood history during a live draft). Built off the previous
  // params (functional updater) rather than from scratch, so unrelated keys
  // set elsewhere (e.g. the board/pool view tab) survive a filter change.
  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (positionFilter !== 'All') next.set('pos', positionFilter);
      else next.delete('pos');
      if (search) next.set('q', search);
      else next.delete('q');
      if (sort !== 'adp') next.set('sort', sort);
      else next.delete('sort');
      if (dir !== 'asc') next.set('dir', dir);
      else next.delete('dir');
      if (!hideDrafted) next.set('showDrafted', '1');
      else next.delete('showDrafted');
      if (byeWeeksFilter.length > 0) next.set('byes', byeWeeksFilter.join(','));
      else next.delete('byes');
      return next;
    }, { replace: true });
  }, [positionFilter, search, sort, dir, hideDrafted, byeWeeksFilter, setSearchParams]);

  const handleSort = (key) => {
    if (sort === key) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(key);
      setDir('asc');
    }
  };

  const handlePositionFilterChange = (newPosition) => {
    setPositionFilter(newPosition);
    fetchPage(0, { positionOverride: newPosition });
  };

  // Selected values arrive from MUI's multi-select Select as whatever was
  // passed to `value` on the changed MenuItem (already numbers here, since
  // BYE_WEEK_OPTIONS is numeric) — deduped/sorted so the URL and removable
  // chips render in a stable order regardless of selection order.
  const handleByeWeeksFilterChange = (weeks) => {
    setByeWeeksFilter([...new Set(weeks.map(Number))].sort((a, b) => a - b));
  };

  const hasMore = totalPages > 0 && page + 1 < totalPages;

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    fetchPage(page + 1, { append: true });
  }, [loading, loadingMore, hasMore, page, fetchPage]);

  const refetch = useCallback(() => fetchPage(0), [fetchPage]);

  // The room reads exactly three things off this hook - the available list,
  // the first-load flag, and the refetch seam a landed Pick calls. Everything
  // the pool table's own controls need (filters, sort, search, paging) rides in
  // one `controls` object the room threads straight through without reading
  // (issue #792 ruling 1): the interface stops being as wide as the
  // implementation, and adding a filter no longer touches this return, the
  // room, or the table's signature.
  const controls = {
    searchInput,
    setSearchInput,
    search,
    positionFilter,
    onPositionFilterChange: handlePositionFilterChange,
    hideDrafted,
    setHideDrafted,
    byeWeeksFilter,
    onByeWeeksFilterChange: handleByeWeeksFilterChange,
    sort,
    dir,
    onSort: handleSort,
    hasMore,
    loadingMore,
    loadMore,
  };

  return {
    availablePlayers,
    loading,
    refetch,
    controls,
  };
}
