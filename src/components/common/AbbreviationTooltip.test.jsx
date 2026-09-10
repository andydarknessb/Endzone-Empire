import React from 'react';
import { screen } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import AbbreviationTooltip, { STAT_DEFINITIONS } from './AbbreviationTooltip';

test.each([
  ['Projected', 'Projected'],
  ['FPTS/G', 'FPTS/G'],
  ['Pos rank', 'Pos rank'],
  ['ADP', 'ADP'],
  ['PF', 'PF'],
  ['PA', 'PA'],
])('%s exposes its shared definition', (term, label) => {
  renderWithProviders(<AbbreviationTooltip term={term} label={label} />);

  expect(screen.getByLabelText(`${label}: ${STAT_DEFINITIONS[term]}`)).toBeInTheDocument();
});

// #1145: AbbreviationTooltip composes its accessible name as `${label}:
// ${definition}`, so a definition that opens with its own term gets that
// term announced twice ("Projected: Projected fantasy points: ..."). This
// checks every STAT_DEFINITIONS entry against the rule, not just the two
// that were caught doubling, so the next entry added can't reintroduce it.
test.each(Object.keys(STAT_DEFINITIONS))('%s does not restate its own term at the start of its definition', (term) => {
  const definition = STAT_DEFINITIONS[term];

  expect(definition.toLowerCase().startsWith(term.toLowerCase())).toBe(false);
});
