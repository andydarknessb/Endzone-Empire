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

// Dispatch a real bubbling focusout so React's delegated root listener fires the
// hook's onBlur (React synthesises onBlur from focusout). `relatedTarget: null`
// is the "focus fell to <body>" shape a browser produces both for a click-away
// to non-focusable content AND for the tear-down this hook rescues.
function emitBodyBlur(el) {
  el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
}
function emitBlurTo(el, related) {
  el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: related }));
}

describe('useFocusRescue null-relatedTarget path distinguishes click-away from tear-down (#532)', () => {
  // The pointer-intent flag lives at module scope (it is a property of the
  // gesture, not of an instance) and is cleared when the gesture ends. End any
  // gesture a test started, so a pointerdown fired in one test cannot leak a
  // true flag into the next - these tests must pass in ANY order, each proving
  // its own claim rather than leaning on a neighbour leaving the flag just so.
  afterEach(() => { document.dispatchEvent(new Event('pointerup', { bubbles: true })); });

  test('RED against current impl: a pointer-driven click-away invalidates the hold, so a later signal change does NOT rescue', () => {
    const resolveTarget = jest.fn(() => document.createElement('button'));
    const { rerender } = render(<Harness signal="a" resolveTarget={resolveTarget} />);
    const held = screen.getByLabelText('held');
    act(() => held.focus());

    // A click-away: the user's pointerdown lands on non-focusable content in the
    // SAME synchronous turn as the null-relatedTarget blur it produces. The held
    // element is still connected (this is not a tear-down).
    act(() => {
      document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      emitBodyBlur(held);
    });
    expect(held.isConnected).toBe(true);

    // Later, the layout flips. The hold must have been invalidated by the
    // click-away, so nothing is pulled back.
    rerender(<Harness signal="b" resolveTarget={resolveTarget} />);
    expect(resolveTarget).not.toHaveBeenCalled();
  });

  test('complement: a null-relatedTarget blur with NO preceding pointer keeps the hold, so the flip still rescues (the tear-down signature)', () => {
    const target = document.createElement('button');
    document.body.append(target);
    const resolveTarget = jest.fn(() => target);
    const { rerender } = render(<Harness signal="a" resolveTarget={resolveTarget} />);
    const held = screen.getByLabelText('held');
    act(() => held.focus());

    // Focus falls to <body> with no relatedTarget and NO pointer gesture - this
    // is exactly the tear-down's own signature (a rotation/resize flip, or a
    // socket-driven rail control removal), so the hold survives.
    act(() => { emitBodyBlur(held); });

    rerender(<Harness signal="b" resolveTarget={resolveTarget} />);
    expect(resolveTarget).toHaveBeenCalledTimes(1);
    expect(target).toHaveFocus();
    target.remove();
  });

  test('the pointer flag is scoped to the immediate blur only: a pointerdown that is NOT followed by a consumed body-blur does not suppress a later rescue', () => {
    const target = document.createElement('button');
    document.body.append(target);
    const resolveTarget = jest.fn(() => target);
    const { rerender } = render(<Harness signal="a" resolveTarget={resolveTarget} />);
    const held = screen.getByLabelText('held');
    act(() => held.focus());

    // A pointerdown happens, but the tracked element is not blurred to <body> by
    // it (e.g. a future teardown that a pointer triggers but that fires no blur
    // this hook consumes). The flag must not leak into the later, separate flip.
    act(() => { document.dispatchEvent(new Event('pointerdown', { bubbles: true })); });

    rerender(<Harness signal="b" resolveTarget={resolveTarget} />);
    expect(resolveTarget).toHaveBeenCalledTimes(1);
    expect(target).toHaveFocus();
    target.remove();
  });

  test('the truthy-relatedTarget path still clears the hold (a real focus move out), leaving outside chrome untouched', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const resolveTarget = jest.fn(() => document.createElement('button'));
    const { rerender } = render(<Harness signal="a" resolveTarget={resolveTarget} />);
    const held = screen.getByLabelText('held');
    act(() => held.focus());

    // Focus moves to a real element outside the region: stop tracking.
    act(() => { emitBlurTo(held, outside); });

    rerender(<Harness signal="b" resolveTarget={resolveTarget} />);
    expect(resolveTarget).not.toHaveBeenCalled();
    outside.remove();
  });
});
