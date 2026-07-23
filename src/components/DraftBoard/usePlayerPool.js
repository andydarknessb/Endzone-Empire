import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import apiClient from '../../api/apiClient';

/**
 * Owns the draft board's available-players pool: filters (position/search/
 * sort/dir/hide-drafted), their mirroring into the URL so a refresh restores
 * them, and fetching. Pages are fetched server-side (25 at a time) but
 * appended into one growing list — `loadMore()` fetches the next page for a
 * windowed/infinite-scroll pool instead of the old page-by-page UI.
 */
export default function usePlayerPool(leagueId) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [positionFilter, setPositionFilter] = useState(() => searchParams.get('pos') || 'All');
  const [searchInput, setSearchInput] = useState(() => searchParams.get('q') || '');
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [sort, setSort] = useState(() => searchParams.get('sort') || 'adp');
  const [dir, setDir] = useState(() => searchParams.get('dir') || 'asc');
  const [hideDrafted, setHideDrafted] = useState(() => searchParams.get('showDrafted') !== '1');

  const [availablePlayers, setAvailablePlayers] = useState([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  // Only the very first fetch toggles this — later refetches (filter/sort
  // changes, a pick landing) swap the list in place without re-showing the
  // full-page skeleton. `loadingMore` covers the append-on-scroll fetches.
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

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

        const res = await apiClient.get('/api/players', { params });
        if (seq !== requestSeqRef.current) return; // superseded by a newer request
        setAvailablePlayers((prev) => (append ? [...prev, ...res.data.players] : res.data.players));
        setTotalPages(res.data.totalPages);
        setPage(pageNum);
        setError(null);
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        setError(err.response?.data?.error || err.message);
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
    [leagueId, sort, dir, hideDrafted, positionFilter, search]
  );

  // Initial load. Intentionally excludes fetchPage (identity changes with
  // every filter) — this should only re-run when the league itself changes.
  useEffect(() => {
    fetchPage(0);
  }, [leagueId]);

  // Debounce the search box (avoid a request per keystroke).
  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Refetch the available list from page 1 when the committed search term,
  // sort, direction, or the hide-drafted toggle changes. Skips the initial
  // mount, where the load-on-mount effect above already covers page 1.
  // Deliberately excludes positionFilter/fetchPage — a position change goes
  // through handlePositionFilterChange's direct fetch instead, so it isn't
  // double-fetched here.
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    fetchPage(0);
  }, [search, sort, dir, hideDrafted]);

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
      return next;
    }, { replace: true });
  }, [positionFilter, search, sort, dir, hideDrafted, setSearchParams]);

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

  const hasMore = totalPages > 0 && page + 1 < totalPages;

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    fetchPage(page + 1, { append: true });
  }, [loading, loadingMore, hasMore, page, fetchPage]);

  const refetch = useCallback(() => fetchPage(0), [fetchPage]);

  return {
    availablePlayers,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    error,
    refetch,
    positionFilter,
    handlePositionFilterChange,
    searchInput,
    setSearchInput,
    search,
    sort,
    dir,
    handleSort,
    hideDrafted,
    setHideDrafted,
  };
}
