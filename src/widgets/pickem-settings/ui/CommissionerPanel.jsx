import React, { useEffect, useId, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { Frame, PixelWarn, SR_ONLY_SX, pixelSx } from '../../../shared/ui/playselect';

// The two scoring modes, worded once and shared with the create dialogs' mode
// picker (src/components/common/LeagueTypeFields.jsx) and the read-only
// League Rules view (src/components/LeagueRules/PickemRulesView.jsx) so a
// league reads the same rule at creation, in its settings, and in its rules.
export const PICKEM_MODE_OPTIONS = Object.freeze([
  { value: 'straight', label: 'Straight up: 1 point per correct pick' },
  { value: 'confidence', label: 'Confidence: rank every game, earn the rank you assigned' },
]);

const MODE_WORD = { straight: 'Straight up', confidence: 'Confidence' };

// The kit's ghost button: 44px, a 2px Ink edge, never filled. It takes the disclosure props
// (`aria-expanded`, `aria-controls`) the shared PsButton does not pass on. Disabled is a solid Rule
// edge with Dim text: no dash and no opacity.
const GHOST_SX = {
  minHeight: '44px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 16px',
  boxSizing: 'border-box',
  borderRadius: 0,
  backgroundColor: 'transparent',
  border: '2px solid var(--ps-ink)',
  color: 'var(--ps-ink)',
  fontFamily: 'inherit',
  fontSize: '15px',
  fontWeight: 600,
  cursor: 'pointer',
  '&:disabled': { borderColor: 'var(--ps-rule)', color: 'var(--ps-dim)', cursor: 'not-allowed' },
  '&:disabled:hover': { filter: 'none' },
};

const FOCUS_RING = { outline: '3px solid var(--ps-focus)', boxShadow: '0 0 0 7px var(--ps-halo)' };

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" shapeRendering="crispEdges" style={{ flex: 'none' }}>
      <path d="M5 1h6v2H5zM3 3h2v4H3zM11 3h2v4h-2zM2 7h12v8H2zM7 9h2v3H7z" fill="currentColor" />
    </svg>
  );
}

// A native checkbox, visually hidden but focusable, drives the kit's switch: a square 44x24 track and a
// square knob, with the On / Off word so state never rides on colour alone.
function Switch({ checked, disabled, onChange, children }) {
  return (
    <Box
      component="label"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '12px',
        minHeight: '44px',
        fontSize: '15px',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? 'var(--ps-dim)' : 'var(--ps-ink)',
        '& input:focus-visible + .tg-track': FOCUS_RING,
        '& input:checked + .tg-track': { backgroundColor: 'var(--ps-play)', borderColor: 'var(--ps-play-ink)' },
        '& input:checked + .tg-track .tg-knob': { left: '22px', backgroundColor: 'var(--ps-play-ink)' },
      }}
    >
      <Box component="input" type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={onChange} sx={SR_ONLY_SX} />
      <Box
        component="span"
        className="tg-track"
        aria-hidden="true"
        sx={{ width: '44px', height: '24px', boxSizing: 'border-box', border: '2px solid var(--ps-dim)', position: 'relative', flex: 'none' }}
      >
        <Box
          component="span"
          className="tg-knob"
          sx={{ position: 'absolute', top: '2px', left: '2px', width: '16px', height: '16px', backgroundColor: 'var(--ps-dim)' }}
        />
      </Box>
      <span>{children}</span>
      <Box component="span" aria-hidden="true" sx={{ fontWeight: 400, color: 'var(--ps-dim)' }}>{checked ? 'On' : 'Off'}</Box>
    </Box>
  );
}

