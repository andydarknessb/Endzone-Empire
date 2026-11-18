import React, { useState } from 'react';
import { Box, Drawer, useMediaQuery, useTheme } from '@mui/material';
import ChatPanel from '../../../components/ChatPanel/ChatPanel';
import {
  MENU_PANEL_VARS, PixelClose, PixelSpeech, pixelSx, psRootSx,
} from '../../../shared/ui/playselect';

/**
 * The league chat, composed as-is from the legacy ChatPanel. The page owns the open state and the unread
 * count (useChatLauncher) so the button and the drawer agree. The button is a Ghost "Chat" button in the
 * page head's right slot below sm, and the square 56px button bottom-right from sm up (fixed, at the page
 * end). The unread count is a 28px square badge on it; the drawer is a framed panel (6px double Frame) with
 * a Pixel 16 heading and a 44px close. The panel stays mounted inside the drawer even while it is closed
 * (docked above sm, keepMounted below it), so it owns the unread count and reports it up through
 * onUnreadChange; the button's accessible name carries that count so a screen-reader user hears it without
 * opening the drawer. Every league member has chat, fantasy or pick'em alike. The drawer paper carries the
 * Play-select root class, since a portal renders outside the page root.
 */
export function useChatLauncher() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  return { open, setOpen, unread, setUnread };
}

// Ghost below sm (a transparent Ink-bordered button with the word shown); from sm the Panel-filled square.
const BUTTON_SX = {
  position: { xs: 'relative', sm: 'fixed' },
  bottom: { sm: 24 },
  right: { sm: 24 },
  zIndex: (t) => t.zIndex.fab,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '10px',
  width: { xs: 'auto', sm: '56px' },
  height: { xs: '44px', sm: '56px' },
  padding: { xs: '0 16px', sm: 0 },
  boxSizing: 'border-box',
  borderRadius: 0,
  fontFamily: 'inherit',
  fontSize: '15px',
  fontWeight: 600,
  cursor: 'pointer',
  backgroundColor: { xs: 'transparent', sm: 'var(--ps-panel)' },
  border: '2px solid var(--ps-ink)',
  color: 'var(--ps-ink)',
};

/** The chat button. The page renders it in the head below sm and at the page end from sm up, never both. */
export function ChatLaunchButton({ chat }) {
  const { open, setOpen, unread } = chat;
  return (
    <Box
      component="button"
      type="button"
      onClick={() => setOpen(true)}
      aria-expanded={open}
      aria-controls="league-chat-drawer"
      aria-label={
        unread > 0
          ? `Open league chat, ${unread} unread message${unread === 1 ? '' : 's'}`
          : 'Open league chat'
      }
      sx={BUTTON_SX}
    >
      <PixelSpeech />
      <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>Chat</Box>
      {unread > 0 && (
        <Box
          component="span"
          aria-hidden="true"
          data-testid="chat-unread"
          sx={{
            position: 'absolute',
            top: '-14px',
            right: '-14px',
            display: 'grid',
            placeItems: 'center',
            minWidth: '28px',
            height: '28px',
            padding: '0 4px',
            boxSizing: 'border-box',
            backgroundColor: 'var(--ps-field)',
            border: '2px solid var(--ps-ink)',
            ...pixelSx(16),
            lineHeight: 1,
          }}
        >
          {unread > 99 ? '99+' : unread}
        </Box>
      )}
    </Box>
  );
}

export default function ChatLauncher({ leagueId, chat }) {
  const { open, setOpen, setUnread } = chat;
  const theme = useTheme();
  // Below sm the drawer paper is the whole viewport, so it has to behave like one: `temporary` is the
  // only variant that renders a Modal, and the Modal is what supplies the backdrop, the focus trap,
  // Escape and focus restore that a full-screen panel needs. Above sm it stays the docked panel beside
  // the page. `noSsr` because there is no server render to match.
  const compact = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const variant = compact ? 'temporary' : 'persistent';
  // The dialog semantics ride with the modality, never ahead of it: announcing aria-modal on the docked
  // panel would claim a trap that is not there and tell a screen reader the rest of the page is inert.
  const modal = variant === 'temporary';

  return (
    <Drawer
      anchor="right"
      variant={variant}
      open={open}
      onClose={() => setOpen(false)}
      // ChatPanel owns the socket and the unread count the launcher shows, so the paper stays mounted
      // across open/close: without keepMounted the temporary variant would tear the panel down on
      // every close and the badge would restart from zero.
      ModalProps={{ keepMounted: true }}
      // MUI's Modal brings the backdrop, trap, Escape and focus restore but no role, so the paper
      // declares what it is.
      PaperProps={{
        id: 'league-chat-drawer',
        className: 'ps-root',
        ...(modal ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'League chat' } : {}),
      }}
      sx={{
        // The docked variant emits a real in-flow div beside the page, which in the shell's column
        // stack was a permanent empty row on every dashboard. `contents` keeps the fixed paper and
        // drops the box that generated the row.
        '&.MuiDrawer-docked': { display: 'contents' },
        '& .MuiDrawer-paper': {
          ...psRootSx,
          ...MENU_PANEL_VARS,
          width: { xs: '100vw', sm: 380 },
          boxSizing: 'border-box',
          backgroundColor: 'var(--ps-panel)',
          border: { xs: 0, sm: '6px double var(--ps-frame)' },
          borderRadius: 0,
          backgroundImage: 'none',
          boxShadow: 'none',
        },
      }}
    >
      <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Box
          sx={{
            display: 'flex', alignItems: 'center', gap: '12px', padding: { xs: '12px 14px', md: '14px 20px' }, borderBottom: '2px solid var(--ps-rule)',
          }}
        >
          <Box component="h2" sx={{ m: 0, ...pixelSx(16) }}>League Chat</Box>
          <Box
            component="button"
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close chat"
            sx={{
              marginLeft: 'auto',
              width: '44px',
              height: '44px',
              padding: 0,
              display: 'grid',
              placeItems: 'center',
              boxSizing: 'border-box',
              borderRadius: 0,
              background: 'transparent',
              border: '2px solid var(--ps-ink)',
              color: 'var(--ps-ink)',
            }}
          >
            <PixelClose />
          </Box>
        </Box>
        <Box sx={{ flex: 1, overflowY: 'auto', px: 1 }}>
          <ChatPanel leagueId={leagueId} open={open} onUnreadChange={setUnread} />
        </Box>
      </Box>
    </Drawer>
  );
}
