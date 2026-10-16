import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PickWeek } from '../index';

const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1);
const LAST = WEEKS[WEEKS.length - 1];

// The layout is an sx rule, which jsdom does not compute, but emotion inserts every rule into
// `document.styleSheets` under the generated class name; this reads an element's own declarations back.
const own = (el) => {
  const cls = Array.from(el.classList).find((c) => c.startsWith('css-'));
  let text = '';
  Array.from(document.styleSheets).forEach((sheet) => {
    Array.from(sheet.cssRules).forEach((rule) => {
      if (rule.selectorText && rule.selectorText.startsWith(`.${cls}`)) text += `${rule.style.cssText};`;
    });
  });
  return text;
};

// --- allWeeks (spec #2334 ruling 7, AC 6a) -----------------------------------

describe('allWeeks', () => {
  test('is on by default, so Game Center and Lineup keep "All weeks"', () => {
    render(<PickWeek weeks={WEEKS} value={2} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'All weeks' })).toBeInTheDocument();
  });

  test('allWeeks={true} says the same as the default', () => {
    render(<PickWeek weeks={WEEKS} value={2} onChange={() => {}} allWeeks />);
    expect(screen.getByRole('button', { name: 'All weeks' })).toBeInTheDocument();
  });

  test.each([
    ['desktop', false, undefined],
    ['phone (fill)', true, undefined],
    ['desktop, playselect', false, 'playselect'],
    ['phone, playselect', true, 'playselect'],
  ])('allWeeks={false} drops the button on %s and keeps the rest', (_name, fill, look) => {
    render(<PickWeek weeks={WEEKS} value={2} onChange={() => {}} allWeeks={false} fill={fill} look={look} />);
    expect(screen.queryByRole('button', { name: 'All weeks' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Wk 2' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next week' })).toBeInTheDocument();
  });
});

// --- look="playselect" (spec #2334 ruling 3) ---------------------------------

