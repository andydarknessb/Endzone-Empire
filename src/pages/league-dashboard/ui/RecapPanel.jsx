import React, {
  useId, useLayoutEffect, useRef, useState,
} from 'react';
import { Box } from '@mui/material';
import {
  Frame, FrameHead, PixelHeading, PsButton, PsLinkButton,
} from '../../../shared/ui/playselect';
import { buildFactRows, formatGenerated, useRecap } from '../../../components/RecapCard/RecapCard';

const CLAMPED_SX = {
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

// The narrative, clamped to three lines until the reader opens it, with its toggle only when the text
// really overflows (measured after layout, again when the box resizes and when the fonts land) -
// the RecapCard's own behaviour, in the dashboard's look.
function Narrative({ text }) {
  const narrativeId = useId();
  const ref = useRef(null);
  const toggleRef = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    setExpanded(false);
  }, [text]);

  useLayoutEffect(() => {
    if (expanded) return undefined;
    let cancelled = false;
    const measure = () => {
      const el = ref.current;
      if (cancelled || !el) return;
      const next = el.scrollHeight > el.clientHeight;
      if (!next && toggleRef.current && document.activeElement === toggleRef.current) el.focus();
      setOverflows(next);
    };
    measure();
    let observer;
    if (typeof ResizeObserver !== 'undefined' && ref.current) {
      observer = new ResizeObserver(measure);
      observer.observe(ref.current);
    }
    document.fonts?.ready?.then(measure);
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [expanded, text]);

  return (
    <>
      <Box
        component="p"
        id={narrativeId}
        ref={ref}
        tabIndex={-1}
        sx={{
          m: 0, fontSize: '16px', maxWidth: '80ch', whiteSpace: 'pre-line', outline: 'none', ...(expanded ? null : CLAMPED_SX),
        }}
      >
        {text}
      </Box>
      {(overflows || expanded) && (
        <Box sx={{ marginLeft: '-10px' }}>
          <PsLinkButton
            ref={toggleRef}
            data-testid="recap-toggle"
            aria-expanded={expanded}
            aria-controls={narrativeId}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? 'Show less' : 'Read the full recap'}
          </PsLinkButton>
        </Box>
      )}
    </>
  );
}

/**
 * The weekly recap as a tertiary frame (ADR 0067 ruling 2): the dashboard's own Play-select view of
 * the recap read (`useRecap`, exported from the RecapCard module the public Recaps page and the card
 * share; the card keeps its look). Labelled as a recap, never a Projection: the narrative (clamped to
 * three lines with a "Read the full recap" toggle), the fact rows in the product's order and the time
 * it was generated; the commissioner's "Rebuild recap" is a ghost button. It renders nothing until a
 * recap exists (a 404 leaves none), so the page's wrapper collapses.
 */
export default function RecapPanel({ leagueId }) {
  const {
    recap, isCommissioner, isCurrentSeasonRecap, rebuilding, rebuildError, handleRebuild,
  } = useRecap(leagueId);
  const headingId = useId();

  if (!recap || !recap.data) return null;

  const rows = buildFactRows(recap.data.facts);
  const generated = formatGenerated(recap.data.generatedAt);

  return (
    <Frame
      tier="rule"
      labelledBy={headingId}
      data-testid="recap-card"
      head={(
        <FrameHead>
          <PixelHeading id={headingId} size={16}>{recap.week != null ? `Week ${recap.week} recap` : 'Weekly recap'}</PixelHeading>
          {generated && (
            <Box component="span" sx={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--ps-dim)' }}>{`Generated ${generated}`}</Box>
          )}
          {isCommissioner && isCurrentSeasonRecap && (
            <Box data-testid="recap-rebuild-slot">
              <PsButton variant="ghost" onClick={handleRebuild} disabled={rebuilding}>
                {rebuilding ? 'Rebuilding...' : 'Rebuild recap'}
              </PsButton>
            </Box>
          )}
        </FrameHead>
      )}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: { xs: '14px', md: '20px' } }}>
        {rebuildError && <Box role="alert" sx={{ fontSize: '14px' }}>{rebuildError}</Box>}
        {recap.data.narrative && <Narrative text={recap.data.narrative} />}
        {rows.length > 0 && (
          <Box
            component="dl"
            sx={{
              m: 0,
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(auto-fit, minmax(240px, 1fr))' },
              gap: { md: '0 24px' },
              borderTop: '2px solid var(--ps-rule)',
            }}
          >
            {rows.map((row) => (
              <Box
                key={row.key}
                sx={{
                  display: 'flex', flexDirection: 'column', gap: '2px', padding: '10px 0', borderBottom: { xs: '2px solid var(--ps-rule)', md: 0 },
                }}
              >
                <Box component="dt" sx={{ fontSize: '13px', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ps-dim)' }}>{row.label}</Box>
                <Box component="dd" sx={{ m: 0, fontSize: '15px', fontWeight: 600 }}>{row.value}</Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Frame>
  );
}
