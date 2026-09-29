import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { usePostgameCutscenes } from './usePostgameCutscenes';
import { recordStartedIds, readStartedIds } from './sessionGuard';
import { readPostgameSoundOn, writePostgameSoundOn } from './soundPreference';
import { sfx, setSfx } from './sfx';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

let latest;
function Probe() {
  latest = usePostgameCutscenes();
  return <span data-testid="count">{latest.cutscenes.length}</span>;
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});
afterEach(() => jest.clearAllMocks());

test('fetches the due list once per mount, not per render', async () => {
  apiClient.get.mockResolvedValue({ data: { cutscenes: [{ matchupId: 1 }, { matchupId: 2 }] } });
  const { rerender } = render(<Probe />);
  await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));
  rerender(<Probe />);
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(apiClient.get).toHaveBeenCalledWith('/api/user/postgame-cutscenes');
});

test.each([
  ['rejects', () => apiClient.get.mockRejectedValue(new Error('down'))],
  ['throws', () => apiClient.get.mockImplementation(() => { throw new Error('boom'); })],
  ['returns a malformed body', () => apiClient.get.mockResolvedValue({ data: { cutscenes: 'nope' } })],
  ['returns no body', () => apiClient.get.mockResolvedValue({})],
])('a fetch that %s renders an empty list and never throws', async (_name, arrange) => {
  arrange();
  render(<Probe />);
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  await Promise.resolve();
  expect(screen.getByTestId('count')).toHaveTextContent('0');
});

test('Matchups already started this session are filtered out of the list', async () => {
  recordStartedIds([2]);
  apiClient.get.mockResolvedValue({ data: { cutscenes: [{ matchupId: 1 }, { matchupId: 2 }, { matchupId: 3 }] } });
  render(<Probe />);
  await waitFor(() => expect(latest.cutscenes.map((c) => c.matchupId)).toEqual([1, 3]));
});

test('a response arriving after unmount is dropped', async () => {
  let resolve;
  apiClient.get.mockReturnValue(new Promise((r) => { resolve = r; }));
  const { unmount } = render(<Probe />);
  unmount();
  resolve({ data: { cutscenes: [{ matchupId: 1 }] } });
  await Promise.resolve();
  expect(latest.cutscenes).toEqual([]);
});

describe('session guard storage', () => {
  test('ids accumulate and survive a denied read', () => {
    recordStartedIds([1]);
    recordStartedIds([2, 1]);
    expect(readStartedIds()).toEqual([1, 2]);
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(readStartedIds()).toEqual([]);
    spy.mockRestore();
  });
});

describe('sound preference', () => {
  test('defaults on, "0" is muted, a denied store degrades to on', () => {
    expect(readPostgameSoundOn()).toBe(true);
    writePostgameSoundOn(false);
    expect(window.localStorage.getItem('endzone_postgame_sound')).toBe('0');
    expect(readPostgameSoundOn()).toBe(false);
    writePostgameSoundOn(true);
    expect(readPostgameSoundOn()).toBe(true);
    const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(readPostgameSoundOn()).toBe(true);
    expect(() => writePostgameSoundOn(false)).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});

describe('sfx interface', () => {
  test('the default is a silent no-op with the four calls', () => {
    expect(() => {
      sfx.play('x');
      sfx.startLoop('x');
      sfx.stopAll({ fadeMs: 100 });
      sfx.setMuted(true);
    }).not.toThrow();
  });

  test('an installed implementation receives the calls', () => {
    const impl = {
      play: jest.fn(), startLoop: jest.fn(), stopAll: jest.fn(), setMuted: jest.fn(),
    };
    setSfx(impl);
    sfx.play('hit');
    sfx.stopAll({ fadeMs: 50 });
    sfx.setMuted(1);
    setSfx(null);
    expect(impl.play).toHaveBeenCalledWith('hit');
    expect(impl.stopAll).toHaveBeenCalledWith({ fadeMs: 50 });
    expect(impl.setMuted).toHaveBeenCalledWith(true);
  });
});
