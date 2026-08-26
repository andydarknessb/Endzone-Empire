import {
  NFL_TEAM_COLORS,
  FALLBACK_KIT,
  FIELD_GREEN,
  CONTRAST_THRESHOLD,
  getTeamKit,
  getSpriteColors,
  getNameColors,
  colorDistance,
} from './nflTeamColors';
// The Team codes are OWNED by the server's normalizer (the same object its own
// drift guard reads), and the client colour table must key on exactly those
// values. Deriving the expected set from that object rather than a hand-copied
// literal means a relocation or rename added on the server fails THIS test too
// instead of the two vocabularies drifting silently apart (#449).
import { NFL_TEAM_FULL_NAMES } from '../../server/services/nflTeam';

const ALL_32 = Object.values(NFL_TEAM_FULL_NAMES);

const HEX = /^#[0-9a-f]{6}$/i;

describe('nflTeamColors lookup', () => {
  test('has exactly the 32 NFL teams', () => {
    expect(Object.keys(NFL_TEAM_COLORS).sort()).toEqual([...ALL_32].sort());
  });

  test('every team defines helmet/jersey/pants/accent as valid hex', () => {
    for (const kit of Object.values(NFL_TEAM_COLORS)) {
      for (const role of ['helmet', 'jersey', 'pants', 'accent']) {
        expect(kit[role]).toMatch(HEX);
      }
    }
    // spot-check the documented example (outside the loop: a conditional
    // expect can silently never run - jest/no-conditional-expect)
    expect(NFL_TEAM_COLORS.MIN).toMatchObject({ jersey: '#4f2683', accent: '#ffc62f' });
  });

  test('getTeamKit falls back to a neutral kit for unknown abbreviations', () => {
    expect(getTeamKit('ZZZ')).toBe(FALLBACK_KIT);
    expect(getTeamKit(undefined)).toBe(FALLBACK_KIT);
    expect(getTeamKit('')).toBe(FALLBACK_KIT);
  });

  test('getTeamKit is case-insensitive', () => {
    expect(getTeamKit('min')).toBe(NFL_TEAM_COLORS.MIN);
  });

  test('every server Team code resolves a non-fallback kit through all three consumers (#449)', () => {
    // The three client consumers a scoring play feeds: the sprite kits, the
    // BOOM-band name colours, and (via getTeamKit) the retro-field moment text.
    // Driven off the server's own team object, so a code the server can emit
    // that this table lacks fails here.
    expect(ALL_32).toHaveLength(32);
    for (const code of ALL_32) {
      expect(getTeamKit(code)).not.toBe(FALLBACK_KIT);
      // getNameColors' stripe is the raw jersey; a fallback would surface it.
      expect(getNameColors(code).stripe).not.toBe(FALLBACK_KIT.jersey);
      // getSpriteColors resolves the runner off a real kit (contrast guard may
      // swap a green team to its alt, but it never lands on the neutral kit).
      const { runner } = getSpriteColors(code, 'KC');
      for (const role of ['helmet', 'jersey', 'pants', 'accent']) {
        expect(runner[role]).toMatch(HEX);
      }
    }
  });

  test('getTeamKit warns (dev builds) when a non-empty code misses, but still returns the fallback (#449)', () => {
    // The miss used to be silent, so a raw code like WSH rendered the neutral
    // kit with no signal. It must now name the code that missed. NODE_ENV is
    // 'test' here (not 'production'), so the dev-mode warning fires.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(getTeamKit('WSH')).toBe(FALLBACK_KIT);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0].join(' '))).toContain('WSH');
    } finally {
      warn.mockRestore();
    }
  });

  test('getTeamKit stays silent for a genuinely-absent code (no code to name)', () => {
    // undefined/'' are absence, not a drift: there is nothing to name, so no
    // warning, and still the fallback with no throw.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(getTeamKit(undefined)).toBe(FALLBACK_KIT);
      expect(getTeamKit('')).toBe(FALLBACK_KIT);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('contrast guard', () => {
  test('a green-jersey team (GB) is swapped off the field', () => {
    const { runner } = getSpriteColors('GB', 'CHI');
    expect(colorDistance(runner.jersey, FIELD_GREEN)).toBeGreaterThanOrEqual(CONTRAST_THRESHOLD);
  });

  test('NYJ and PHI (dark green) also read against the field', () => {
    for (const abbr of ['NYJ', 'PHI']) {
      const { runner } = getSpriteColors(abbr, 'DAL');
      expect(colorDistance(runner.jersey, FIELD_GREEN)).toBeGreaterThanOrEqual(CONTRAST_THRESHOLD);
    }
  });

  test('runner and defender never share a near-identical jersey', () => {
    // Same team on both sides is the worst case.
    const { runner, defender } = getSpriteColors('DAL', 'DAL');
    expect(colorDistance(runner.jersey, defender.jersey)).toBeGreaterThanOrEqual(CONTRAST_THRESHOLD);
  });

  test('unknown team renders a full kit rather than crashing', () => {
    const { runner, defender } = getSpriteColors('???', 'GB');
    for (const kit of [runner, defender]) {
      for (const role of ['helmet', 'jersey', 'pants', 'accent']) {
        expect(kit[role]).toMatch(HEX);
      }
    }
  });

  test('a normal matchup keeps both teams on their home jerseys', () => {
    const { runner, defender } = getSpriteColors('MIN', 'KC');
    expect(runner.jersey).toBe('#4f2683');
    expect(defender.jersey).toBe('#e31837');
  });
});

describe('getNameColors (BOOM band)', () => {
  const BLACK = '#000000';

  test('bright-jersey team uses the jersey for the name text', () => {
    const { text, shadow, stripe } = getNameColors('KC');
    expect(text).toBe('#e31837');
    expect(shadow).toBe('#ffb81c');
    expect(stripe).toBe('#e31837');
  });

  test('near-black jerseys fall through to a readable kit color', () => {
    // CHI navy and PIT black both vanish on the band; their accents don't.
    expect(getNameColors('CHI').text).toBe('#c83803');
    expect(getNameColors('PIT').text).toBe('#ffb612');
    // LV's black jersey falls through to silver.
    expect(getNameColors('LV').text).toBe('#a5acaf');
  });

  test('every team\'s name text is readable on the black band', () => {
    for (const abbr of ALL_32) {
      const { text } = getNameColors(abbr);
      expect(colorDistance(text, BLACK)).toBeGreaterThanOrEqual(CONTRAST_THRESHOLD);
    }
  });

  test('shadow always differs from the text color', () => {
    for (const abbr of ALL_32) {
      const { text, shadow } = getNameColors(abbr);
      expect(shadow).not.toBe(text);
    }
  });

  test('unknown abbreviation gets the fallback kit, not a crash', () => {
    const { text, stripe } = getNameColors('ZZZ');
    expect(text).toBe(FALLBACK_KIT.jersey);
    expect(stripe).toBe(FALLBACK_KIT.jersey);
  });
});