describe('look', () => {
  const allRules = () => [
    screen.getByTestId('pick-week'), screen.getByTestId('pick-week-stepper'), screen.getByRole('radiogroup', { name: 'Week' }),
    screen.getByRole('radio', { name: 'Wk 9' }), screen.getByRole('button', { name: 'Previous week' }),
    screen.getByRole('button', { name: 'Next week' }), screen.getByRole('button', { name: 'All weeks' }),
  ].map(own).join(';');

  test('the default look paints dash tokens only', () => {
    render(<PickWeek weeks={WEEKS} value={9} onChange={() => {}} />);
    expect(allRules()).toMatch(/--dash-/);
    expect(allRules()).not.toMatch(/--ps-/);
  });

  test('look="playselect" paints ps tokens and no dash token', () => {
    render(<PickWeek weeks={WEEKS} value={9} onChange={() => {}} look="playselect" />);
    expect(allRules()).toMatch(/--ps-/);
    expect(allRules()).not.toMatch(/--dash-/);
  });

  test('every control keeps its role and name, and is a 44px target', () => {
    render(<PickWeek weeks={WEEKS} value={9} onChange={() => {}} look="playselect" />);
    expect(screen.getByRole('group', { name: 'Week picker' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Week' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Wk 9' })).toBeChecked();
    ['Previous week', 'Next week', 'All weeks'].forEach((name) => {
      const rule = own(screen.getByRole('button', { name }));
      expect(rule).toMatch(/min-width: 44px/);
      expect(rule).toMatch(/min-height: 44px/);
    });
    expect(screen.getByTestId('pick-week-chevron-left')).toHaveAttribute('aria-hidden', 'true');
  });

  test('no control uses opacity, and the pressed All weeks shows an arrow as well as the fill', () => {
    render(<PickWeek weeks={WEEKS} value="All" onChange={() => {}} look="playselect" />);
    expect(allRules()).not.toMatch(/opacity/);
    const all = screen.getByRole('button', { name: 'All weeks', pressed: true });
    // eslint-disable-next-line testing-library/no-node-access
    expect(all.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(own(all)).toMatch(/--ps-play/);
  });

  test('stepping still reports the neighbouring week and All weeks still reports "All"', async () => {
    const onChange = jest.fn();
    render(<PickWeek weeks={WEEKS} value={9} onChange={onChange} look="playselect" />);
    await userEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(onChange).toHaveBeenLastCalledWith(10);
    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(onChange).toHaveBeenLastCalledWith(8);
    await userEvent.click(screen.getByRole('button', { name: 'All weeks' }));
    expect(onChange).toHaveBeenLastCalledWith('All');
  });

  test('a disabled stepper is a disabled button', () => {
    render(<PickWeek weeks={WEEKS} value={1} onChange={() => {}} look="playselect" />);
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next week' })).toBeEnabled();
  });
});

// One tab stop for the weeks (Critique 9 item 8, AC 6m): in the playselect look the selected week is the strip's only
// stop and the arrow keys move it, so Previous and Next leave the Tab sequence. "All weeks" is a different action and
// keeps its own stop (QA ruling), so a keyboard user can still reach it.
// Red-tell: leaving the steppers at their default tab index, or giving All weeks tabindex -1, turns the cases red.
describe('playselect look: roving tabindex', () => {
  const page = (props) => (
    <div>
      <button type="button">Before</button>
      <PickWeek weeks={WEEKS} onChange={() => {}} look="playselect" {...props} />
      <button type="button">After</button>
    </div>
  );

  test('Tab visits one week control, the selected week, then All weeks, then leaves', async () => {
    render(page({ value: 9 }));
    screen.getByRole('button', { name: 'Before' }).focus();
    await userEvent.tab();
    expect(screen.getByRole('radio', { name: 'Wk 9' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'All weeks' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  });

  test('without All weeks the selected week is the picker\'s only stop', async () => {
    render(page({ value: 9, allWeeks: false }));
    screen.getByRole('button', { name: 'Before' }).focus();
    await userEvent.tab();
    expect(screen.getByRole('radio', { name: 'Wk 9' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  });

  test('the other weeks and the steppers are tabindex -1; the selected week and All weeks are not', () => {
    render(page({ value: 9 }));
    ['Wk 1', 'Wk 10'].forEach((name) => expect(screen.getByRole('radio', { name })).toHaveAttribute('tabindex', '-1'));
    ['Previous week', 'Next week'].forEach((name) => expect(screen.getByRole('button', { name })).toHaveAttribute('tabindex', '-1'));
    expect(screen.getByRole('radio', { name: 'Wk 9' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: 'All weeks' })).not.toHaveAttribute('tabindex', '-1');
  });

  test('with All selected the strip is still one stop, on Wk 1, and All weeks follows it', async () => {
    render(page({ value: 'All' }));
    screen.getByRole('button', { name: 'Before' }).focus();
    await userEvent.tab();
    expect(screen.getByRole('radio', { name: 'Wk 1' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'All weeks' })).toHaveFocus();
  });

  test('Left and Right move to the neighbouring week and carry focus', async () => {
    const onChange = jest.fn();
    render(page({ value: 9, onChange }));
    screen.getByRole('radio', { name: 'Wk 9' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith(10);
    expect(screen.getByRole('radio', { name: 'Wk 10' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith(9);
  });

  test('Home and End move to the first and last week', async () => {
    const onChange = jest.fn();
    render(page({ value: 9, onChange }));
    screen.getByRole('radio', { name: 'Wk 9' }).focus();
    await userEvent.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith(LAST);
    expect(screen.getByRole('radio', { name: `Wk ${LAST}` })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(screen.getByRole('radio', { name: 'Wk 1' })).toHaveFocus();
  });

  test('the default look keeps the steppers in the Tab sequence', async () => {
    render(page({ value: 9, look: undefined }));
    screen.getByRole('button', { name: 'Before' }).focus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Previous week' })).toHaveFocus();
  });
});
