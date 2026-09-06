import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PickWeek } from '../index';

// A full season (#916): 18 weeks is what a phone row cannot hold as stretched
// segments, so the crowded case is the case under test everywhere below.
const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1);
const LAST = WEEKS[WEEKS.length - 1];

// The layout is an sx rule, which jsdom neither lays out nor computes, but
// emotion inserts every rule into `document.styleSheets` under the generated
// class name. This gathers the declarations of every rule whose selector
// starts with an element's class (its own and its descendant rules), keyed by
// the selector's tail: '' is the element itself.
const rulesUnder = (el) => {
  const cls = Array.from(el.classList).find((c) => c.startsWith('css-'));
  const found = {};
  Array.from(document.styleSheets).forEach((sheet) => {
    Array.from(sheet.cssRules).forEach((rule) => {
      if (!rule.selectorText || !rule.selectorText.startsWith(`.${cls}`)) return;
      const tail = rule.selectorText.slice(`.${cls}`.length).trim();
      found[tail] = `${found[tail] || ''}${rule.style.cssText};`;
    });
  });
  return found;
};

test('renders one Wk N option per week and checks the selected week', () => {
  render(<PickWeek weeks={WEEKS} value={2} onChange={() => {}} />);
  expect(screen.getByRole('radiogroup', { name: 'Week' })).toBeInTheDocument();
  expect(screen.getAllByRole('radio')).toHaveLength(18);
  expect(screen.getByRole('radio', { name: 'Wk 2' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Wk 1' })).not.toBeChecked();
  expect(screen.getByRole('radio', { name: 'Wk 3' })).not.toBeChecked();
});

test('clicking an option calls onChange with that week', async () => {
  const onChange = jest.fn();
  render(<PickWeek weeks={WEEKS} value={2} onChange={onChange} />);
  await userEvent.click(screen.getByRole('radio', { name: 'Wk 3' }));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith(3);
});

// Red-tell: wiring next to the previous week turns this case red and no other.
test('previous and next step to the neighbouring week', async () => {
  const onChange = jest.fn();
  render(<PickWeek weeks={WEEKS} value={2} onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: 'Next week' }));
  expect(onChange).toHaveBeenLastCalledWith(3);
  await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));
  expect(onChange).toHaveBeenLastCalledWith(1);
  expect(onChange).toHaveBeenCalledTimes(2);
});

