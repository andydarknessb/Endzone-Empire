import React, { useRef } from 'react';
import {
  Box, Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import {
  RULE_CATEGORIES,
  CATEGORY_LABELS,
  LEAF_LABELS,
  TIER_LABELS,
  perYardHelper,
  buildInitialRules,
  receptionFormatLabel,
  tierRangeLabel,
  formatPoints,
} from '../../lib/leagueRulesFormat';

const sectionId = (category) => `scoring-section-${category}`;

function PointsCell({ value }) {
  const points = Number(value);
  // Zeros are meaningful here ("receptions score nothing in this league"), so
  // they're de-emphasised rather than dimmed out of contrast range.
  return (
    <TableCell
      align="right"
      sx={{ color: points ? 'text.primary' : 'text.secondary', whiteSpace: 'nowrap' }}
    >
      {formatPoints(value)}
    </TableCell>
  );
}

function TierTable({ statKey, tiers }) {
  const hasPerYard = tiers.some((t) => t.pointsPerYardOverMin !== undefined);
  const label = TIER_LABELS[statKey] || statKey;
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>{label}</Typography>
      <Table size="small" aria-label={label}>
        <TableHead>
          <TableRow>
            <TableCell>Range</TableCell>
            <TableCell align="right">Points</TableCell>
            {hasPerYard && <TableCell align="right">Per yard over min</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {tiers.map((tier, i) => (
            <TableRow key={`${statKey}-${i}`}>
              <TableCell>{tierRangeLabel(tier)}</TableCell>
              <PointsCell value={tier.points} />
              {hasPerYard && (
                <TableCell align="right">
                  {tier.pointsPerYardOverMin === undefined ? '-' : formatPoints(tier.pointsPerYardOverMin)}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

const CategorySection = React.forwardRef(function CategorySection({ category, values }, ref) {
  const entries = Object.entries(values);
  const scalars = entries.filter(([, value]) => !Array.isArray(value));
  const tiers = entries.filter(([, value]) => Array.isArray(value));
  const label = CATEGORY_LABELS[category] || category;

  return (
    <Box component="section" ref={ref} aria-labelledby={sectionId(category)} sx={{ mb: 4, scrollMarginTop: 16 }}>
      <Typography id={sectionId(category)} variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        {label}
      </Typography>
      {scalars.length > 0 && (
        <Table size="small" aria-label={`${label} scoring`}>
          <TableHead>
            <TableRow>
              <TableCell>Stat</TableCell>
              <TableCell align="right">Points</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {scalars.map(([key, value]) => {
              const helper = perYardHelper(key, value);
              return (
                <TableRow key={key}>
                  <TableCell>
                    {LEAF_LABELS[key] || key}
                    {helper && (
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        {helper}
                      </Typography>
                    )}
                  </TableCell>
                  <PointsCell value={value} />
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {tiers.map(([key, value]) => <TierTable key={key} statKey={key} tiers={value} />)}
    </Box>
  );
});

export default function ScoringRulesView({ league, defaults }) {
  const rules = buildInitialRules(defaults, league.scoring_rules);
  const sectionRefs = useRef({});

  // Describe the scoring the league actually uses. `scoring_preset` is null on
  // a brand new league and 'custom' as soon as any rule is overridden, so the
  // reception rate is the more truthful source for the format name.
  const receptionRate = Number(rules?.receiving?.reception);
  const formatLabel = receptionFormatLabel(rules)
    || (Number.isFinite(receptionRate) ? `${formatPoints(receptionRate)} pts / reception` : 'Custom');
  const customized = !!league.scoring_rules && Object.keys(league.scoring_rules).length > 0;

  // IDP stats only score when the league has defensive players enabled.
  const categories = RULE_CATEGORIES.filter((c) => c in rules && (c !== 'idp' || league.dp_enabled));

  const jumpTo = (category) => {
    sectionRefs.current[category]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary">Scoring format:</Typography>
        <Chip size="small" label={formatLabel} />
        {customized && <Chip size="small" label="Customized" color="warning" variant="outlined" />}
        {league.dp_enabled && <Chip size="small" label="IDP enabled" color="primary" variant="outlined" />}
      </Stack>

      {categories.length > 1 && (
        <Stack
          direction="row"
          spacing={1}
          flexWrap="wrap"
          useFlexGap
          component="nav"
          aria-label="Jump to a scoring category"
          sx={{ mb: 3 }}
        >
          {categories.map((category) => (
            <Chip
              key={category}
              size="small"
              variant="outlined"
              clickable
              label={CATEGORY_LABELS[category] || category}
              onClick={() => jumpTo(category)}
            />
          ))}
        </Stack>
      )}

      {categories.map((category) => (
        <CategorySection
          key={category}
          category={category}
          values={rules[category]}
          ref={(node) => { sectionRefs.current[category] = node; }}
        />
      ))}

      {!league.dp_enabled && 'idp' in rules && (
        <Typography variant="body2" color="text.secondary">
          Individual defensive players (IDP) aren&apos;t enabled in this league, so those stats don&apos;t score.
        </Typography>
      )}
    </Box>
  );
}
