import React, { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { Autocomplete, TextField, Box, CircularProgress } from '@mui/material';
import apiClient from '../../api/apiClient';
import PositionChip from '../PlayerQuickView/PositionChip';

// The quick view is a heavy dialog (player summary, stats, projections) that
// only matters once a result is picked; this search sits in the always-mounted
// AppBar, so the dialog is fetched on first open rather than shipped in the
// initial bundle.
const PlayerQuickView = lazy(() => import('../PlayerQuickView/PlayerQuickView'));

// Don't hijack "/" while the user is typing somewhere.
function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return el.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * App-wide player search. Debounces against the players search API and opens
 * the shared PlayerQuickView on select. Rendered in the AppBar (desktop) and
 * the nav drawer (mobile). Pass `enableShortcut` on the always-mounted desktop
 * instance so "/" focuses it from anywhere.
 */
function GlobalPlayerSearch({ inDrawer = false, enableShortcut = false }) {
  const [input, setInput] = useState('');
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [quickViewId, setQuickViewId] = useState(null);
  // Once the dialog has been opened it stays mounted (closed) like any MUI
  // Dialog, so its close transition still plays; only the first open fetches it.
  const [quickViewMounted, setQuickViewMounted] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    const q = input.trim();
    if (!q) {
      setOptions([]);
      setLoading(false);
      return undefined;
    }
    let active = true;
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await apiClient.get('/api/players', { params: { search: q, page: 1 } });
        if (active) setOptions(res.data.players || []);
      } catch (err) {
        if (active) setOptions([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [input]);

  useEffect(() => {
    if (!enableShortcut) return undefined;
    const onKey = (e) => {
      if (e.key === '/' && !isTypingTarget(e.target)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enableShortcut]);

  return (
    <>
      <Autocomplete
        size="small"
        options={options}
        loading={loading}
        includeInputInList
        filterOptions={(x) => x} // results are already server-filtered
        getOptionLabel={(o) => o.name || ''}
        isOptionEqualToValue={(o, v) => o.id === v.id}
        noOptionsText={input.trim() ? 'No players found' : 'Type to search players'}
        onInputChange={(e, value, reason) => {
          if (reason !== 'reset') setInput(value);
        }}
        value={null}
        blurOnSelect
        clearOnBlur
        onChange={(e, value) => {
          if (value) {
            setQuickViewMounted(true);
            setQuickViewId(value.id);
            setInput('');
          }
        }}
        renderOption={(props, option) => (
          <Box component="li" {...props} key={option.id} sx={{ gap: 1 }}>
            <PositionChip position={option.position} />
            <Box component="span" sx={{ fontWeight: 600 }}>{option.name}</Box>
            <Box component="span" sx={{ color: 'text.secondary', ml: 'auto' }}>
              {option.nfl_team}
            </Box>
          </Box>
        )}
        renderInput={(params) => (
          <TextField
            {...params}
            inputRef={inputRef}
            placeholder="Search players..."
            inputProps={{ ...params.inputProps, 'aria-label': 'Search players' }}
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {loading && <CircularProgress color="inherit" size={16} />}
                  {!loading && enableShortcut && !input && (
                    <Box
                      component="kbd"
                      aria-hidden="true"
                      sx={{
                        px: 0.6,
                        py: 0.1,
                        fontSize: 12,
                        lineHeight: 1.6,
                        fontFamily: 'inherit',
                        color: 'text.secondary',
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        bgcolor: 'action.hover',
                      }}
                    >
                      /
                    </Box>
                  )}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
          />
        )}
        sx={{ width: inDrawer ? '100%' : { xs: 160, md: 240 } }}
      />
      {quickViewMounted && (
        <Suspense fallback={null}>
          <PlayerQuickView
            open={quickViewId != null}
            onClose={() => setQuickViewId(null)}
            playerId={quickViewId}
          />
        </Suspense>
      )}
    </>
  );
}

export default GlobalPlayerSearch;
