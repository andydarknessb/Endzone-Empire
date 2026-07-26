import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import PickemGameRow from './PickemGameRow';

/** The Save control with its counter — rendered at the top always, and again in
 * a sticky footer while there are unsaved changes, so the sixteenth game of a
 * phone-length board never strands the user a full scroll from saving. */
function SaveBar({ madeOpen, openCount, dirty, saving, onSave, mode }) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1.5}
      alignItems={{ xs: 'stretch', sm: 'center' }}
      justifyContent="space-between"
    >
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Chip size="small" label={mode === 'confidence' ? 'Confidence points' : 'Straight up'} />
        <Typography variant="body2" color="text.secondary">
          {`${madeOpen} of ${openCount} open game${openCount === 1 ? '' : 's'} picked`}
        </Typography>
        {dirty && <Chip size="small" color="warning" label="Unsaved changes" />}
      </Stack>
      <Button variant="contained" onClick={onSave} disabled={saving || !dirty}>
        {saving ? 'Saving…' : 'Save picks'}
      </Button>
    </Stack>
  );
}

const pickMapFrom = (picks) => {
  const map = new Map();
  for (const pick of picks || []) {
    map.set(pick.gameKey, { pickedTeam: pick.pickedTeam, confidence: pick.confidence ?? null });
  }
  return map;
};

const sameMap = (a, b) => {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    const other = b.get(key);
    if (!other) return false;
    if (other.pickedTeam !== value.pickedTeam) return false;
    if ((other.confidence ?? null) !== (value.confidence ?? null)) return false;
  }
  return true;
};

/**
 * The editable week board. Picks are held locally and written with an explicit
 * Save, so a manager can rank a whole confidence week before committing to any
 * of it; the server takes the batch all-or-nothing.
 *
 * Only UNLOCKED games are submitted. Locked picks stay in the payload's blind
 * spot on purpose — the server already refuses to change them, and it uses the
 * confidences it still holds for them when checking this batch for duplicates.
 */
export default function PickemWeekBoard({ view, saving, saveError, onSave, onDirtyChange }) {
  const games = useMemo(() => view.games || [], [view.games]);
  const serverPicks = useMemo(() => pickMapFrom(view.myPicks), [view.myPicks]);
  const [picks, setPicks] = useState(serverPicks);

  useEffect(() => {
    setPicks(pickMapFrom(view.myPicks));
  }, [view.myPicks]);

  const lockedKeys = useMemo(
    () => new Set(games.filter((game) => game.locked).map((game) => game.gameKey)),
    [games]
  );
  const openGames = games.filter((game) => !game.locked);

  // Which game currently owns each confidence value, so the Select can grey
  // out a number that's already spoken for (including by a locked game).
  const confidenceOwners = useMemo(() => {
    const owners = new Map();
    for (const [gameKey, pick] of picks) {
      if (pick.confidence != null) owners.set(Number(pick.confidence), gameKey);
    }
    return owners;
  }, [picks]);

  const dirty = !sameMap(picks, serverPicks);
  const flagged = new Set(saveError && saveError.gameKeys ? saveError.gameKeys : []);

  // Tell the page about unsaved work so week/tab navigation can ask before
  // discarding it — this local map is the only copy of an unsaved pick.
  useEffect(() => {
    if (onDirtyChange) onDirtyChange(dirty);
    return () => { if (onDirtyChange) onDirtyChange(false); };
  }, [dirty, onDirtyChange]);

  const setPick = (gameKey, pickedTeam) => {
    setPicks((current) => {
      const next = new Map(current);
      const existing = next.get(gameKey);
      next.set(gameKey, { pickedTeam, confidence: existing ? existing.confidence : null });
      return next;
    });
  };

  const setConfidence = (gameKey, value) => {
    setPicks((current) => {
      const next = new Map(current);
      const existing = next.get(gameKey);
      if (!existing) return current; // pick a team first — confidence has nothing to rank
      next.set(gameKey, {
        ...existing,
        confidence: value === '' || value == null ? null : Number(value),
      });
      return next;
    });
  };

  const handleSave = () => {
    const payload = [];
    for (const [gameKey, pick] of picks) {
      if (lockedKeys.has(gameKey) || !pick.pickedTeam) continue;
      payload.push({
        gameKey,
        pickedTeam: pick.pickedTeam,
        ...(view.mode === 'confidence' ? { confidence: pick.confidence } : {}),
      });
    }
    onSave(payload);
  };

  const madeOpen = openGames.filter((game) => picks.get(game.gameKey)).length;

  if (games.length === 0) {
    return (
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>No games scheduled</Typography>
        <Typography variant="body2" color="text.secondary">
          The NFL schedule for this week hasn&apos;t been synced yet. Check back once it lands.
        </Typography>
      </Paper>
    );
  }

  const allLocked = openGames.length === 0;

  return (
    <Box>
      <Box sx={{ mb: 2 }}>
        {allLocked ? (
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              label={view.mode === 'confidence' ? 'Confidence points' : 'Straight up'}
            />
            <Typography variant="body2" color="text.secondary">
              All games this week have kicked off — picks are locked.
            </Typography>
          </Stack>
        ) : (
          <SaveBar
            madeOpen={madeOpen}
            openCount={openGames.length}
            dirty={dirty}
            saving={saving}
            onSave={handleSave}
            mode={view.mode}
          />
        )}
      </Box>

      {saveError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {saveError.message}
          {saveError.gameKeys && saveError.gameKeys.length > 0
            ? ` (${saveError.gameKeys.join(', ')})`
            : ''}
        </Alert>
      )}

      {games.map((game) => (
        <PickemGameRow
          key={game.gameKey}
          game={game}
          pick={picks.get(game.gameKey)}
          mode={view.mode}
          slateSize={games.length}
          confidenceOwners={confidenceOwners}
          othersPicks={(view.othersPicks && view.othersPicks[game.gameKey]) || []}
          flagged={flagged.has(game.gameKey)}
          onPick={setPick}
          onConfidence={setConfidence}
        />
      ))}

      {dirty && !allLocked && (
        <Paper
          elevation={4}
          sx={{ position: 'sticky', bottom: 8, p: 1.5, mt: 2, zIndex: 2 }}
        >
          <SaveBar
            madeOpen={madeOpen}
            openCount={openGames.length}
            dirty={dirty}
            saving={saving}
            onSave={handleSave}
            mode={view.mode}
          />
        </Paper>
      )}
    </Box>
  );
}
