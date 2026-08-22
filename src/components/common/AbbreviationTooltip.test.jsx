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
