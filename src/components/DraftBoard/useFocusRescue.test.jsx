import React from 'react';
import { render, screen, act } from '@testing-library/react';
import useFocusRescue from './useFocusRescue';

// A minimal harness: the hook's focus/blur handlers spread on a wrapper around
// one focusable control, and `signal` driven purely by a prop so a test can
// change it via rerender WITHOUT moving focus (a focus move would legitimately
// clear the tracker and is not what these tests are about).
function Harness({ signal, resolveTarget }) {
  const rescue = useFocusRescue(signal, resolveTarget);
  return (
    <div {...rescue} data-testid="region">
      <input aria-label="held" />
    </div>
  );
}

describe('useFocusRescue ordered fallback (#525 review)', () => {
  test('skips a found-but-unfocusable candidate and focuses the next one', () => {
    // A bare div with no tabindex is not focusable: .focus() on it is a silent
    // no-op. Under the old `again || main` shape it would have won the truthy
    // test, the fallback would never run, and focus would be stranded.
    const unfocusable = document.createElement('div');
    const focusable = document.createElement('button');
    document.body.append(unfocusable, focusable);
    const resolveTarget = () => [unfocusable, focusable];

    const { rerender } = render(<Harness signal="a" resolveTarget={resolveTarget} />);
    act(() => screen.getByLabelText('held').focus());

    // Change the signal without touching focus, so the rescue fires.
    rerender(<Harness signal="b" resolveTarget={resolveTarget} />);

    expect(focusable).toHaveFocus();
    expect(unfocusable).not.toHaveFocus();

    unfocusable.remove();
    focusable.remove();
  });

  test('focuses the first candidate when it is focusable, never reaching the fallback', () => {
    const first = document.createElement('button');
    const fallback = document.createElement('button');
    document.body.append(first, fallback);
    const resolveTarget = () => [first, fallback];

    const { rerender } = render(<Harness signal="a" resolveTarget={resolveTarget} />);
    act(() => screen.getByLabelText('held').focus());

    rerender(<Harness signal="b" resolveTarget={resolveTarget} />);

    expect(first).toHaveFocus();
    expect(fallback).not.toHaveFocus();

    first.remove();
    fallback.remove();
  });

  test('a plain (non-array) resolved target still works', () => {
    const only = document.createElement('button');
    document.body.append(only);
    const resolveTarget = () => only;

    const { rerender } = render(<Harness signal="a" resolveTarget={resolveTarget} />);
    act(() => screen.getByLabelText('held').focus());

    rerender(<Harness signal="b" resolveTarget={resolveTarget} />);

    expect(only).toHaveFocus();
    only.remove();
  });
});
