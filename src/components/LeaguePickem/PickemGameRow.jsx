import React from 'react';
import {
  Box,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';

function kickoffLabel(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * One game on the week's board.
 *
 * The two teams come from `game.teams` (sorted, and the only values the server
 * will accept as a pick). When live_game_states has told us who is at home the
 * buttons are re-ordered to the familiar AWAY @ HOME reading order; on a future
 * week that data doesn't exist yet, so the game renders as a plain "A vs B"
 * rather than not rendering at all.
 */
export default function PickemGameRow({
  game,
  pick,
  mode,
  slateSize,
  confidenceOwners,
  othersPicks = [],
  flagged = false,
  onPick,
  onConfidence,
}) {
  const ordered =
    game.awayTeam && game.homeTeam ? [game.awayTeam, game.homeTeam] : game.teams;
  const picked = pick ? pick.pickedTeam : null;
  const confidence = pick && pick.confidence != null ? pick.confidence : '';
  const played = game.status !== 'scheduled' && game.homeTeam && game.awayTeam;
  const decided = Boolean(game.winner) || Boolean(game.isTie);

  let outcomeIcon = null;
  if (decided && picked) {
    outcomeIcon = game.isTie ? null : game.winner === picked
      ? <CheckCircleIcon color="success" fontSize="small" aria-label="Correct pick" />
      : <CancelIcon color="error" fontSize="small" aria-label="Missed pick" />;
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        mb: 1.5,
        borderColor: flagged ? 'error.main' : 'divider',
        borderWidth: flagged ? 2 : 1,
      }}
    >
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        alignItems={{ xs: 'stretch', md: 'center' }}
        justifyContent="space-between"
      >
        <Box sx={{ minWidth: 160 }}>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Typography variant="body2" color="text.secondary">
              {kickoffLabel(game.kickoffAt)}
            </Typography>
            {game.locked && (
              <LockIcon fontSize="inherit" color="disabled" aria-label="Picks locked" />
            )}
          </Stack>
          {played && (
            <Typography variant="body2" color="text.secondary">
              {`${game.awayTeam} ${game.awayScore} - ${game.homeTeam} ${game.homeScore}`}
              {game.quarter ? ` · ${game.quarter}` : ''}
              {game.timeRemaining ? ` ${game.timeRemaining}` : ''}
            </Typography>
          )}
        </Box>

        <ToggleButtonGroup
          exclusive
          size="small"
          value={picked}
          aria-label={`Pick a winner for ${ordered.join(game.awayTeam && game.homeTeam ? ' at ' : ' vs ')}`}
          onChange={(event, value) => {
            if (value) onPick(game.gameKey, value);
          }}
        >
          {ordered.map((team) => (
            <ToggleButton key={team} value={team} disabled={game.locked} aria-label={team}>
              {team}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          {mode === 'confidence' && (
            // Confidence ranks a pick, so it has nothing to attach to until a
            // team is chosen — disabled with an explanation beats a silent no-op.
            <Tooltip title={!picked && !game.locked ? 'Pick a team first' : ''}>
              <FormControl size="small" sx={{ minWidth: 120 }} disabled={game.locked || !picked}>
                <InputLabel id={`pickem-confidence-${game.gameKey}`}>Confidence</InputLabel>
                <Select
                  labelId={`pickem-confidence-${game.gameKey}`}
                  label="Confidence"
                  value={confidence}
                  onChange={(event) => onConfidence(game.gameKey, event.target.value)}
                >
                  <MenuItem value="">
                    <em>None</em>
                  </MenuItem>
                  {Array.from({ length: slateSize }, (unused, index) => index + 1).map((value) => {
                    const owner = confidenceOwners ? confidenceOwners.get(value) : undefined;
                    return (
                      <MenuItem key={value} value={value} disabled={owner && owner !== game.gameKey}>
                        {value}
                      </MenuItem>
                    );
                  })}
                </Select>
              </FormControl>
            </Tooltip>
          )}
          {outcomeIcon}
          {game.locked && !picked && (
            <Chip size="small" variant="outlined" label="No pick" />
          )}
          {game.isTie && <Chip size="small" label="Tie: no credit" />}
          {game.winner && (
            <Chip size="small" color="success" variant="outlined" label={`${game.winner} won`} />
          )}
        </Stack>
      </Stack>

      {othersPicks.length > 0 && (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
            League picks:
          </Typography>
          {othersPicks.map((other) => (
            <Chip
              key={other.userId}
              size="small"
              variant="outlined"
              label={
                other.confidence != null
                  ? `${other.username}: ${other.pickedTeam} (${other.confidence})`
                  : `${other.username}: ${other.pickedTeam}`
              }
            />
          ))}
        </Stack>
      )}
    </Paper>
  );
}