// Radio cards: a round indicator (distinct from the team button's square check). Selected is the Play
// blue fill with a dot; a locked selected card keeps that fill and adds the lock and the word Locked,
// and an unselected disabled card is solid Dim text. Never opacity.
function RadioCard({ option, checked, disabled, locked, onChange }) {
  return (
    <Box
      component="label"
      sx={{
        display: 'block',
        position: 'relative',
        '& input:focus-visible + .rc-card': FOCUS_RING,
        '& input:checked + .rc-card': { backgroundColor: 'var(--ps-play)', color: 'var(--ps-play-ink)', borderColor: 'var(--ps-play-ink)' },
        '& input:checked + .rc-card .rc-dot::after': { content: '""', width: '6px', height: '6px', backgroundColor: 'currentColor', borderRadius: '50%' },
        '& input:disabled:not(:checked) + .rc-card': { color: 'var(--ps-dim)' },
      }}
    >
      <Box component="input" type="radio" name="pickem-mode" value={option.value} checked={checked} disabled={disabled} onChange={onChange} sx={SR_ONLY_SX} />
      <Box
        component="span"
        className="rc-card"
        sx={{
          display: 'flex',
          gap: '12px',
          alignItems: 'flex-start',
          boxSizing: 'border-box',
          height: '100%',
          minHeight: '44px',
          padding: '12px 14px',
          border: '2px solid var(--ps-dim)',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <Box
          component="span"
          className="rc-dot"
          aria-hidden="true"
          sx={{ flex: 'none', width: '16px', height: '16px', boxSizing: 'border-box', border: '2px solid currentColor', marginTop: '3px', display: 'grid', placeItems: 'center', borderRadius: '50%' }}
        />
        <Box component="span" sx={{ fontSize: '15px', fontWeight: 600 }}>
          {option.label}
          {checked && locked && (
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', ml: '8px', fontSize: '14px', fontWeight: 700, whiteSpace: 'nowrap' }}>
              <LockIcon />
              Locked
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

/**
 * Commissioner controls (#1267, ADR 0038; a tertiary Play-select frame since ADR 0067 wave 2,
 * docs/design/league/Pickem*.dc.html). It is collapsed by default to one row, "Commissioner settings
 * · Pick'em on · {mode} · locked for the season" with a ghost "Edit" (`aria-expanded`, "Hide" once
 * open); expanded it is the kit form: the Pick'em switch (or the always-on line of a pick'em-only
 * league), the scoring radio cards and a ghost "Save scoring mode", never filled.
 *
 * The scoring mode is a one-way door for the season: once anyone has made a pick, the server returns
 * 409 PICKEM_MODE_LOCKED rather than reinterpreting every stored confidence. `modeLocked` is the
 * page's reading of that (some team has made a pick this season): the scoring cards render disabled,
 * the selected one adds the lock and the word Locked, and the row says "locked for the season". With
 * it false the cards stay enabled and the server's refusal, should it come, is surfaced as the error.
 * The Pick'em switch stays usable either way.
 *
 * `lockedOn` is the pick'em-only league: pick'em is the league's only game, so the switch is replaced
 * by a static line, the row drops "Pick'em on", and only the mode is editable. The panel is one tree
 * position whether Pick'em is on or off, so flipping the switch never unmounts it (and drops the
 * switch's focus; accessibility risk review, #1267).
 */
export default function CommissionerPanel({
  settings, saving, error, onSave, lockedOn = false, modeLocked = false,
}) {
  const headingId = useId();
  const bodyId = useId();
  // Collapsed to one row by default; with Pick'em off the panel is the page's only content, so it
  // opens on the switch the commissioner came to flip.
  const [open, setOpen] = useState(!settings.enabled);
  const [mode, setMode] = useState(settings.mode);

  // Another commissioner (or another tab) may have changed the mode since this
  // panel mounted - follow the server whenever it reports a new value.
  useEffect(() => {
    setMode(settings.mode);
  }, [settings.mode]);

  // A successful mode save disables the Save button the click is still focused on (`settings.mode`
  // catches up to `mode`): a disabled button drops out of the focusable set, so an unmanaged focus
  // would fall to `<body>` with no confirmation at all (WCAG 4.1.3, accessibility risk review
  // #1267). This moves focus onto a confirmation instead, once the save actually lands.
  const [justSaved, setJustSaved] = useState(false);
  const statusRef = useRef(null);

  useEffect(() => {
    if (mode !== settings.mode) setJustSaved(false);
  }, [mode, settings.mode]);

  useEffect(() => {
    if (justSaved) statusRef.current?.focus();
  }, [justSaved]);

  const handleSaveMode = async () => {
    const result = await onSave({ mode });
    if (result?.ok) setJustSaved(true);
  };

  const summary = [
    lockedOn ? null : settings.enabled ? "Pick'em on" : "Pick'em off",
    MODE_WORD[settings.mode] || settings.mode,
    modeLocked ? 'locked for the season' : null,
  ].filter(Boolean).join(' · ');

  return (
    <Frame tier="rule" labelledBy={headingId} data-testid="pickem-settings">
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px 16px',
          padding: { xs: '8px 14px', md: '8px 20px' },
          boxSizing: 'border-box',
          borderBottom: open ? '2px solid var(--ps-rule)' : undefined,
        }}
      >
        <Box component="span" sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 12px', minWidth: 0 }}>
          <Box component="h2" id={headingId} sx={{ m: 0, ...pixelSx(16) }}>Commissioner settings</Box>
          <Box component="span" data-testid="pickem-settings-summary" sx={{ fontSize: '15px', color: 'var(--ps-dim)' }}>{summary}</Box>
        </Box>
        <Box
          component="button"
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`${open ? 'Hide' : 'Edit'} commissioner settings`}
          onClick={() => setOpen((value) => !value)}
          sx={GHOST_SX}
        >
          {open ? 'Hide' : 'Edit'}
        </Box>
      </Box>

      {open && (
        <Box id={bodyId} sx={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Box component="p" sx={{ m: 0, fontSize: '15px', color: 'var(--ps-dim)', maxWidth: '760px', textWrap: 'pretty' }}>
            {lockedOn
              ? 'Everyone picks the winner of every NFL game, picks lock at kickoff, and a tied game credits nobody.'
              : "Pick'em runs for the whole league alongside fantasy. Everyone picks the winner of every NFL game, picks lock at kickoff, and a tied game credits nobody."}
          </Box>

          {error && (
            <Box role="alert" sx={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '15px', color: 'var(--ps-danger)' }}>
              <PixelWarn color="var(--ps-danger)" />
              {error}
            </Box>
          )}

          {lockedOn ? (
            <Box component="p" sx={{ m: 0, fontSize: '15px', fontWeight: 600 }}>Pick&apos;em is always on in this league.</Box>
          ) : (
            <Box>
              <Switch
                checked={Boolean(settings.enabled)}
                disabled={saving}
                onChange={(event) => onSave({ enabled: event.target.checked })}
              >
                Enable Pick&apos;em for this league
              </Switch>
            </Box>
          )}

          <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
            <Box component="legend" sx={{ p: 0, mb: '8px', fontSize: '14px', fontWeight: 600 }}>Scoring</Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px' }}>
              {PICKEM_MODE_OPTIONS.map((option) => (
                <RadioCard
                  key={option.value}
                  option={option}
                  checked={mode === option.value}
                  disabled={modeLocked}
                  locked={modeLocked}
                  onChange={() => setMode(option.value)}
                />
              ))}
            </Box>
          </Box>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px' }}>
            <Box
              component="button"
              type="button"
              disabled={saving || modeLocked || mode === settings.mode}
              onClick={handleSaveMode}
              sx={GHOST_SX}
            >
              Save scoring mode
            </Box>
            <Box component="span" sx={{ fontSize: '14px', color: 'var(--ps-dim)' }}>
              The mode can only change before the season&apos;s first pick.
            </Box>
            {justSaved && (
              <Box
                component="span"
                ref={statusRef}
                tabIndex={-1}
                data-testid="pickem-settings-mode-saved"
                sx={{ fontSize: '14px', fontWeight: 600, outline: 'none' }}
              >
                Scoring mode saved
              </Box>
            )}
          </Box>
        </Box>
      )}
    </Frame>
  );
}
