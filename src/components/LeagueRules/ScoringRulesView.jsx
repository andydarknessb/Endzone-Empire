import React, { useRef } from 'react';
import { Box } from '@mui/material';
import { Tag } from '../../shared/ui/playselect/Marks';
import { PsButton } from '../../shared/ui/playselect/Controls';
import { Dim, RulesTable, SectionTitle, TagRow } from './rulesParts';
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
import { prefersReducedMotion } from '../../lib/reducedMotionMedia';

const sectionId = (category) => `scoring-section-${category}`;

function PointsCell({ value }) {
  const points = Number(value);
  // Zeros are meaningful here ("receptions score nothing in this league"), so
  // they're de-emphasised rather than dimmed out of contrast range.
  return (
    <td className="num" style={{ color: points ? 'var(--ps-ink)' : 'var(--ps-dim)' }}>
      {formatPoints(value)}
    </td>
  );
}

function TierTable({ statKey, tiers }) {
  const hasPerYard = tiers.some((t) => t.pointsPerYardOverMin !== undefined);
  const label = TIER_LABELS[statKey] || statKey;
  return (
    <Box sx={{ mt: '16px' }}>
      <Box sx={{ fontSize: '15px', fontWeight: 600, mb: '4px' }}>{label}</Box>
      <RulesTable label={label}>
        <thead>
          <tr>
            <th>Range</th>
            <th className="num">Points</th>
            {hasPerYard && <th className="num">Per yard over min</th>}
          </tr>
        </thead>
        <tbody>
          {tiers.map((tier, i) => (
            <tr key={`${statKey}-${i}`}>
              <td>{tierRangeLabel(tier)}</td>
              <PointsCell value={tier.points} />
              {hasPerYard && (
                <td className="num">
                  {tier.pointsPerYardOverMin === undefined ? '-' : formatPoints(tier.pointsPerYardOverMin)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </RulesTable>
    </Box>
  );
}

const CategorySection = React.forwardRef(function CategorySection({ category, values }, ref) {
  const entries = Object.entries(values);
  const scalars = entries.filter(([, value]) => !Array.isArray(value));
  const tiers = entries.filter(([, value]) => Array.isArray(value));
  const label = CATEGORY_LABELS[category] || category;

  return (
    <Box component="section" ref={ref} aria-labelledby={sectionId(category)} sx={{ mb: '32px', scrollMarginTop: 16 }}>
      <SectionTitle id={sectionId(category)}>{label}</SectionTitle>
      {scalars.length > 0 && (
        <RulesTable label={`${label} scoring`}>
          <thead>
            <tr>
              <th>Stat</th>
              <th className="num">Points</th>
            </tr>
          </thead>
          <tbody>
            {scalars.map(([key, value]) => {
              const helper = perYardHelper(key, value);
              return (
                <tr key={key}>
                  <td>
                    {LEAF_LABELS[key] || key}
                    {helper && (
                      <Box component="span" sx={{ ml: '8px', fontSize: '14px', color: 'var(--ps-dim)' }}>
                        {helper}
                      </Box>
                    )}
                  </td>
                  <PointsCell value={value} />
                </tr>
              );
            })}
          </tbody>
        </RulesTable>
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
    sectionRefs.current[category]?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  return (
    <Box>
      <TagRow sx={{ mb: '16px' }}>
        <Dim component="span">Scoring format:</Dim>
        <Tag>{formatLabel}</Tag>
        {customized && <Tag>Customized</Tag>}
        {league.dp_enabled && <Tag>IDP enabled</Tag>}
      </TagRow>

      {categories.length > 1 && (
        <TagRow component="nav" aria-label="Jump to a scoring category" sx={{ mb: '24px' }}>
          {categories.map((category) => (
            <PsButton key={category} variant="ghost" onClick={() => jumpTo(category)}>
              {CATEGORY_LABELS[category] || category}
            </PsButton>
          ))}
        </TagRow>
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
        <Dim>
          Individual defensive players (IDP) aren&apos;t enabled in this league, so those stats don&apos;t score.
        </Dim>
      )}
    </Box>
  );
}
