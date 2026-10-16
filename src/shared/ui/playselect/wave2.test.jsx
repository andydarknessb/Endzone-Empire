import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import {
  CompactScoreboard, NumbersHelp, OddsBar, TwoSidedOdds,
} from './index';

// The bar's cells are spans with no role, so they are read by their data attribute.
/* eslint-disable testing-library/no-node-access, testing-library/no-container */
const cells = (container) => Array.from(container.querySelectorAll('[role="img"] > span'));
const on = (container) => cells(container).map((c) => c.dataset.on === 'true');

// jsdom drops var() values from computed style, but emotion inserts every rule into document.styleSheets
// under the element's generated class, so this reads that class's own declarations back.
const declared = (el) => {
  const cls = Array.from(el.classList).find((c) => c.startsWith('css-'));
  let text = '';
  Array.from(document.styleSheets).forEach((sheet) => {
    Array.from(sheet.cssRules).forEach((rule) => {
      if (rule.selectorText === `.${cls}`) text += `${rule.style.cssText};`;
    });
  });
  return text;
};

describe('TwoSidedOdds', () => {
  test('has one image whose name carries both teams and both percents, summing to 100', () => {
    renderWithProviders(<TwoSidedOdds a="Darkness Falls" b="Sunday Scaries" pct={62} />);
    expect(screen.getByRole('img', { name: 'Darkness Falls 62%, Sunday Scaries 38% win probability' })).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  test('each side fills from its own end: the leader is filled, the trailer outlined', () => {
    const { container, unmount } = renderWithProviders(<TwoSidedOdds a="A" b="B" pct={60} />);
    expect(cells(container)).toHaveLength(20);
    // a holds 12 cells from the left; b's 8 are the outlined remainder.
    expect(on(container)).toEqual([...Array(12).fill(true), ...Array(8).fill(false)]);
    unmount();
    const { container: flipped } = renderWithProviders(<TwoSidedOdds a="A" b="B" pct={35} />);
    // b leads with 13 cells filled from the right; a's 7 on the left are outlined.
    expect(on(flipped)).toEqual([...Array(7).fill(false), ...Array(13).fill(true)]);
  });

  test('an even game fills the first side and still sums to 100', () => {
    const { container } = renderWithProviders(<TwoSidedOdds a="A" b="B" pct={50} />);
    expect(on(container).filter(Boolean)).toHaveLength(10);
    expect(screen.getByRole('img', { name: 'A 50%, B 50% win probability' })).toBeInTheDocument();
  });

  test('both names and percents show at the ends, with the leader bold', () => {
    renderWithProviders(<TwoSidedOdds a="Away" b="Home" aShort="AWY" bShort="HME" pct={30} />);
    expect(declared(screen.getByText('AWY 30%'))).not.toMatch(/font-weight: 700/);
    expect(declared(screen.getByText('HME 70%'))).toMatch(/font-weight: 700/);
  });

  test('clamps an out-of-range percent', () => {
    renderWithProviders(<TwoSidedOdds a="A" b="B" pct={140} />);
    expect(screen.getByRole('img', { name: 'A 100%, B 0% win probability' })).toBeInTheDocument();
  });

  test('the caption is optional and not part of the accessible name', () => {
    const { unmount } = renderWithProviders(<TwoSidedOdds a="A" b="B" pct={60} />);
    expect(screen.queryByText('Win probability')).toBeNull();
    unmount();
    renderWithProviders(<TwoSidedOdds a="A" b="B" pct={60} caption="Win probability" />);
    expect(screen.getByText('Win probability')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName('A 60%, B 40% win probability');
  });

  test('the leader is Board-lit on Board live, Ink before kickoff, Accent on the page live', () => {
    const lead = (props) => {
      const { container, unmount } = renderWithProviders(<TwoSidedOdds a="A" b="B" pct={60} {...props} />);
      const color = /background-color: ([^;]*)/.exec(declared(cells(container)[0]))[1];
      unmount();
      return color;
    };
    expect(lead({ onBoard: true, live: true })).toBe('var(--ps-board-live)');
    expect(lead({ onBoard: true })).toBe('var(--ps-board-ink)');
    expect(lead({})).toBe('var(--ps-ink)');
    expect(lead({ live: true })).toBe('var(--ps-accent)');
  });

  test('leaves the one-sided OddsBar as it was', () => {
    renderWithProviders(<OddsBar pct={62} name="Darkness Falls" />);
    expect(screen.getByRole('img', { name: 'Darkness Falls win probability 62%' })).toBeInTheDocument();
    expect(screen.getByText(/Endzone Forecast/)).toBeInTheDocument();
  });
});

describe('NumbersHelp', () => {
  const terms = [['Proj', 'Points before the games.'], ['Expected final', 'Points so far plus what is left.']];

  test('is a closed disclosure titled What the numbers mean that opens to a term list', async () => {
    const { container } = renderWithProviders(<NumbersHelp terms={terms} />);
    const details = container.querySelector('details');
    expect(details).not.toHaveAttribute('open');
    await userEvent.click(screen.getByText('What the numbers mean'));
    expect(details).toHaveAttribute('open');
    expect(container.querySelectorAll('dt')).toHaveLength(2);
    expect(screen.getByText('Proj').tagName).toBe('DT');
    expect(screen.getByText('Points before the games.').tagName).toBe('DD');
  });

  test('the summary is a 44px target', () => {
    renderWithProviders(<NumbersHelp terms={terms} />);
    expect(declared(screen.getByText('What the numbers mean').closest('summary'))).toMatch(/min-height: 44px/);
  });

  test('a title other than the default can be given', () => {
    renderWithProviders(<NumbersHelp terms={terms} title="How to read this" />);
    expect(screen.getByText('How to read this')).toBeInTheDocument();
  });
});

describe('CompactScoreboard', () => {
  const props = {
    a: { abbr: 'DF', name: 'Darkness Falls', score: '61.0' },
    b: { abbr: 'SS', name: 'Sunday Scaries', score: '58.9' },
    lead: 'a',
    marginText: 'Darkness Falls by 2.1',
  };

  test('is one group named by the full sentence, 56px tall on Board black', () => {
    renderWithProviders(<CompactScoreboard {...props} />);
    const bar = screen.getByRole('group', { name: 'Darkness Falls 61.0, Sunday Scaries 58.9, Darkness Falls by 2.1' });
    expect(declared(bar)).toMatch(/height: 56px/);
    expect(declared(bar)).toMatch(/background-color: var\(--ps-board\)/);
  });

  test('prints the compact line with the leader in Board ink and the trailer in Board dim', () => {
    renderWithProviders(<CompactScoreboard {...props} />);
    expect(declared(screen.getByText('DF 61.0'))).toMatch(/color: var\(--ps-board-ink\)/);
    expect(declared(screen.getByText('SS 58.9'))).toMatch(/color: var\(--ps-board-dim\)/);
    expect(screen.getByText('Darkness Falls by 2.1')).toBeInTheDocument();
  });

  test('when the other side leads its score takes the ink', () => {
    renderWithProviders(<CompactScoreboard {...props} lead="b" marginText="Sunday Scaries by 2.1" />);
    expect(declared(screen.getByText('SS 58.9'))).toMatch(/color: var\(--ps-board-ink\)/);
    expect(declared(screen.getByText('DF 61.0'))).toMatch(/color: var\(--ps-board-dim\)/);
  });

  test('shows the Live chip only when live', () => {
    const { unmount } = renderWithProviders(<CompactScoreboard {...props} />);
    expect(screen.queryByText('Live')).toBeNull();
    unmount();
    renderWithProviders(<CompactScoreboard {...props} live />);
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  test('has no cursor and no action', () => {
    const { container } = renderWithProviders(<CompactScoreboard {...props} live />);
    expect(container.querySelector('.cursor')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
/* eslint-enable testing-library/no-node-access, testing-library/no-container */
