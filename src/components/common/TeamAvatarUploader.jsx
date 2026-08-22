import React, { useEffect, useRef, useState } from 'react';
import {
  Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, IconButton, Typography,
} from '@mui/material';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import CloseIcon from '@mui/icons-material/Close';
import TeamAvatar from './TeamAvatar';
import apiClient from '../../api/apiClient';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Upload/replace/remove affordance for a team's avatar, built around
 * TeamAvatar. Client-side checks (type, size) give instant feedback before
 * the file ever leaves the browser; the server re-validates by content
 * regardless (see avatar.service.js) since a client check is only a UX
 * nicety, never the real gate.
 *
 * No client-side cropping — the server normalizes static images to a square
 * crop, and a canvas-based cropper would break animated GIFs.
 *
 * Two modes:
 * - Default (immediate): picking a file uploads it right away and calls
 *   `onUpdated` with the saved team.
 * - Deferred: when `onStageChange` is provided, picking a file (or removing)
 *   only stages the change — it reports `{ file }` / `{ remove: true }` (or
 *   `null` when nothing is staged) to the parent, which performs the actual
 *   POST/DELETE on its own submit. The local preview persists so the staged
 *   image is visible until the parent commits. Used by ProfileSettingsModal so
 *   a single submit button saves the name and/or avatar together.
 */
function TeamAvatarUploader({ teamId, teamName, avatarUrl, avatarStaticUrl, onUpdated, onStageChange, size = 64 }) {
  const deferred = typeof onStageChange === 'function';
  const fileInputRef = useRef(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [stagedRemove, setStagedRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);

  // In deferred mode the object URL lives until the component unmounts (parent
  // remounts it via a key bump after a successful save), so revoke it then to
  // avoid leaking.
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const handlePick = () => fileInputRef.current?.click();

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file next time
    if (!file) return;

    setError(null);
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Must be a PNG, JPEG, WEBP, or GIF image');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('File too large (max 5MB)');
      return;
    }

    const localPreview = URL.createObjectURL(file);

    if (deferred) {
      // Stage only — the parent uploads on submit. Keep the preview visible.
      setPreviewUrl(localPreview);
      setStagedRemove(false);
      onStageChange({ file });
      return;
    }

    setPreviewUrl(localPreview);
    setBusy(true);
    setProgress(0);
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      const response = await apiClient.post(`/api/team/${teamId}/avatar`, formData, {
        onUploadProgress: (evt) => {
          if (evt.total) setProgress(Math.round((evt.loaded / evt.total) * 100));
        },
      });
      onUpdated?.(response.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      URL.revokeObjectURL(localPreview);
      setPreviewUrl(null);
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    setError(null);

    if (deferred) {
      // Stage a removal — show the initials fallback until the parent commits.
      setPreviewUrl(null);
      setStagedRemove(true);
      onStageChange({ remove: true });
      return;
    }

    setBusy(true);
    try {
      const response = await apiClient.delete(`/api/team/${teamId}/avatar`);
      onUpdated?.(response.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove avatar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
      <Box sx={{ position: 'relative', width: size, height: size }}>
        {previewUrl ? (
          <Box
            component="img"
            src={previewUrl}
            alt=""
            sx={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', opacity: 0.6 }}
          />
        ) : (
          <TeamAvatar
            name={teamName}
            avatarUrl={stagedRemove ? undefined : avatarUrl}
            avatarStaticUrl={stagedRemove ? undefined : avatarStaticUrl}
            size={size}
          />
        )}
        {busy && (
          <CircularProgress
            size={size}
            variant={progress > 0 && progress < 100 ? 'determinate' : 'indeterminate'}
            value={progress}
            sx={{ position: 'absolute', top: 0, left: 0 }}
          />
        )}
        <IconButton
          size="small"
          onClick={handlePick}
          disabled={busy}
          aria-label={`Change ${teamName || 'team'} avatar`}
          sx={{
            position: 'absolute',
            bottom: -4,
            right: -4,
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            '&:hover': { bgcolor: 'background.paper' },
          }}
        >
          <PhotoCameraIcon fontSize="small" />
        </IconButton>
        {((deferred ? previewUrl || (avatarUrl && !stagedRemove) : avatarUrl)) && !busy && (
          <IconButton
            size="small"
            onClick={() => setRemoveConfirmOpen(true)}
            aria-label={`Remove ${teamName || 'team'} avatar`}
            sx={{
              position: 'absolute',
              top: -4,
              right: -4,
              bgcolor: 'background.paper',
              border: '1px solid',
              borderColor: 'error.main',
              color: 'error.main',
              '&:hover': { bgcolor: 'background.paper' },
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        )}
      </Box>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={handleFileChange}
      />
      {error && (
        <Typography variant="caption" color="error">
          {error}
        </Typography>
      )}
      <Dialog open={removeConfirmOpen} onClose={() => setRemoveConfirmOpen(false)}>
        <DialogTitle>Remove team logo?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The current team logo will be removed and replaced with the team&apos;s initials.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveConfirmOpen(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              setRemoveConfirmOpen(false);
              handleRemove();
            }}
          >
            Remove logo
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default TeamAvatarUploader;
