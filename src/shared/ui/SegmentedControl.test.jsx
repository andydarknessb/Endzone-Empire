import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SegmentedControl } from './index';

const WEEKS = [
  { value: 1, label: 'Wk 1' },
  { value: 2, label: 'Wk 2' },
  { value: 3, label: 'Wk 3' },
];

test('is a radio group whose checked option matches value', () => {
  render(<SegmentedControl aria-label="Week" options={WEEKS} value={2} onChange={() => {}} />);
  expect(screen.getByRole('radiogroup', { name: 'Week' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Wk 2' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Wk 1' })).not.toBeChecked();
  expect(screen.getByRole('radio', { name: 'Wk 3' })).not.toBeChecked();
});

test('clicking an option calls onChange with that option', async () => {
  const onChange = jest.fn();
  render(<SegmentedControl aria-label="Week" options={WEEKS} value={2} onChange={onChange} />);
  await userEvent.click(screen.getByRole('radio', { name: 'Wk 3' }));
  expect(onChange).toHaveBeenCalledWith(3);
});

test('arrow keys move the selection and wrap', async () => {
  const onChange = jest.fn();
  render(<SegmentedControl aria-label="Week" options={WEEKS} value={3} onChange={onChange} />);
  screen.getByRole('radio', { name: 'Wk 3' }).focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(onChange).toHaveBeenLastCalledWith(1);
  await userEvent.keyboard('{ArrowLeft}');
  expect(onChange).toHaveBeenLastCalledWith(2);
});

test('renders an option icon as decoration beside its label', () => {
  render(
    <SegmentedControl
      aria-label="Matchup view"
      options={[{ value: 'standard', label: 'Standard', icon: <svg data-testid="icon" /> }]}
      value="standard"
      onChange={() => {}}
    />
  );
  expect(screen.getByTestId('icon')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Standard' })).toBeChecked();
});

// Red-tell (#903): dropping the forwardRef (a plain function component) leaves
// `ref.current` null and turns this red.
test('forwards a ref to the radio group element, so a composer can reach the checked option', () => {
  const ref = React.createRef();
  render(<SegmentedControl ref={ref} aria-label="Week" options={WEEKS} value={2} onChange={() => {}} />);
  expect(ref.current).toBe(screen.getByRole('radiogroup', { name: 'Week' }));
  expect(within(ref.current).getByRole('radio', { checked: true })).toBe(screen.getByRole('radio', { name: 'Wk 2' }));
});

// --- scrollable (#916) -------------------------------------------------------

// A season of weeks: 18 segments are what a phone row cannot stretch to hold,
// so the crowded case is the case under test.
const SEASON = Array.from({ length: 18 }, (_, i) => ({ value: i + 1, label: `Wk ${i + 1}` }));

// The layout is an sx rule, which jsdom neither lays out nor computes (a
// `flex` shorthand never reaches getComputedStyle here), but emotion inserts
// every rule into `document.styleSheets` under the generated class name. This
// reads one element's own declarations back.
const ruleFor = (el) => {
  const cls = Array.from(el.classList).find((c) => c.startsWith('css-'));
  let text = '';
  Array.from(document.styleSheets).forEach((sheet) => {
    Array.from(sheet.cssRules).forEach((rule) => {
      if (rule.selectorText === `.${cls}`) text += `${rule.style.cssText};`;
    });
  });
  return text;
};

// Red-tell (#916): giving the scrollable segments the fill rule
// (`flex: 1 1 0`) turns this case red and no other; the fill case below reads
// its own rule and stays green. jsdom carries no `scrollIntoView`, so this
// case also proves the effect's guard keeps an unstubbed render alive.
test('scrollable scrolls the group sideways and leaves every segment its own width', () => {
  render(<SegmentedControl aria-label="Week" options={SEASON} value={9} onChange={() => {}} scrollable />);
  const group = ruleFor(screen.getByRole('radiogroup', { name: 'Week' }));
  expect(group).toMatch(/overflow-x: auto/);
  expect(group).toMatch(/min-width: 0/);
  expect(group).toMatch(/overscroll-behavior-x: contain/);
  expect(group).toMatch(/scrollbar-width: none/);
  expect(ruleFor(screen.getByRole('radio', { name: 'Wk 9' }))).toMatch(/[^-]flex: 0 0 auto/);
});

// Red-tell (#916): making `scrollable` change what `fill` emits (segments at
// `flex: 0 0 auto`, say) turns this case red; it is the view toggle's rule.
test('fill still stretches its segments across the group', () => {
  render(
    <SegmentedControl
      aria-label="Matchup view"
      options={[{ value: 'standard', label: 'Standard' }, { value: 'scoreboard', label: 'Scoreboard' }]}
      value="standard"
      onChange={() => {}}
      fill
    />
  );
  expect(ruleFor(screen.getByRole('radio', { name: 'Standard' }))).toMatch(/[^-]flex: 1 1 0/);
});

// Red-tell (#916): dropping the effect, or scrolling the group's first
// segment instead of the checked one, turns this red. jsdom implements no
// `scrollIntoView`, so the stub is both the spy and the implementation.
test('scrollable brings the checked segment into view on mount and whenever value changes', () => {
  const seen = [];
  Element.prototype.scrollIntoView = function scrollIntoView(options) { seen.push([this, options]); };
  try {
    const { rerender } = render(<SegmentedControl aria-label="Week" options={SEASON} value={9} onChange={() => {}} scrollable />);
    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toBe(screen.getByRole('radio', { name: 'Wk 9' }));
    expect(seen[0][1]).toEqual({ block: 'nearest', inline: 'center' });

    rerender(<SegmentedControl aria-label="Week" options={SEASON} value={14} onChange={() => {}} scrollable />);
    expect(seen).toHaveLength(2);
    expect(seen[1][0]).toBe(screen.getByRole('radio', { name: 'Wk 14' }));
  } finally {
    delete Element.prototype.scrollIntoView;
  }
});
