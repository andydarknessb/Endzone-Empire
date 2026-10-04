import React, { useState, useEffect, useId, useLayoutEffect, useRef } from 'react';
import { Alert, Typography, Box, Button } from '@mui/material';
import { Card } from '../../shared/ui';
import apiClient from '../../api/apiClient';
import { useLeague } from '../../hooks/useLeague';
import { readHttpFailure } from '../../lib/httpFailure';

// The recap facts' glyphs as inline stroke icons on the 20px grid (1.6 stroke,
// round caps, currentColor), replacing the emoji that used to prefix each fact.
// Decorative in every use: the fact sentence beside the icon already names it,
// so each is aria-hidden and exposes only a `data-icon` for a test to read.
const FACT_ICONS = {
  flame: <path d="M10 3s4 3.5 4 7a4 4 0 0 1-8 0c0-1.7 1-3 2-4 0 1.5.6 2.3 1.4 2.6C9.1 6.6 10 5 10 3z" />,
  fall: (
    <>
      <path d="M3 6.5 7.5 11l3-3L16 13.5" />
      <path d="M16 10v3.5h-3.5" />
    </>
  ),
  gem: (
    <>
      <path d="M4 8l3-4h6l3 4-6 8z" />
      <path d="M4 8h12" />
    </>
  ),
  compress: (
    <>
      <path d="M3 10h14" />
      <path d="M6.5 6.5 3 10l3.5 3.5" />
      <path d="M13.5 6.5 17 10l-3.5 3.5" />
    </>
  ),
  burst: (
    <>
      <path d="M10 3v3M10 14v3M3 10h3M14 10h3" />
      <path d="M5.4 5.4l2.1 2.1M12.5 12.5l2.1 2.1M14.6 5.4l-2.1 2.1M7.5 12.5l-2.1 2.1" />
    </>
  ),
};

function FactIcon({ name }) {
  return (
    <Box
      component="svg"
      // Numbers, not strings. Box consumes width/height as system props, and a
      // bare string is passed straight through as a CSS value: `width: "20"`
      // carries no unit, so it is dropped and no attribute reaches the element
      // either, leaving the glyph to render at its own scale. A number becomes
      // `20px`. The same mistake sized the League History medals at ~90px.
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
      sx={{ flex: 'none' }}
    >
      {FACT_ICONS[name]}
    </Box>
  );
}

// The fact rows (#1988 L22): a bold label and a value, joined by middots where
// the old pills used parentheses, hyphens and "margin N" (ADR 0016). The two
// halves stay separate so the row can lay the value under the label at phone
// width. At most four rows, in this order. "by" and the margin are joined by a
// non-breaking space so a wrapped value never strands the number alone.
const MIDDOT = ' · ';

function buildFactRows(facts) {
  if (!facts) return [];
  const rows = [];
  if (facts.highestScorer) {
    rows.push({
      key: 'highestScorer',
      icon: 'flame',
      label: 'High score',
      value: [facts.highestScorer.team, facts.highestScorer.points].join(MIDDOT),
    });
  }
  if (facts.benchBlunder) {
    rows.push({
      key: 'benchBlunder',
      icon: 'fall',
      label: 'Bench blunder',
      value: [facts.benchBlunder.team, `${facts.benchBlunder.pointsLeftOnBench} left on the bench`].join(MIDDOT),
    });
  }
  if (facts.waiverSteal) {
    rows.push({
      key: 'waiverSteal',
      icon: 'gem',
      label: 'Waiver steal',
      value: [facts.waiverSteal.player, facts.waiverSteal.team, `${facts.waiverSteal.points} pts`].join(MIDDOT),
    });
  }
  if (facts.closestMatchup && rows.length < 4) {
    rows.push({
      key: 'closestMatchup',
      icon: 'compress',
      label: 'Closest game',
      value: [`${facts.closestMatchup.home} vs ${facts.closestMatchup.away}`, `by\u00a0${facts.closestMatchup.margin}`].join(
        MIDDOT
      ),
    });
  }
  if (facts.biggestBlowout && rows.length < 4) {
    rows.push({
      key: 'biggestBlowout',
      icon: 'burst',
      label: 'Biggest blowout',
      value: [`${facts.biggestBlowout.home} vs ${facts.biggestBlowout.away}`, `by\u00a0${facts.biggestBlowout.margin}`].join(
        MIDDOT
      ),
    });
  }
  return rows.slice(0, 4);
}

