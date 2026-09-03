import { act, renderHook } from '@testing-library/react';
import { useAnnouncement } from './useAnnouncement';

// The shared repeat-safe update every Draft-room EVENT announcer uses (#791,
// folding announcerRepeat.js in): announcing the same text twice must still
// mutate the rendered node, or a screen reader that already spoke the first
// one stays silent on the second (React bails on an Object.is-equal string).

describe('useAnnouncement', () => {
  it('starts silent', () => {
    const { result } = renderHook(() => useAnnouncement());
    const [announcement] = result.current;
    expect(announcement).toBe('');
  });

  it('announces a text unchanged the first time it is seen', () => {
    const { result } = renderHook(() => useAnnouncement());
    act(() => result.current[1]('Gridiron Giants drafted Justin Jefferson'));
    expect(result.current[0]).toBe('Gridiron Giants drafted Justin Jefferson');
  });

  it('renders the SECOND of two identical announcements with exactly one trailing U+200B', () => {
    const { result } = renderHook(() => useAnnouncement());
    act(() => result.current[1]('New message from Harbor Hawks'));
    expect(result.current[0]).toBe('New message from Harbor Hawks');

    act(() => result.current[1]('New message from Harbor Hawks'));
    // Exactly one zero-width space appended, built from its code point so no
    // invisible literal sits in this file either.
    expect(result.current[0]).toBe('New message from Harbor Hawks' + String.fromCharCode(0x200b));
  });

  it('renders A, A, B, B as A, A+ZWSP, B, B+ZWSP - a different text between two repeat-pairs', () => {
    // The interleaving a global parity counter gets wrong: comparing against
    // the CURRENTLY RENDERED value instead cannot desync, so each repeat of
    // EITHER text must independently gain the discriminator.
    const ZWSP = String.fromCharCode(0x200b);
    const { result } = renderHook(() => useAnnouncement());

    act(() => result.current[1]('A'));
    expect(result.current[0]).toBe('A');

    act(() => result.current[1]('A'));
    expect(result.current[0]).toBe('A' + ZWSP);

    act(() => result.current[1]('B'));
    expect(result.current[0]).toBe('B');

    act(() => result.current[1]('B'));
    expect(result.current[0]).toBe('B' + ZWSP);
  });

  it('renders a genuinely different text clean, with no discriminator', () => {
    const { result } = renderHook(() => useAnnouncement());
    act(() => result.current[1]('Team A drafted Player One'));
    act(() => result.current[1]('Team B drafted Player Two'));
    expect(result.current[0]).toBe('Team B drafted Player Two');
  });

  it('clears to a plain empty string via announce(""), never empty-plus-ZWSP', () => {
    // The clear path every gated announcer's exit/hidden/own-message branch
    // uses (StallAnnouncer's exit edge, FeedAnnouncer's hidden-arrival and
    // own-message cases): the prior text is never itself empty when a real
    // clear fires, so announce('') lands on the "different text" branch, not
    // the exact-repeat one.
    const { result } = renderHook(() => useAnnouncement());
    act(() => result.current[1]('The draft is stuck on MinneApple: no draftable player.'));
    act(() => result.current[1](''));
    expect(result.current[0]).toBe('');
  });

  it('stays a plain empty string across two consecutive clears', () => {
    // Two exits in a row (or two own-messages arriving while already silent)
    // both clear via announce(''); the empty string is exempt from the repeat
    // check, so a second clear never appends a zero-width space onto silence.
    const { result } = renderHook(() => useAnnouncement());
    act(() => result.current[1](''));
    expect(result.current[0]).toBe('');
    act(() => result.current[1](''));
    expect(result.current[0]).toBe('');
  });
});
