import React, { useState, useEffect, useId } from 'react';
import { Typography, Box } from '@mui/material';
import { Card, Badge } from '../../shared/ui';
import apiClient from '../../api/apiClient';

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
      width="20"
      height="20"
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

function buildStatChips(facts) {
  if (!facts) return [];
  const chips = [];
  if (facts.highestScorer) {
    chips.push({
      key: 'highestScorer',
      icon: 'flame',
      text: `High score: ${facts.highestScorer.team} (${facts.highestScorer.points})`,
    });
  }
  if (facts.benchBlunder) {
    chips.push({
      key: 'benchBlunder',
      icon: 'fall',
      text: `Bench blunder: ${facts.benchBlunder.team} left ${facts.benchBlunder.pointsLeftOnBench} on the bench`,
    });
  }
  if (facts.waiverSteal) {
    chips.push({
      key: 'waiverSteal',
      icon: 'gem',
      text: `Waiver steal: ${facts.waiverSteal.player} (${facts.waiverSteal.team}) - ${facts.waiverSteal.points} pts`,
    });
  }
  if (facts.closestMatchup && chips.length < 4) {
    chips.push({
      key: 'closestMatchup',
      icon: 'compress',
      text: `Closest game: ${facts.closestMatchup.home} vs ${facts.closestMatchup.away} (margin ${facts.closestMatchup.margin})`,
    });
  }
  if (facts.biggestBlowout && chips.length < 4) {
    chips.push({
      key: 'biggestBlowout',
      icon: 'burst',
      text: `Biggest blowout: ${facts.biggestBlowout.home} vs ${facts.biggestBlowout.away} (margin ${facts.biggestBlowout.margin})`,
    });
  }
  return chips.slice(0, 4);
}

function RecapCard({ leagueId }) {
  const [recap, setRecap] = useState(null);
  const [hidden, setHidden] = useState(true);
  // The card names its own region from its own heading rather than taking an
  // id from the page: it is mounted by more than one caller, and a
  // page-supplied id would have to be threaded through every one of them.
  const headingId = useId();

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

  if (hidden || !recap || !recap.data) {
    return null;
  }

  const { data } = recap;
  const chips = buildStatChips(data.facts);

  return (
    <Card data-testid="recap-card" aria-labelledby={headingId} sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
        <Typography
          id={headingId}
          variant="h6"
          component="h2"
          sx={{ fontFamily: 'var(--dash-font-display)' }}
        >
          Weekly Recap
        </Typography>
        {recap.week != null && <Badge>{`Week ${recap.week}`}</Badge>}
      </Box>
      <Typography
        variant="body1"
        sx={{ mb: chips.length ? 2 : 0, whiteSpace: 'pre-line', fontFamily: 'var(--dash-font-body)' }}
      >
        {data.narrative}
      </Typography>
      {chips.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {chips.map((chip) => (
            <Badge
              key={chip.key}
              // A recap fact is a whole sentence, not a status word: the chip
              // label's default `nowrap` ellipsised it mid-word at phone
              // widths, and `height: auto` is what lets the wrapped lines
              // actually take vertical space.
              sx={{
                height: 'auto',
                '& .MuiChip-label': { px: 1.25, py: 0.75, whiteSpace: 'normal' },
              }}
            >
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                <FactIcon name={chip.icon} />
                {/* A fact is running copy, so it keeps the body tier rather
                    than the badge's own label type (11.5px, tracked, dim). */}
                <Typography
                  component="span"
                  variant="body2"
                  sx={{ color: 'var(--dash-ink)', fontFamily: 'var(--dash-font-body)' }}
                >
                  {chip.text}
                </Typography>
              </Box>
            </Badge>
          ))}
        </Box>
      )}
    </Card>
  );
}

export default RecapCard;
