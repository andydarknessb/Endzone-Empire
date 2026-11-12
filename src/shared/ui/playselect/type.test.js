import { warmFonts } from './type';

// jsdom has no document.fonts, so each case installs its own and restores what was there.
const hadFonts = 'fonts' in document;
const realFonts = document.fonts;
afterEach(() => {
  if (hadFonts) document.fonts = realFonts;
  else delete document.fonts;
});

describe('warmFonts', () => {
  test('asks the Font Loading API for both Play-select faces', () => {
    const load = jest.fn(() => Promise.resolve([]));
    document.fonts = { load };
    warmFonts();
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls[0][0]).toContain('Press Start 2P');
    expect(load.mock.calls[1][0]).toContain('Archivo');
  });

  test('does not throw when document.fonts is missing', () => {
    delete document.fonts;
    expect(() => warmFonts()).not.toThrow();
  });

  test('a rejected load is swallowed, not an unhandled rejection', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    document.fonts = { load: jest.fn(() => Promise.reject(new Error('blocked'))) };
    try {
      expect(() => warmFonts()).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.removeListener('unhandledRejection', unhandled);
    }
  });
});
