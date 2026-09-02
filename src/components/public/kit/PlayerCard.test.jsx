import React from 'react';
import { screen } from '@testing-library/react';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import PlayerCard from './PlayerCard';

// Long enough that clipping would matter; the assertions here are structural
// rather than pixel-based (jsdom has no layout), because MUI implements noWrap
// as overflow/text-overflow/white-space, and overflow + text-overflow are inert
// on a non-replaced inline box. The regression #721 introduced was exactly that:
// the name became component="span" (inline), so noWrap silently stopped working.
const LONG_NAME = 'Christian Kirk-Cousins-Longname III';

const renderCard = (player) =>
  renderWithProviders(<PlayerCard player={player} />, { path: '/', route: '/' });

describe('PlayerCard name truncation', () => {
  test('renders the name as a non-heading block element that noWrap can truncate', () => {
    renderCard({ playerId: 7, name: LONG_NAME, position: 'WR', nflTeam: 'JAX' });

    const nameEl = screen.getByText(LONG_NAME);

    // Must stay out of the heading tree. Before #721 the name was an <h6>; the
    // fix restores block formatting without reintroducing a heading.
    expect(screen.queryByRole('heading')).toBeNull();
    expect(nameEl.tagName).not.toMatch(/^H[1-6]$/);

    // Must be a block box. This is the assertion that fails on the broken
    // component="span" state and passes only once the element is a block
    // element (component="p" -> <p>).
    expect(nameEl.tagName).toBe('P');

    // The truncation styling is still requested on the element.
    expect(nameEl).toHaveClass('MuiTypography-noWrap');
  });
});
