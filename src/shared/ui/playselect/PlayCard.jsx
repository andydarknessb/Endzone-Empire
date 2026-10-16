import React, { useId } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box } from '@mui/material';
import { PixelArrow, PixelClock, Pictogram } from './Icons';
import { pixelSx } from './type';

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
  border: '2px solid var(--ps-play-ink)',
  ...(filled
    ? { backgroundColor: 'var(--ps-play-accent)', color: 'var(--ps-on-play-accent)', fontWeight: 700 }
    : { color: 'var(--ps-play-ink)', fontWeight: 600 }),
});

const stripText = (countdown) => `${String(countdown).replace(/^in /, '')} left`;

/**
 * The signature: a column of an optional urgent strip, the field band, the
 * body and the foot, wrapped in the cursor slot.
 *
 * state 'next' is the cursor (earliest lock, or a live draft); 'urgent' is
 * under an hour: a red "<countdown> left" strip, and the red cursor only when
 * it is also the lead; 'open' is plain. `lead` carries the page's one filled
 * foot and the cursor (it defaults to the 'next' card); `filledFoot={false}`
 * keeps the cursor but outlines the foot, for a lead with nothing to do. `actions` makes one
 * play across several leagues a group with one foot per league; the card is
 * then a group, not a link. A `cta.onClick` (no `to`) makes the card one
 * button, for a play that opens a dialog (first run's Create and Join).
 *
 * League pages' Your move adds three optional looks. `compact` drops the field
 * band (a non-lead card: name, lock, foot). `wide` seats the band left of the
 * text (the lead on desktop) and lays a group's feet in a row. `headingLevel`
 * makes the name a real heading that names the card, instead of an aria-label
 * that repeats it; an action's `bare` drops the second line of its foot.
 */
export function PlayCard({
  kind, name, league, detail, lockDay, lockTime, countdown, lockNote, cta, actions,
  state = 'open', lead = state === 'next', filledFoot = true, ariaLabel,
  compact = false, wide = false, headingLevel,
}) {
  const headingId = useId();
  const urgent = state === 'urgent' && Boolean(countdown);
  const ring = state === 'urgent' ? 'var(--ps-danger)' : 'var(--ps-cursor)';
  const live = lockDay === 'Live';
  const filled = lead && filledFoot;

  const feet = actions ? (
    <Box component="span" sx={{ marginTop: 'auto', display: 'flex', flexDirection: wide ? { xs: 'column', md: 'row' } : 'column', gap: '8px' }}>
      {actions.map((a, i) => (
        <Box
          key={a.to || a.label}
          component={RouterLink}
          to={a.to}
          aria-label={a.ariaLabel}
          data-filled={filled && i === 0 ? 'true' : undefined}
          sx={{ ...footSx(filled && i === 0), ...(a.bare ? { flex: wide ? { md: 1 } : undefined } : { padding: '8px 12px' }) }}
        >
          {a.bare ? a.label : (
            <Box component="span" sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
              <span>{a.label}</span>
              <Box component="span" sx={{ fontSize: '14px', fontWeight: 400 }}>
                {(cta && cta.label) || 'Make picks'}
                {a.note ? ` · ${a.note}` : ''}
              </Box>
            </Box>
          )}
          <PixelArrow />
        </Box>
      ))}
    </Box>
  ) : cta && (
    <Box
      component="span"
      data-filled={filled ? 'true' : undefined}
      sx={{ marginTop: 'auto', ...footSx(filled) }}
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
          id={headingLevel ? `${headingId}-t` : undefined}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: { xs: '8px 12px', md: '8px 16px' },
            backgroundColor: 'var(--ps-danger)',
            color: 'var(--ps-on-danger)',
            ...pixelSx(16),
            lineHeight: 1.2,
          }}
        >
          <PixelClock />
          {stripText(countdown)}
        </Box>
      )}
      <Box component="span" sx={{ display: 'flex', flex: 1, flexDirection: wide ? { xs: 'column', md: 'row' } : 'column' }}>
      {!compact && (
        <Box
          component="span"
          sx={{
            display: 'grid',
            placeItems: 'center',
            padding: { xs: '10px 0', md: '14px 0' },
            backgroundColor: 'var(--ps-play-field)',
            ...(wide
              ? {
                borderTop: { xs: '2px dashed var(--ps-play-dim)', md: 0 },
                borderBottom: { xs: '2px dashed var(--ps-play-dim)', md: 0 },
                borderRight: { md: '2px dashed var(--ps-play-dim)' },
                width: { md: '192px' },
                flex: { md: 'none' },
              }
              : { borderTop: '2px dashed var(--ps-play-dim)', borderBottom: '2px dashed var(--ps-play-dim)' }),
          }}
        >
          <Box component="span" sx={{ display: 'block', width: { xs: '96px', md: '144px' } }}>
            <Pictogram kind={kind} width="100%" />
          </Box>
        </Box>
      )}
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
          <Box
            component={headingLevel ? `h${headingLevel}` : 'span'}
            id={headingLevel ? headingId : undefined}
            sx={{
              ...(headingLevel ? { m: 0 } : null), ...pixelSx(16), color: 'var(--ps-play-ink)', overflowWrap: 'anywhere',
            }}
          >
            {name}
          </Box>
          {!compact && (
            <Box component="span" sx={{ fontSize: { xs: '14px', md: '15px' }, color: 'var(--ps-play-dim)' }}>
              {[league, detail].filter(Boolean).join(' · ')}
            </Box>
          )}
        </Box>
        <Box component="span" sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <Box
            component="span"
            sx={{
              ...pixelSx(16),
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              color: live ? 'var(--ps-play-accent)' : 'var(--ps-play-ink)',
            }}
          >
            {live && (
              <Box component="span" aria-hidden="true" sx={{ width: '8px', height: '8px', backgroundColor: 'var(--ps-play-accent)' }} />
            )}
            {[lockDay, lockTime].filter(Boolean).join(' ')}
          </Box>
          {lockNote && <Box component="span" sx={{ fontSize: '14px', color: 'var(--ps-play-dim)' }}>{lockNote}</Box>}
        </Box>
        {feet}
      </Box>
      </Box>
    </>
  );

  const label = `${lead ? 'Next up: ' : ''}${name}${ariaLabel ? `. ${ariaLabel}` : ''}${urgent ? `. ${stripText(countdown)}` : ''}`;
  const boxSx = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    boxSizing: 'border-box',
    backgroundColor: 'var(--ps-play)',
    color: 'var(--ps-play-ink)',
    textDecoration: 'none',
  };
  const buttonSx = {
    ...boxSx, width: '100%', margin: 0, padding: 0, border: 0, font: 'inherit', textAlign: 'left', cursor: 'pointer',
  };
  let card;
  if (actions) {
    card = headingLevel
      ? <Box role="group" aria-labelledby={urgent ? `${headingId} ${headingId}-t` : headingId} sx={boxSx}>{inner}</Box>
      : <Box role="group" aria-label={label} sx={boxSx}>{inner}</Box>;
  } else if (cta && cta.onClick) card = <Box component="button" type="button" onClick={cta.onClick} aria-label={label} sx={buttonSx}>{inner}</Box>;
  else card = <Box component={RouterLink} to={cta ? cta.to : '#'} aria-label={label} sx={boxSx}>{inner}</Box>;

  return (
    <Box
      className={lead ? 'slot cursor' : 'slot'}
      sx={{
        '--cur': lead ? ring : 'var(--ps-cursor)',
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
