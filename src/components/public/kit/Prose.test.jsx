import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Prose, { Link, Table, TBody, TR, TD } from './Prose';

// Article bodies are plain JSX with no router knowledge of their own, so the
// primitive has to be the thing that keeps an in-app hop inside the SPA. A bare
// <a href="/strategy/..."> would full-page reload and drop the app shell.
const renderInRouter = (ui) => render(<MemoryRouter><Prose>{ui}</Prose></MemoryRouter>);

test('an internal link stays inside the client router', () => {
  renderInRouter(<p><Link to="/strategy/draft-by-tiers">draft by tiers</Link></p>);

  const link = screen.getByRole('link', { name: 'draft by tiers' });
  expect(link).toHaveAttribute('href', '/strategy/draft-by-tiers');
  expect(link).not.toHaveAttribute('target');
});

test('an external link leaves the app safely, without the caller remembering rel', () => {
  renderInRouter(<p><Link to="https://www.fantasyfootballcalculator.com/adp/ppr">ADP</Link></p>);

  const link = screen.getByRole('link', { name: 'ADP' });
  expect(link).toHaveAttribute('href', 'https://www.fantasyfootballcalculator.com/adp/ppr');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
});

// A six-column cheat sheet is wider than a phone viewport. Without a scroll
// container the overflow propagates to the document and the whole page scrolls
// sideways, so the wrapper is load-bearing rather than cosmetic.
test('a table is wrapped in its own scroll container', () => {
  render(
    <MemoryRouter>
      <Prose>
        <Table><TBody><TR><TD>wide</TD></TR></TBody></Table>
      </Prose>
    </MemoryRouter>
  );

  const table = screen.getByRole('table');
  // The wrapper element IS the assertion here, and Testing Library queries
  // deliberately cannot express "the parent of this node", so node access is
  // the only way to test the structure this fix introduces.
  // eslint-disable-next-line testing-library/no-node-access
  const wrapper = table.parentElement;
  expect(wrapper).not.toBeNull();
  expect(getComputedStyle(wrapper).overflowX).toBe('auto');
});
