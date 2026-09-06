import React from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, useLocation } from 'react-router-dom';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import { colorTokens } from '../../../theme/tokens';
import BenchWhatIf, { swapLineupHref } from '../index';

// The card never talks to the server (ADR 0019: the action is a link to the
// Lineup page, never a swap). The client is mocked so the link case can assert
// that no mutation fires when the action is used.
jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

afterEach(() => {
  jest.clearAllMocks();
});

const WHAT_IF = {
  delta: 11.3,
  swaps: [
    {
      out: { playerId: 101, name: 'D. Adams', points: 0 },
      in: { playerId: 202, name: 'J. Waddle', points: 11.3 },
      gain: 11.3,
    },
    {
      out: { playerId: 303, name: 'T. Hill', points: 4.2 },
      in: { playerId: 404, name: 'R. Rice', points: 6 },
      gain: 1.8,
    },
  ],
};

// Echoes where the router landed, so a click on the action proves it navigates
// to the Lineup page with the swap in the query.
function LocationEcho() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{`${pathname}${search}`}</div>;
}

const renderCard = (props = {}) =>
  renderWithProviders(<BenchWhatIf leagueId={7} hasRoster whatIf={WHAT_IF} {...props} />, {
    route: '/league/7/matchups/55',
    path: '/league/:leagueId/matchups/:matchupId',
    routes: <Route path="/league/:leagueId/lineup" element={<LocationEcho />} />,
  });

test('renders nothing without a what-if, and nothing without a roster', () => {
  const { container: noWhatIf, unmount } = renderCard({ whatIf: null });
  expect(noWhatIf).toBeEmptyDOMElement();
  expect(screen.queryByTestId('bench-what-if')).not.toBeInTheDocument();
  unmount();

  const { container: noRoster } = renderCard({ hasRoster: false });
  expect(noRoster).toBeEmptyDOMElement();
  expect(screen.queryByTestId('bench-what-if')).not.toBeInTheDocument();
});

test('renders the headline delta and the first swap row', () => {
  renderCard();

  const card = screen.getByTestId('bench-what-if');
  expect(within(card).getByTestId('bench-what-if-headline')).toHaveTextContent(
    '+11.3 still on your bench'
  );
  expect(within(card).getByText('Locked players cannot be swapped.')).toBeInTheDocument();

  const row = within(card).getByTestId('bench-what-if-swap');
  const out = within(row).getByTestId('bench-what-if-out');
  expect(out).toHaveTextContent('D. Adams 0.0');
  expect(out.style.textDecoration).toBe('line-through');
  expect(within(row).getByTestId('bench-what-if-in')).toHaveTextContent('J. Waddle 11.3');
  expect(within(row).getByTestId('bench-what-if-gain')).toHaveTextContent('+11.3');

  // Only the first swap is shown, the way the canvas shows it.
  expect(within(card).queryByText(/T\. Hill/)).not.toBeInTheDocument();
  expect(within(card).queryByText(/R\. Rice/)).not.toBeInTheDocument();
});

test('the action is a link to the Lineup page naming the swap, never a mutation', async () => {
  const user = userEvent.setup();
  renderCard();

  const card = screen.getByTestId('bench-what-if');
  // A link, not a button: the swap happens on the Lineup page (ADR 0019).
  const link = within(card).getByRole('link', { name: 'Swap in lineup' });
  expect(link).toHaveAttribute('href', '/league/7/lineup?swapOut=101&swapIn=202');
  expect(within(card).queryByRole('button')).not.toBeInTheDocument();

  await user.click(link);

  expect(screen.getByTestId('location')).toHaveTextContent(
    '/league/7/lineup?swapOut=101&swapIn=202'
  );
  expect(apiClient.post).not.toHaveBeenCalled();
  expect(apiClient.put).not.toHaveBeenCalled();
  expect(apiClient.patch).not.toHaveBeenCalled();
  expect(apiClient.delete).not.toHaveBeenCalled();
});

