import React from 'react';
import { Box, Stack, Typography, Button, Skeleton } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import InboxIcon from '@mui/icons-material/Inbox';

/**
 * The three explicit states every public data view must render:
 *   - LoadingState: Skeleton placeholders (never a blank screen or a spinner).
 *   - EmptyState:   a calm "not available yet" message, not an error.
 *   - ErrorState:   an apologetic message plus a Retry button.
 *
 * Keeping them here makes the loading/empty/error treatment identical across
 * rankings, profiles, recaps, and the landing teasers.
 */

export function LoadingRows({ rows = 6, height = 44 }) {
  return (
    // data-testid is a test-only seam (#326): this Stack is decorative and
    // carries no role or accessible name, so it has nothing a semantic query
    // can find it by. aria-busy/aria-live stay as the a11y contract; the
    // testid exists only so a test can assert the busy container rendered.
    <Stack spacing={1} aria-busy="true" aria-live="polite" data-testid="loading-rows">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} variant="rounded" height={height} />
      ))}
    </Stack>
  );
}

export function EmptyState({ message = 'Not available yet.', hint }) {
  return (
    <Stack spacing={1} alignItems="center" sx={{ py: 6, color: 'text.secondary', textAlign: 'center' }}>
      <InboxIcon sx={{ fontSize: 40, opacity: 0.6 }} aria-hidden="true" />
      <Typography variant="body1">{message}</Typography>
      {hint && <Typography variant="body2" sx={{ opacity: 0.8 }}>{hint}</Typography>}
    </Stack>
  );
}

export function ErrorState({ message = 'Something went wrong loading this.', onRetry }) {
  return (
    <Stack spacing={2} alignItems="center" sx={{ py: 6, textAlign: 'center' }}>
      <ErrorOutlineIcon sx={{ fontSize: 40, color: 'error.main' }} aria-hidden="true" />
      <Typography variant="body1" sx={{ color: 'text.secondary' }} role="alert">
        {message}
      </Typography>
      {onRetry && (
        <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={onRetry}>
          Try again
        </Button>
      )}
    </Stack>
  );
}

/**
 * Convenience wrapper: pick the right state for a { loading, error, isEmpty }
 * triple, else render children. Keeps pages declarative.
 */
export function AsyncBoundary({
  loading,
  error,
  isEmpty,
  onRetry,
  loadingFallback,
  emptyMessage,
  emptyHint,
  children,
}) {
  if (loading) return loadingFallback || <LoadingRows />;
  if (error) return <ErrorState onRetry={onRetry} />;
  if (isEmpty) return <EmptyState message={emptyMessage} hint={emptyHint} />;
  return <Box>{children}</Box>;
}
