import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Paper, TextField, Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import apiClient from '../../api/apiClient';
import { readHttpFailure } from '../../lib/httpFailure';
import { SCORING_PRESET_LABELS } from '../../lib/leagueRulesFormat';
import { JOIN_REFUSAL_REASON } from '../../shared/lib/leaguePhase';
import { isPickemOnly, shortLeagueTypeLabel } from '../../shared/lib/leagueType';
import { MIN_TOUCH_TARGET_SX } from '../../shared/lib/a11y';
import { useSnackbar } from '../Snackbar/SnackbarProvider';
import {
  alertSx, dialogPaperSx, dialogTitleSx, dimSx, fieldSx, ghostButtonSx, primaryButtonSx, quietButtonSx,
} from '../common/homeIslandSx';

// The preview's closed-joining note, keyed on the server's joinability reason.
// Same words as LeagueManagement's invite preview (JOIN_CLOSED_COPY there): a
// league with a fantasy side closes when its draft starts, a pick'em-only pool
// when its season is complete.
const JOIN_CLOSED_COPY = {
  [JOIN_REFUSAL_REASON.DRAFT_STARTED]: 'The draft has already started · joining is closed.',
  [JOIN_REFUSAL_REASON.SEASON_COMPLETE]: 'The season is complete · joining is closed.',
};
const ALREADY_MEMBER_COPY = "You're already a member of this league.";

// Every invite code is exactly 8 lowercase hex characters (checked against
// production 2026-09-28). Shorter is still being typed and longer is not a
// code, so only exactly 8 is ever looked up (the preview route is rate limited
// per caller).
const INVITE_CODE_LENGTH = 8;
const PREVIEW_DEBOUNCE_MS = 300;

/**
 * The invite code in whatever the manager typed or pasted: a bare code, or a
 * shared invite link (/#/league/join?code=...), whose `code` parameter is the
 * code. Lower-cased: every code is issued in lower case and the server
 * matches it exactly, so a code typed in capitals still finds its league.
 */