test('previous is disabled on the first week and next on the last', () => {
  const { rerender } = render(<PickWeek weeks={WEEKS} value={1} onChange={() => {}} />);
  expect(screen.getByRole('button', { name: 'Previous week' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next week' })).toBeEnabled();

  rerender(<PickWeek weeks={WEEKS} value={LAST} onChange={() => {}} />);
  expect(screen.getByRole('button', { name: 'Previous week' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled();
});

test('All weeks calls onChange with "All"', async () => {
  const onChange = jest.fn();
  render(<PickWeek weeks={WEEKS} value={2} onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: 'All weeks' }));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith('All');
});

test('with All selected no week is checked, both steppers are disabled and All weeks reads pressed', () => {
  render(<PickWeek weeks={WEEKS} value="All" onChange={() => {}} />);
  screen.getAllByRole('radio').forEach((radio) => expect(radio).not.toBeChecked());
  expect(screen.getByRole('button', { name: 'Previous week' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'All weeks', pressed: true })).toBeInTheDocument();
});

test('a selected week reads as not pressed on All weeks', () => {
  render(<PickWeek weeks={WEEKS} value={2} onChange={() => {}} />);
  expect(screen.getByRole('button', { name: 'All weeks', pressed: false })).toBeInTheDocument();
});

test('a week the list does not carry disables both steppers', () => {
  render(<PickWeek weeks={WEEKS} value={99} onChange={() => {}} />);
  expect(screen.getByRole('button', { name: 'Previous week' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled();
});

test('an empty week list renders no options and disables both steppers', () => {
  render(<PickWeek weeks={[]} value="All" onChange={() => {}} />);
  expect(screen.queryAllByRole('radio')).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Previous week' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'All weeks' })).toBeEnabled();
});

test('the chevrons are decorative so each stepper is named by its label alone', () => {
  render(<PickWeek weeks={WEEKS} value={2} onChange={() => {}} />);
  expect(screen.getByTestId('pick-week-chevron-left')).toHaveAttribute('aria-hidden', 'true');
  expect(screen.getByTestId('pick-week-chevron-right')).toHaveAttribute('aria-hidden', 'true');
  expect(screen.getByRole('button', { name: 'Previous week' })).toHaveAccessibleName('Previous week');
  expect(screen.getByRole('button', { name: 'Next week' })).toHaveAccessibleName('Next week');
});

test('fill keeps every control and its name in place', () => {
  render(<PickWeek weeks={WEEKS} value={2} onChange={() => {}} fill />);
  expect(screen.getByRole('group', { name: 'Week picker' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Previous week' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Wk 2' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Next week' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'All weeks' })).toBeInTheDocument();
});

// --- the phone row (#916) ----------------------------------------------------

// Red-tell (#916): handing the strip `fill` instead of `scrollable` (the old
// rule, which stretched 18 segments and widened the document past a 390px
// phone) turns the first half red; scrolling the desktop picker too turns the
// second half red.
test('below sm the week strip scrolls inside its row instead of widening it', () => {
  const { rerender } = render(<PickWeek weeks={WEEKS} value={9} onChange={() => {}} fill />);
  const mobile = rulesUnder(screen.getByRole('radiogroup', { name: 'Week' }));
  expect(mobile['']).toMatch(/overflow-x: auto/);
  expect(mobile['']).toMatch(/min-width: 0/);
  expect(rulesUnder(screen.getByRole('radio', { name: 'Wk 9' }))['']).toMatch(/[^-]flex: 0 0 auto/);

  rerender(<PickWeek weeks={WEEKS} value={9} onChange={() => {}} />);
  expect(rulesUnder(screen.getByRole('radiogroup', { name: 'Week' }))['']).not.toMatch(/overflow-x/);
});

// The zero minimum is the mobile half of the fix and belongs ONLY there. Above
// `sm` the strip is not a scroll container and its segments are `flex: none`,
// so a box that may shrink under the strip lets the strip overflow it and paint
// under the "All weeks" button beside it: the desktop overlap the #916 review
// caught in Chromium. Red-tell: making either box's `minWidth` unconditional
// (`minWidth: 0`) turns this case red and no other.
test('the picker only lets its boxes shrink under the strip on the mobile path', () => {
  const emotionClass = (el) => Array.from(el.classList).find((c) => c.startsWith('css-'));

  const { unmount } = render(<PickWeek weeks={WEEKS} value={9} onChange={() => {}} fill />);
  const mobileRoot = emotionClass(screen.getByTestId('pick-week'));
  const mobileStepper = emotionClass(screen.getByTestId('pick-week-stepper'));
  expect(rulesUnder(screen.getByTestId('pick-week'))['']).toMatch(/min-width: 0/);
  expect(rulesUnder(screen.getByTestId('pick-week-stepper'))['']).toMatch(/min-width: 0/);
  unmount();

  // The desktop path gets its own class, so it is not carrying the mobile
  // box's declarations. Reading that second class's rule BACK is what this
  // harness cannot do reliably: emotion's cache is module state that jest
  // shares across the files in a worker while each file gets a fresh document,
  // so under `--maxWorkers` the lookup can return the first render's rule.
  // The desktop half of this rule is therefore asserted in Chromium, not here:
  // the #916 review measured "All weeks" overlapping the last segments by
  // 125px at 1440px with an unconditional minimum, and 56px clear without it.
  // See #920 for the layout guard that belongs at that level.
  render(<PickWeek weeks={WEEKS} value={9} onChange={() => {}} />);
  expect(emotionClass(screen.getByTestId('pick-week'))).not.toBe(mobileRoot);
  expect(emotionClass(screen.getByTestId('pick-week-stepper'))).not.toBe(mobileStepper);
});

// Red-tell (#916): putting "All weeks" back on its own row (out of the
// stepper row, the layout that cost a phone a second row of chrome) turns
// this case red and no other.
test('below sm "All weeks" sits in the same row as the strip', () => {
  render(<PickWeek weeks={WEEKS} value={9} onChange={() => {}} fill />);
  const row = screen.getByTestId('pick-week-stepper');
  expect(row).toContainElement(screen.getByRole('button', { name: 'Previous week' }));
  expect(row).toContainElement(screen.getByRole('radiogroup', { name: 'Week' }));
  expect(row).toContainElement(screen.getByRole('button', { name: 'Next week' }));
  expect(row).toContainElement(screen.getByRole('button', { name: 'All weeks' }));
  expect(screen.getByRole('button', { name: 'All weeks' })).toHaveAccessibleName('All weeks');
});

// Red-tell (#916): lowering any of these to the kit's own size (the segments'
// old `height: 38`, a 38px chevron or "All weeks" button) turns this case red
// and no other.
test('below sm every control still meets the 44px touch target', () => {
  render(<PickWeek weeks={WEEKS} value={9} onChange={() => {}} fill />);
  expect(rulesUnder(screen.getByRole('radiogroup', { name: 'Week' }))['[role="radio"]']).toMatch(/min-height: 44px/);
  ['Previous week', 'Next week', 'All weeks'].forEach((name) => {
    const own = rulesUnder(screen.getByRole('button', { name }))[''];
    expect(own).toMatch(/min-width: 44px/);
    expect(own).toMatch(/min-height: 44px/);
  });
});
