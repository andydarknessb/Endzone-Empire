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
test('the week strip scrolls inside its row instead of widening it, on a phone', () => {
  render(<PickWeek weeks={WEEKS} value={9} onChange={() => {}} fill />);
  const mobile = rulesUnder(screen.getByRole('radiogroup', { name: 'Week' }));
  expect(mobile['']).toMatch(/overflow-x: auto/);
  expect(mobile['']).toMatch(/min-width: 0/);
  expect(rulesUnder(screen.getByRole('radio', { name: 'Wk 9' }))['']).toMatch(/[^-]flex: 0 0 auto/);
});

// #921: the strip scrolls at EVERY width, not only below `sm`. That is what
// makes the zero minimum on the picker's two boxes safe: bounded by its row,
// the strip can neither overflow onto the "All weeks" button beside it nor
// widen the page, whatever the season length. Before this the desktop group
// was not a scroll container and its `flex: none` segments overflowed the
// shrunken row, which the #916 review measured at 125px of overlap at 1440px.
// Red-tell: handing the group `scrollable={fill}` again (the mobile-only rule)
// turns this case red and no other.
test('the week strip is a scroll container on the desktop path too', () => {
  render(<PickWeek weeks={WEEKS} value={9} onChange={() => {}} />);
  const desktop = rulesUnder(screen.getByRole('radiogroup', { name: 'Week' }));
  expect(desktop['']).toMatch(/overflow-x: auto/);
  expect(desktop['']).toMatch(/min-width: 0/);
  expect(desktop['']).toMatch(/max-width: 100%/);
  // The segments keep their natural width, so the desktop look is unchanged
  // while the weeks fit; they are never stretched to fill the row.
  expect(rulesUnder(screen.getByRole('radio', { name: 'Wk 9' }))['']).toMatch(/[^-]flex: 0 0 auto/);
});

// Both boxes carry a zero minimum at every width, which is only safe because
// the strip inside them scrolls at every width (the case above). Red-tell:
// dropping either `minWidth: 0` turns this case red and no other; dropping the
// strip's `scrollable` turns the case above red instead, and in a browser it
// is what lets the strip paint over the "All weeks" button.
test('both picker boxes may shrink under the strip they hold', () => {
  render(<PickWeek weeks={WEEKS} value={9} onChange={() => {}} />);
  expect(rulesUnder(screen.getByTestId('pick-week'))['']).toMatch(/min-width: 0/);
  expect(rulesUnder(screen.getByTestId('pick-week-stepper'))['']).toMatch(/min-width: 0/);
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

// --- the strip stays reachable (#928) ----------------------------------------

// The strip is the kit's roving-tab-stop group, so it is one tab stop and not
// eighteen. With "All" selected no week is checked, and both chevrons are
// disabled (no neighbour to step to), so the strip's own tab stop is the only
// keyboard door onto the weeks: without it a Tab from before the picker skips
// all 18 segments and lands on "All weeks". Each case is a real Tab walk.
//
// Red-tell (#928): restoring the floor on the index the kit's `tabIndex`
// expression reads (nothing checked can never test as -1) turns the two
// reachability cases red and leaves the converse case green. Second red-tell:
// giving the kit's first option an unconditional tab stop turns the converse
// case red and leaves the reachability cases green.
test('with All weeks selected the strip is still one Tab away, landing on Wk 1', async () => {
  render(
    <div>
      <button type="button">Before</button>
      <PickWeek weeks={WEEKS} value="All" onChange={() => {}} />
    </div>
  );
  screen.getByRole('button', { name: 'Before' }).focus();
  await userEvent.tab();
  expect(screen.getByRole('radio', { name: 'Wk 1' })).toHaveFocus();
  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'All weeks' })).toHaveFocus();
});

test('a week the list does not carry still leaves the strip in the tab sequence', async () => {
  render(
    <div>
      <button type="button">Before</button>
      <PickWeek weeks={WEEKS} value={99} onChange={() => {}} />
    </div>
  );
  screen.getByRole('button', { name: 'Before' }).focus();
  await userEvent.tab();
  expect(screen.getByRole('radio', { name: 'Wk 1' })).toHaveFocus();
});

test('on a selected week the walk reaches Previous and then the checked week', async () => {
  render(
    <div>
      <button type="button">Before</button>
      <PickWeek weeks={WEEKS} value={9} onChange={() => {}} />
    </div>
  );
  screen.getByRole('button', { name: 'Before' }).focus();
  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'Previous week' })).toHaveFocus();
  await userEvent.tab();
  expect(screen.getByRole('radio', { name: 'Wk 9' })).toHaveFocus();
});

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
  ])('allWeeks={false} drops the button on %s and keeps the rest', (_name, fill) => {
    render(<PickWeek weeks={WEEKS} value={2} onChange={() => {}} allWeeks={false} fill={fill} />);
    expect(screen.queryByRole('button', { name: 'All weeks' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Wk 2' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next week' })).toBeInTheDocument();
  });
});

// --- (spec #2334 ruling 3) ---------------------------------

describe('Play-select look', () => {
  const allRules = () => [
    screen.getByTestId('pick-week'), screen.getByTestId('pick-week-stepper'), screen.getByRole('radiogroup', { name: 'Week' }),
    screen.getByRole('radio', { name: 'Wk 9' }), screen.getByRole('button', { name: 'Previous week' }),
    screen.getByRole('button', { name: 'Next week' }), screen.getByRole('button', { name: 'All weeks' }),
  ].map(own).join(';');

  test('paints ps tokens and no dash token', () => {
    render(<PickWeek weeks={WEEKS} value={9} onChange={() => {}} />);
    expect(allRules()).toMatch(/--ps-/);
    expect(allRules()).not.toMatch(/--dash-/);
  });

  test('every control keeps its role and name, and is a 44px target', () => {
    render(<PickWeek weeks={WEEKS} value={9} onChange={() => {}} />);
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
    render(<PickWeek weeks={WEEKS} value="All" onChange={() => {}} />);
    expect(allRules()).not.toMatch(/opacity/);
    const all = screen.getByRole('button', { name: 'All weeks', pressed: true });
    // eslint-disable-next-line testing-library/no-node-access
    expect(all.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(own(all)).toMatch(/--ps-play/);
  });

  test('stepping still reports the neighbouring week and All weeks still reports "All"', async () => {
    const onChange = jest.fn();
    render(<PickWeek weeks={WEEKS} value={9} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(onChange).toHaveBeenLastCalledWith(10);
    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(onChange).toHaveBeenLastCalledWith(8);
    await userEvent.click(screen.getByRole('button', { name: 'All weeks' }));
    expect(onChange).toHaveBeenLastCalledWith('All');
  });

  test('a disabled stepper is a disabled button', () => {
    render(<PickWeek weeks={WEEKS} value={1} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next week' })).toBeEnabled();
  });
});

// One tab stop for the weeks (Critique 9 item 8, AC 6m): the selected week is the strip's only
// stop and the arrow keys move it, so Previous and Next leave the Tab sequence. "All weeks" is a different action and
// keeps its own stop (QA ruling), so a keyboard user can still reach it.
// Red-tell: leaving the steppers at their default tab index, or giving All weeks tabindex -1, turns the cases red.
describe('roving tabindex', () => {
  const page = (props) => (
    <div>
      <button type="button">Before</button>
      <PickWeek weeks={WEEKS} onChange={() => {}} {...props} />
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
});