// "Dec 29, 3:00 AM": month short, day, hour, minute. No seconds and no year, so
// the stamp reads as a fact and not a log line.
const GENERATED_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** The facts as a compact list, ruled with 1px `dash-line` hairlines, 13px. */
function FactRows({ rows }) {
  return (
    <Box component="ul" role="list" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {rows.map((row, i) => (
        <Box
          component="li"
          key={row.key}
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            py: '8px',
            fontSize: '13px',
            lineHeight: 1.4,
            borderTop: i === 0 ? 0 : '1px solid var(--dash-line)',
          }}
        >
          <Box sx={{ color: 'var(--dash-dim)', display: 'flex', pt: '1px' }}>
            <FactIcon name={row.icon} />
          </Box>
          {/* Label and value share a line while they fit; a value too long for
              the room left wraps whole under the label (flex-wrap) instead of
              ellipsising mid-name at phone width. */}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: '8px', flex: '1 1 0', minWidth: 0 }}>
            <Box component="span" sx={{ fontWeight: 700, color: 'var(--dash-ink)' }}>
              {row.label}
            </Box>
            <Box component="span" sx={{ color: 'var(--dash-dim)', minWidth: 0, overflowWrap: 'anywhere' }}>
              {row.value}
            </Box>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

const CLAMPED_SX = {
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

/**
 * The narrative, clamped to 3 lines until the reader opens it (#1988 L21), and
 * the footer row under it: the toggle (only when the text really overflows 3
 * lines) beside the generated stamp. Overflow is measured, not guessed from the
 * character count: `scrollHeight > clientHeight` on the clamped element after
 * layout, re-checked when its box resizes (a ResizeObserver, where the browser
 * has one) and once the web fonts land (a font swap re-wraps the text without
 * resizing the box), and again whenever the text changes. Once open the clamp is
 * gone and nothing overflows, so the measurement is skipped and the toggle
 * stays.
 *
 * A new narrative (a commissioner rebuild) starts collapsed. If the toggle held
 * keyboard focus when a re-measure removes it, focus moves to the narrative
 * (tabIndex -1) rather than falling to <body>.
 */
function RecapNarrative({ text, generatedAt }) {
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
      <Typography
        id={narrativeId}
        ref={ref}
        tabIndex={-1}
        variant="body1"
        sx={{
          whiteSpace: 'pre-line',
          fontFamily: 'var(--dash-font-body)',
          fontSize: '14px',
          lineHeight: 1.5,
          // Focused only by script (the toggle's hand-off above), never a tab stop.
          outline: 'none',
          ...(expanded ? null : CLAMPED_SX),
        }}
      >
        {text}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 2, mt: '4px' }}>
        {(overflows || expanded) && (
          <Button
            ref={toggleRef}
            type="button"
            data-testid="recap-toggle"
            aria-expanded={expanded}
            aria-controls={narrativeId}
            onClick={() => setExpanded((open) => !open)}
            sx={{
              minHeight: 44,
              px: '6px',
              ml: '-6px',
              textTransform: 'none',
              color: 'var(--dash-accent)',
              fontFamily: 'var(--dash-font-body)',
              fontWeight: 600,
              fontSize: '13px',
            }}
          >
            {expanded ? 'Show less' : 'Read the full recap'}
          </Button>
        )}
        {generatedAt && (
          <Typography component="p" sx={{ m: 0, ml: 'auto', fontSize: '12px', color: 'var(--dash-faint)' }}>
            {`Generated ${generatedAt}`}
          </Typography>
        )}
      </Box>
    </>
  );
}