test.each([0, -2.5])('a delta of %s renders the best legal lineup line and no action', (delta) => {
  renderCard({ whatIf: { ...WHAT_IF, delta } });

  const card = screen.getByTestId('bench-what-if');
  expect(within(card).getByTestId('bench-what-if-headline')).toHaveTextContent(
    'Your best legal lineup is already active.'
  );
  expect(within(card).queryByText(/still on your bench/)).not.toBeInTheDocument();
  expect(within(card).queryByText('Locked players cannot be swapped.')).not.toBeInTheDocument();
  expect(within(card).queryByTestId('bench-what-if-swap')).not.toBeInTheDocument();
  expect(within(card).queryByRole('link')).not.toBeInTheDocument();
  expect(within(card).queryByRole('button')).not.toBeInTheDocument();
});

test('a positive delta with no swap that names both players renders the headline and no action', () => {
  renderCard({ whatIf: { delta: 3.2, swaps: [{ out: { playerId: 1, name: 'A' }, in: null }] } });

  const card = screen.getByTestId('bench-what-if');
  expect(within(card).getByTestId('bench-what-if-headline')).toHaveTextContent(
    '+3.2 still on your bench'
  );
  expect(within(card).queryByTestId('bench-what-if-swap')).not.toBeInTheDocument();
  expect(within(card).queryByRole('link')).not.toBeInTheDocument();
});

test('a points figure that is not a number is left off the row rather than printed as NaN', () => {
  renderCard({
    whatIf: {
      delta: 4,
      swaps: [
        {
          out: { playerId: 1, name: 'D. Adams', points: null },
          in: { playerId: 2, name: 'J. Waddle', points: 'n/a' },
          gain: undefined,
        },
      ],
    },
  });

  const row = screen.getByTestId('bench-what-if-swap');
  expect(within(row).getByTestId('bench-what-if-out')).toHaveTextContent(/^D\. Adams$/);
  expect(within(row).getByTestId('bench-what-if-in')).toHaveTextContent(/^J\. Waddle$/);
  expect(within(row).queryByTestId('bench-what-if-gain')).not.toBeInTheDocument();
  expect(row).not.toHaveTextContent('NaN');
});

test('titles the card with a heading that labels it as a region', () => {
  renderCard();

  const heading = screen.getByRole('heading', { name: 'Bench what-if' });
  expect(heading.tagName).toBe('H2');
  expect(screen.getByRole('region', { name: 'Bench what-if' })).toBe(
    screen.getByTestId('bench-what-if')
  );
});

test('honours an explicit heading level so the page can sit it below its own title', () => {
  renderCard({ headingLevel: 3 });

  expect(screen.getByRole('heading', { name: 'Bench what-if' }).tagName).toBe('H3');
});

test('swapLineupHref names the swap in the query and encodes the ids', () => {
  expect(swapLineupHref(7, WHAT_IF.swaps[0])).toBe('/league/7/lineup?swapOut=101&swapIn=202');
  expect(swapLineupHref(12, { out: { playerId: 'a b' }, in: { playerId: 'c&d' } })).toBe(
    '/league/12/lineup?swapOut=a+b&swapIn=c%26d'
  );
});

// The card paints only `dash-*` tokens (tokens.js: island slices use the
// `dash-*` group, never an app token), and the warning pair it names is
// registered in tokens.contrast.test.js, where its legibility is measured in
// both themes. jsdom cannot read a token back off a rendered element (MUI
// compiles `var()` to an emotion class and the CSSOM drops it, on inline
// style too; see the note in GradeChip.test.jsx), so what this pins is that
// the pair the card paints exists in both token groups: removing or renaming
// it in tokens.js would leave the border and chip on `currentColor`, and this
// suite goes red for it alongside the contrast guard.
test.each(['light', 'dark'])(
  'the warning pair the card paints exists in the %s token group',
  (mode) => {
    expect(colorTokens[mode]['dash-warning']).toEqual(expect.any(String));
    expect(colorTokens[mode]['dash-warning-soft']).toEqual(expect.any(String));
  }
);
