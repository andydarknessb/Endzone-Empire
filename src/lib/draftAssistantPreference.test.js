import { readDraftAssistantOn, writeDraftAssistantOn, DRAFT_ASSISTANT_KEY } from './draftAssistantPreference';

describe('draftAssistantPreference (#786/#784 ruling 11 - per-device, off by default, persisted)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.restoreAllMocks();
  });

  it('is OFF by default, when nothing is stored', () => {
    expect(readDraftAssistantOn()).toBe(false);
  });

  it('is ON only when the stored value is exactly "1"', () => {
    window.localStorage.setItem(DRAFT_ASSISTANT_KEY, '1');
    expect(readDraftAssistantOn()).toBe(true);
    window.localStorage.setItem(DRAFT_ASSISTANT_KEY, '0');
    expect(readDraftAssistantOn()).toBe(false);
    window.localStorage.setItem(DRAFT_ASSISTANT_KEY, 'true');
    expect(readDraftAssistantOn()).toBe(false);
  });

  it('persists a preference across reads (per device)', () => {
    writeDraftAssistantOn(true);
    expect(window.localStorage.getItem(DRAFT_ASSISTANT_KEY)).toBe('1');
    expect(readDraftAssistantOn()).toBe(true);
    writeDraftAssistantOn(false);
    expect(window.localStorage.getItem(DRAFT_ASSISTANT_KEY)).toBe('0');
    expect(readDraftAssistantOn()).toBe(false);
  });

  it('reads as OFF rather than throwing when storage access throws (private mode)', () => {
    jest.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => readDraftAssistantOn()).not.toThrow();
    expect(readDraftAssistantOn()).toBe(false);
  });

  it('does not throw when a write is denied (the toggle still flips in-memory)', () => {
    jest.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => writeDraftAssistantOn(true)).not.toThrow();
  });
});