export function inviteCodeFrom(raw) {
  const text = (raw || '').trim();
  const match = text.match(/[?&]code=([^&#\s]*)/i);
  if (!match) return text.toLowerCase();
  let code = match[1];
  try {
    code = decodeURIComponent(code);
  } catch {
    // A malformed escape: use the parameter as it stands.
  }
  return code.trim().toLowerCase();
}

/** Whether this browser lets the page read the clipboard (it asks first). */
function canReadClipboard() {
  return typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function';
}

function formatLine(preview) {
  if (isPickemOnly(preview)) return shortLeagueTypeLabel(preview);
  const parts = [shortLeagueTypeLabel(preview)];
  if (SCORING_PRESET_LABELS[preview.scoringPreset]) parts.push(SCORING_PRESET_LABELS[preview.scoringPreset]);
  if (preview.bestBall) parts.push('Best ball');
  if (preview.pickemEnabled) parts.push("Pick'em on");
  return parts.join(' · ');
}

function draftDayLabel(draftDate) {
  const date = draftDate ? new Date(draftDate) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Why this manager cannot join the previewed league, or null when they can. */
function refusalFor(preview) {
  if (!preview) return null;
  if (preview.alreadyMember) return ALREADY_MEMBER_COPY;
  if (preview.joinable === false) return JOIN_CLOSED_COPY[preview.joinReason] || 'This league is not taking new teams.';
  return null;
}

/**
 * Join a league by invite code, with a read-only preview of the league the
 * code points at (GET /api/league/preview?code=, the same debounced lookup
 * LeagueManagement runs) shown before the Team name is asked for.
 *
 * Owns its answers, its error and its in-flight flag. The answers survive a
 * close (and a failed join); a successful join clears them, announces itself
 * once through the snackbar and calls `onJoined` so the page can refetch.
 */
export default function JoinLeagueDialog({ open, onClose, onJoined }) {
  const notify = useSnackbar();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  // The raw input is stored and shown as typed; the code read from it is
  // lower-cased, so the field never shows a case the server would refuse.
  const [rawCode, setRawCode] = useState('');
  const [clipboardFailed, setClipboardFailed] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [joinError, setJoinError] = useState(null);
  const [joining, setJoining] = useState(false);
  // { code, status: 'found' | 'not-found', league } for the last answered
  // lookup, or null. A lookup that failed for any reason but a 404 leaves
  // nothing: a failed preview never blocks the Join button.
  const [lookup, setLookup] = useState(null);

  const inviteCode = inviteCodeFrom(rawCode);
  const trimmedTeamName = teamName.trim();

  useEffect(() => {
    if (inviteCode.length !== INVITE_CODE_LENGTH) {
      setLookup(null);
      return undefined;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const response = await apiClient.get(`/api/league/preview?code=${encodeURIComponent(inviteCode)}`);
        const league = response.data && response.data.id ? response.data : null;
        if (!cancelled) setLookup(league ? { code: inviteCode, status: 'found', league } : null);
      } catch (err) {
        if (cancelled) return;
        setLookup(readHttpFailure(err).status === 404 ? { code: inviteCode, status: 'not-found' } : null);
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [inviteCode]);

  // Only an answer for the code currently in the field counts.
  const current = lookup && lookup.code === inviteCode ? lookup : null;
  const preview = current && current.status === 'found' ? current.league : null;
  const notFound = Boolean(current && current.status === 'not-found');
  const keepTyping = inviteCode.length > 0 && inviteCode.length < INVITE_CODE_LENGTH;
  const tooLong = inviteCode.length > INVITE_CODE_LENGTH;
  const refusal = refusalFor(preview);

  // A disabled button alone doesn't say why (WCAG 3.3.2), so the reason is
  // spelled out and tied to it with aria-describedby.
  // A refusal is already worded on the preview card, so the button points at
  // that note instead of repeating it.
  const missingAnswers = !inviteCode || !trimmedTeamName;
  let joinBlockerId;
  if (refusal) joinBlockerId = 'join-league-refusal';
  else if (missingAnswers) joinBlockerId = 'join-league-blocker';

  const handleClose = () => {
    setJoinError(null);
    onClose();
  };

  const handleCodeChange = (text) => {
    setClipboardFailed(false);
    setRawCode(text);
  };

  // A pasted link is read for its code exactly as a typed one is.
  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      handleCodeChange((text || '').trim());
    } catch {
      // Permission refused or nothing readable: the field still takes a paste.
      setClipboardFailed(true);
    }
  };

  const handleJoin = async () => {
    if (joining || joinBlockerId) return;
    setJoinError(null);
    setJoining(true);
    try {
      await apiClient.post('/api/league/join', { inviteCode, teamName: trimmedTeamName });
      // The snackbar is the one success announcement; the page adds none.
      notify('Joined league!');
      setRawCode('');
      setTeamName('');
      setLookup(null);
      handleClose();
      if (onJoined) onJoined();
    } catch (err) {
      setJoinError(readHttpFailure(err).message || err.message);
    } finally {
      setJoining(false);
    }
  };

  let joinLabel = 'Join league';
  if (joining) joinLabel = 'Joining…';
  else if (preview) joinLabel = `Join ${preview.name}`;

  const draftDay = preview ? draftDayLabel(preview.draftDate) : null;

  // On a phone the sheet is full screen, so it IS the page: it paints
  // `dash-bg`, and every pairing in it (the not-found alert, a field error,
  // the Cancel link) is registered over the page as well as over a card.
  // Inputs keep a `dash-surface` fill in both, with the `dash-field` edge.
  const sheet = fullScreen ? 'var(--dash-bg)' : 'var(--dash-surface)';
  const inputSx = fieldSx('var(--dash-surface)');

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullScreen={fullScreen}
      className="dialogContainer"
      aria-labelledby="join-league-title"
      PaperProps={{ sx: dialogPaperSx(sheet, { fullScreen }) }}
    >
      <DialogTitle id="join-league-title" className="dialogTitle" sx={dialogTitleSx}>Join a league</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ ...dimSx, fontSize: '15px', mb: 1 }}>
          Your commissioner sends an invite code or link. Leagues are private, so you need one to join.
        </Typography>
        {joinError && <Alert severity="error" sx={{ ...alertSx('danger'), mb: 1 }}>{joinError}</Alert>}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', columnGap: 1 }}>
          <TextField
            className="dialogTextField"
            autoFocus
            margin="dense"
            label="Invite code"
            required
            sx={{
              ...inputSx,
              flex: '1 1 12rem',
              '& .MuiInputBase-input': { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontWeight: 600, letterSpacing: '0.1em' },
            }}
            value={rawCode}
            onChange={(event) => handleCodeChange(event.target.value)}
            error={notFound || tooLong}
            // The keyboard must not re-case what is typed; the code read from
            // it is lower-cased before it reaches the server.
            inputProps={{
              autoComplete: 'off',
              autoCapitalize: 'none',
              spellCheck: false,
              'aria-describedby': 'join-code-status',
            }}
          />
          {canReadClipboard() && (
            <Button
              onClick={handlePasteFromClipboard}
              sx={{ ...ghostButtonSx, ...MIN_TOUCH_TARGET_SX, px: 2, mt: 1, minHeight: 56, whiteSpace: 'nowrap' }}
            >
              Paste from clipboard
            </Button>
          )}
        </Box>
        {/* One polite live region for what the code resolves to. */}
        <Box id="join-code-status" aria-live="polite" sx={{ my: 1 }}>
          {keepTyping && (
            <Typography variant="body2" sx={dimSx}>
              Keep typing. Invite codes are 8 letters and numbers.
            </Typography>
          )}
          {tooLong && (
            <Typography variant="body2" sx={dimSx}>
              That&apos;s longer than an invite code. Invite codes are 8 letters and numbers.
            </Typography>
          )}
          {clipboardFailed && (
            <Typography variant="body2" sx={dimSx}>
              Couldn&apos;t read the clipboard. Paste the code or link into the field instead.
            </Typography>
          )}
          {/* Danger title and ink body on the danger tint, over the sheet
              (the page on a phone, a card otherwise): both registered. */}
          {notFound && (
            <Paper
              variant="outlined"
              sx={{
                px: 2,
                py: 1.5,
                backgroundColor: 'var(--dash-danger-soft)',
                backgroundImage: 'none',
                border: '1px solid var(--dash-danger)',
                borderRadius: 'var(--dash-radius)',
                color: 'var(--dash-ink)',
              }}
            >
              <Typography variant="body2" component="p" sx={{ color: 'var(--dash-danger)', fontSize: '15px', fontWeight: 600 }}>No league uses that code</Typography>
              <Typography variant="body2" component="p" sx={{ color: 'var(--dash-ink)', fontSize: '14px' }}>
                Check for a mix-up like 0 and O, or ask your commissioner for a fresh link.
              </Typography>
            </Paper>
          )}
          {preview && (
            <Paper
              variant="outlined"
              data-testid="join-preview"
              // A card (`dash-surface`) wherever the sheet is, with the
              // board's 2px accent edge (warning when it can't be joined).
              sx={{
                p: 2,
                backgroundColor: 'var(--dash-surface)',
                backgroundImage: 'none',
                color: 'var(--dash-ink)',
                borderRadius: 'var(--dash-radius)',
                border: `2px solid ${refusal ? 'var(--dash-warning)' : 'var(--dash-accent)'}`,
              }}
            >
              <Typography variant="subtitle1" component="p" sx={{ fontSize: '17px', fontWeight: 600 }}>{preview.name}</Typography>
              {/* One fact per element (#209), so a screen reader announces
                  each on its own. The commissioner is named by Team, never
                  by account (CONTEXT.md Team identity). */}
              <Typography variant="body2" sx={dimSx}>{formatLine(preview)}</Typography>
              <Typography variant="body2" sx={dimSx}>
                {`${preview.teamCount} of ${preview.maxTeams} seats taken`}
              </Typography>
              {draftDay && (
                <Typography variant="body2" sx={dimSx}>{`Draft ${draftDay}`}</Typography>
              )}
              {preview.ownerTeamName && (
                <Typography variant="body2" sx={dimSx}>{`Run by ${preview.ownerTeamName}`}</Typography>
              )}
              {refusal && (
                <Typography id="join-league-refusal" variant="body2" sx={{ color: 'var(--dash-warning)', mt: 0.5, fontWeight: 600 }}>
                  {refusal}
                </Typography>
              )}
            </Paper>
          )}
        </Box>
        <TextField
          className="dialogTextField"
          margin="dense"
          label="Team name"
          fullWidth
          required
          inputProps={{ maxLength: 120 }}
          helperText="Your Team's identity in this league. Other managers never see your account email or username."
          sx={inputSx}
          value={teamName}
          onChange={(event) => setTeamName(event.target.value)}
        />
      </DialogContent>
      <DialogActions>
        {!refusal && missingAnswers && (
          <Typography id="join-league-blocker" variant="body2" sx={{ ...dimSx, mr: 'auto', pl: 1 }}>
            {/* The first unmet answer only, so a filled field is never asked for again. */}
            {inviteCode ? 'Add your Team name to continue.' : 'Add the invite code to continue.'}
          </Typography>
        )}
        <Button onClick={handleClose} color="primary" sx={{ ...quietButtonSx, ...MIN_TOUCH_TARGET_SX, px: 2 }}>
          Cancel
        </Button>
        <Button
          onClick={handleJoin}
          color="primary"
          variant="contained"
          sx={{ ...primaryButtonSx, ...MIN_TOUCH_TARGET_SX, px: 2.5 }}
          aria-describedby={joinBlockerId}
          disabled={joining || Boolean(joinBlockerId)}
        >
          {joinLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
