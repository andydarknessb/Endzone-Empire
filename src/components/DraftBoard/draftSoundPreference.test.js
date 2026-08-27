import { readDraftSoundOn, writeDraftSoundOn, DRAFT_SOUND_KEY } from './draftSoundPreference';

describe('draftSoundPreference (#445 AC6 - per-device, off by default, persisted)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.restoreAllMocks();
  });

  it('is OFF by default, when nothing is stored', () => {
    expect(readDraftSoundOn()).toBe(false);
  });

  it('is ON only when the stored value is exactly "1"', () => {
    window.localStorage.setItem(DRAFT_SOUND_KEY, '1');
    expect(readDraftSoundOn()).toBe(true);
    window.localStorage.setItem(DRAFT_SOUND_KEY, '0');
    expect(readDraftSoundOn()).toBe(false);
    window.localStorage.setItem(DRAFT_SOUND_KEY, 'true');
    expect(readDraftSoundOn()).toBe(false);
  });

  it('persists a preference across reads (per device)', () => {
    writeDraftSoundOn(true);
    expect(window.localStorage.getItem(DRAFT_SOUND_KEY)).toBe('1');
    expect(readDraftSoundOn()).toBe(true);
    writeDraftSoundOn(false);
    expect(window.localStorage.getItem(DRAFT_SOUND_KEY)).toBe('0');
    expect(readDraftSoundOn()).toBe(false);
  });

  it('reads as OFF rather than throwing when storage access throws (private mode)', () => {
    jest.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => readDraftSoundOn()).not.toThrow();
    expect(readDraftSoundOn()).toBe(false);
  });

  it('does not throw when a write is denied (the toggle still flips in-memory)', () => {
    jest.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => writeDraftSoundOn(true)).not.toThrow();
  });
});
