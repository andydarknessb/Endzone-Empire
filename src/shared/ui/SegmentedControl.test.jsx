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

// #933: an arrow key is a true roving move. It walks from the option that holds
// DOM focus (not from `value`), carries focus onto the neighbour, and reports
// that neighbour as the pick. This case renders uncontrolled, so `value` stays
// 3 while focus moves: that is what proves the walk steps from focus and not
// from the stale value. ArrowRight from a focused Wk 3 wraps to Wk 1 and moves
// focus there; the following ArrowLeft then walks from Wk 1 and wraps back to
// Wk 3, where the old value-derived arithmetic would instead have stepped from
// the stale 3 to Wk 2.
//
// Red-tell (#933): reverting move() to derive its index from `value` (the
// pre-#933 floored `selectedIndex`) leaves focus on Wk 3 throughout, so the
// ArrowLeft reports 2 and both focus assertions go red.
test('arrow keys walk from the focused option, carry focus, and wrap', async () => {
  const onChange = jest.fn();
  render(<SegmentedControl aria-label="Week" options={WEEKS} value={3} onChange={onChange} />);
  screen.getByRole('radio', { name: 'Wk 3' }).focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(onChange).toHaveBeenLastCalledWith(1);
  expect(screen.getByRole('radio', { name: 'Wk 1' })).toHaveFocus();
  await userEvent.keyboard('{ArrowLeft}');
  expect(onChange).toHaveBeenLastCalledWith(3);
  expect(screen.getByRole('radio', { name: 'Wk 3' })).toHaveFocus();
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

// A scrolled strip is about three segments wide, so an arrow-key walk of two
// or more steps (or the wrap from the last week to the first) used to leave
// the focus ring on a segment scrolled out of the row, invisible to the
// keyboard user (WCAG 2.4.7): the kit's arrow keys report the pick and never
// move DOM focus. Each rerender below is what an arrow key produces, a new
// `value` from the composer.
//
// Red-tell (#916 review): dropping the `checked.focus()` turns the first half
// red (focus stays on Wk 9); dropping the `group.contains(document.activeElement)`
// guard turns both the mount assertion and the second half red, since the
// strip would then pull focus off whatever the user was actually on.
test('scrollable moves focus to the checked segment, but only when the group already holds it', () => {
  const view = (week) => (
    <div>
      <button type="button">Elsewhere</button>
      <SegmentedControl aria-label="Week" options={SEASON} value={week} onChange={() => {}} scrollable />
    </div>
  );
  const { rerender } = render(view(9));
  expect(screen.getByRole('radio', { name: 'Wk 9' })).not.toHaveFocus();

  screen.getByRole('radio', { name: 'Wk 9' }).focus();
  rerender(view(10));
  expect(screen.getByRole('radio', { name: 'Wk 10' })).toHaveFocus();

  const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
  elsewhere.focus();
  rerender(view(14));
  expect(elsewhere).toHaveFocus();
  expect(screen.getByRole('radio', { name: 'Wk 14' })).not.toHaveFocus();
});

// --- roving tab stop (#928) --------------------------------------------------

// The group is one tab stop at all times: the checked option when there is one,
// and the first option when there is not, so a composer that hands the group a
// value no option carries (the week picker's "All" state) never strands the
// segments out of the tab sequence. Each case below is a real Tab walk from a
// sentinel, so it measures reachability, not an attribute.
//
// Red-tell (#928): restoring the floor on the index the `tabIndex` expression
// reads (so nothing checked can never test as -1) turns the two reachability
// cases red and leaves the converse case green. Second red-tell: giving the
// first option an unconditional tab stop, so a checked group carries two, turns
// the converse case red and leaves the reachability cases green.
test('with no option checked the group is one tab stop, carried by the first option', async () => {
  render(
    <div>
      <button type="button">Before</button>
      <SegmentedControl aria-label="Week" options={WEEKS} value={undefined} onChange={() => {}} />
      <button type="button">After</button>
    </div>
  );
  screen.getByRole('button', { name: 'Before' }).focus();
  await userEvent.tab();
  expect(screen.getByRole('radio', { name: 'Wk 1' })).toHaveFocus();
  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
});

test('a value no option carries still leaves the group in the tab sequence', async () => {
  render(
    <div>
      <button type="button">Before</button>
      <SegmentedControl aria-label="Week" options={WEEKS} value={99} onChange={() => {}} />
    </div>
  );
  screen.getByRole('button', { name: 'Before' }).focus();
  await userEvent.tab();
  expect(screen.getByRole('radio', { name: 'Wk 1' })).toHaveFocus();
});

test('with an option checked the one tab stop is the checked option', async () => {
  render(
    <div>
      <button type="button">Before</button>
      <SegmentedControl aria-label="Week" options={WEEKS} value={2} onChange={() => {}} />
      <button type="button">After</button>
    </div>
  );
  screen.getByRole('button', { name: 'Before' }).focus();
  await userEvent.tab();
  expect(screen.getByRole('radio', { name: 'Wk 2' })).toHaveFocus();
  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
});