function RecapCard({ leagueId }) {
  const [recap, setRecap] = useState(null);
  const [hidden, setHidden] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildError, setRebuildError] = useState(null);
  // The commissioner flag rides the same shared league cache the page itself
  // reads (useLeague / ADR 0004, the useCommissionerStrip pattern): no new
  // endpoint and no second request in practice, since the page's own
  // useLeague(leagueId) call already primed this key. Read from
  // `is_commissioner`, the one field GET /api/league/:id adds for the viewer's
  // role - never `invite_code`, which answers a different question.
  const { league } = useLeague(leagueId);
  const isCommissioner = !!league?.is_commissioner;
  // The rebuild is scoped to "a chosen finalized week of the CURRENT season"
  // (#1412's acceptance criteria). GET /recap has no current-season filter
  // (getLatestRecap orders by season DESC), so between a rollover and that
  // league's first recap of the new season the card can be showing an OLDER
  // season's recap; offering the control there would rebuild the wrong
  // season's week (the route resolves season from leagues.current_season,
  // not from what's on screen). Gated off league.current_season, the same
  // payload the commissioner flag above already reads.
  const isCurrentSeasonRecap = league?.current_season != null && recap?.season === league.current_season;

  useEffect(() => {
    let cancelled = false;

    const fetchRecap = async () => {
      try {
        const res = await apiClient.get(`/api/scoring/league/${leagueId}/recap`);
        if (!cancelled) {
          setRecap(res.data);
          setHidden(false);
        }
      } catch (err) {
        if (!cancelled) {
          setRecap(null);
          setHidden(true);
        }
      }
    };

    fetchRecap();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  // Commissioner-only: rebuilds the recap currently on screen from current
  // data (#1412), the silent compute-and-store path - no feed entry, no
  // member notification. The response is the same { season, week, data }
  // shape the GET returns, so it replaces the displayed recap outright.
  const handleRebuild = async () => {
    if (!recap || recap.week == null || !isCurrentSeasonRecap || rebuilding) return;
    setRebuilding(true);
    setRebuildError(null);
    try {
      const res = await apiClient.post(`/api/scoring/league/${leagueId}/recap`, {
        week: recap.week,
        season: recap.season,
      });
      setRecap(res.data);
    } catch (err) {
      setRebuildError(readHttpFailure(err).message || err?.message || 'Could not rebuild the recap.');
    } finally {
      setRebuilding(false);
    }
  };

  if (hidden || !recap || !recap.data) {
    return null;
  }

  const { data } = recap;
  const rows = buildFactRows(data.facts);
  // When the displayed recap was last generated, so a manager can tell
  // whether it predates a correction (#1412). Visible to every member, not
  // just the commissioner who can act on it.
  const generatedAt = data.generatedAt ? GENERATED_FORMAT.format(new Date(data.generatedAt)) : null;

  // The shared Card names its own region from its title (a labelled landmark),
  // so this card needs no heading id of its own to thread through.
  return (
    <Card
      data-testid="recap-card"
      title={recap.week != null ? `Week ${recap.week} Recap` : 'Weekly Recap'}
      tail={
        isCommissioner && isCurrentSeasonRecap ? (
          <Button
            type="button"
            data-testid="recap-rebuild"
            variant="outlined"
            size="small"
            disabled={rebuilding}
            onClick={handleRebuild}
            sx={{
              minHeight: 44,
              textTransform: 'none',
              color: 'var(--dash-ink)',
              borderColor: 'var(--dash-line-strong)',
              borderRadius: 'var(--dash-radius-sm)',
              fontFamily: 'var(--dash-font-body)',
              fontWeight: 600,
              fontSize: '13px',
              '&:hover': {
                borderColor: 'var(--dash-accent-line)',
                backgroundColor: 'transparent',
              },
            }}
          >
            {rebuilding ? 'Rebuilding...' : 'Rebuild recap'}
          </Button>
        ) : undefined
      }
    >
      <Box sx={{ px: '18px', py: '12px' }}>
        {rebuildError && (
          <Alert severity="error" sx={{ fontSize: '13px', mb: 1 }}>
            {rebuildError}
          </Alert>
        )}
        {rows.length > 0 && (
          <Box sx={{ mb: '10px', pb: '2px', borderBottom: '1px solid var(--dash-line)' }}>
            <FactRows rows={rows} />
          </Box>
        )}
        <RecapNarrative text={data.narrative} generatedAt={generatedAt} />
      </Box>
    </Card>
  );
}

export default RecapCard;
