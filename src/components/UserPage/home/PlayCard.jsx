import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box } from '@mui/material';
import { PixelArrow, PixelClock, Pictogram } from './Icons';
import { pixelSx } from './homeType';

const footSx = (filled) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  minHeight: '44px',
  padding: '0 12px',
  boxSizing: 'border-box',
  fontSize: '15px',
  textDecoration: 'none',
  border: '2px solid var(--home-play-ink)',
  ...(filled
    ? { backgroundColor: 'var(--home-play-accent)', color: 'var(--home-on-play-accent)', fontWeight: 700 }
    : { color: 'var(--home-play-ink)', fontWeight: 600 }),
});

const stripText = (countdown) => `${String(countdown).replace(/^in /, '')} left`;

/**
 * The signature: a column of an optional urgent strip, the field band, the
 * body and the foot, wrapped in the cursor slot.
 *
 * state 'next' is the cursor (earliest lock, or a live draft); 'urgent' is
 * under an hour: a red "<countdown> left" strip, and the red cursor only when
 * it is also the lead; 'open' is plain. `lead` carries the page's one filled
 * foot and the cursor (it defaults to the 'next' card). `actions` makes one
 * play across several leagues a group with one foot per league; the card is
 * then a group, not a link. A `cta.onClick` (no `to`) makes the card one
 * button, for a play that opens a dialog (first run's Create and Join).
 */
export function PlayCard({
  kind, name, league, detail, lockDay, lockTime, countdown, lockNote, cta, actions,
  state = 'open', lead = state === 'next', ariaLabel,
}) {
  const urgent = state === 'urgent' && Boolean(countdown);
  const ring = state === 'urgent' ? 'var(--home-danger)' : 'var(--home-cursor)';
  const live = lockDay === 'Live';

  const feet = actions ? (
    <Box component="span" sx={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {actions.map((a, i) => (
        <Box
          key={a.to || a.label}
          component={RouterLink}
          to={a.to}
          aria-label={a.ariaLabel}
          data-filled={lead && i === 0 ? 'true' : undefined}
          sx={{ ...footSx(lead && i === 0), padding: '8px 12px' }}
        >
          <Box component="span" sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
            <span>{a.label}</span>
            <Box component="span" sx={{ fontSize: '14px', fontWeight: 400 }}>
              {(cta && cta.label) || 'Make picks'}
              {a.note ? ` · ${a.note}` : ''}
            </Box>
          </Box>
          <PixelArrow />
        </Box>
      ))}
    </Box>
  ) : cta && (
    <Box
      component="span"
      data-filled={lead ? 'true' : undefined}
      sx={{ marginTop: 'auto', ...footSx(lead) }}
    >
      {cta.label}
      <PixelArrow />
    </Box>
  );

  const inner = (
    <>
      {urgent && (
        <Box
          component="span"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: { xs: '8px 12px', md: '8px 16px' },
            backgroundColor: 'var(--home-danger)',
            color: 'var(--home-on-danger)',
            ...pixelSx(16),
            lineHeight: 1.2,
          }}
        >
          <PixelClock />
          {stripText(countdown)}
        </Box>
      )}
      <Box
        component="span"
        sx={{
          display: 'grid',
          placeItems: 'center',
          padding: { xs: '10px 0', md: '14px 0' },
          backgroundColor: 'var(--home-play-field)',
          borderTop: '2px dashed var(--home-play-dim)',
          borderBottom: '2px dashed var(--home-play-dim)',
        }}
      >
        <Box component="span" sx={{ display: 'block', width: { xs: '96px', md: '144px' } }}>
          <Pictogram kind={kind} width="100%" />
        </Box>
      </Box>
      <Box
        component="span"
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: { xs: '10px', md: '14px' },
          padding: { xs: '12px', md: '16px' },
          flex: 1,
        }}
      >
        <Box component="span" sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <Box component="span" sx={{ ...pixelSx(16), color: 'var(--home-play-ink)', overflowWrap: 'anywhere' }}>{name}</Box>
          <Box component="span" sx={{ fontSize: { xs: '14px', md: '15px' }, color: 'var(--home-play-dim)' }}>
            {league}
            {detail ? ` · ${detail}` : ''}
          </Box>
        </Box>
        <Box component="span" sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <Box
            component="span"
            sx={{
              ...pixelSx(16),
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              color: live ? 'var(--home-play-accent)' : 'var(--home-play-ink)',
            }}
          >
            {live && (
              <Box component="span" aria-hidden="true" sx={{ width: '8px', height: '8px', backgroundColor: 'var(--home-play-accent)' }} />
            )}
            {[lockDay, lockTime].filter(Boolean).join(' ')}
          </Box>
          {lockNote && <Box component="span" sx={{ fontSize: '14px', color: 'var(--home-play-dim)' }}>{lockNote}</Box>}
        </Box>
        {feet}
      </Box>
    </>
  );

  const label = `${lead ? 'Next up: ' : ''}${name}${ariaLabel ? `. ${ariaLabel}` : ''}${urgent ? `. ${stripText(countdown)}` : ''}`;
  const boxSx = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    boxSizing: 'border-box',
    backgroundColor: 'var(--home-play)',
    color: 'var(--home-play-ink)',
    textDecoration: 'none',
  };
  const buttonSx = {
    ...boxSx, width: '100%', margin: 0, padding: 0, border: 0, font: 'inherit', textAlign: 'left', cursor: 'pointer',
  };
  let card;
  if (actions) card = <Box role="group" aria-label={label} sx={boxSx}>{inner}</Box>;
  else if (cta && cta.onClick) card = <Box component="button" type="button" onClick={cta.onClick} aria-label={label} sx={buttonSx}>{inner}</Box>;
  else card = <Box component={RouterLink} to={cta ? cta.to : '#'} aria-label={label} sx={boxSx}>{inner}</Box>;

  return (
    <Box
      className={lead ? 'slot cursor' : 'slot'}
      sx={{
        '--cur': lead ? ring : 'var(--home-cursor)',
        padding: '8px',
        border: `4px solid ${lead ? ring : 'transparent'}`,
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      {card}
    </Box>
  );
}
