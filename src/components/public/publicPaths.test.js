import { isPublicPath, PUBLIC_PATH_PREFIXES } from './publicPaths';

describe('isPublicPath', () => {
  it('matches each public prefix exactly', () => {
    for (const prefix of PUBLIC_PATH_PREFIXES) {
      expect(isPublicPath(prefix)).toBe(true);
    }
  });

  it('matches deep sub-paths (the hard-refresh case)', () => {
    expect(isPublicPath('/players/12345')).toBe(true);
    expect(isPublicPath('/recaps/20260112_KC@BUF')).toBe(true);
    expect(isPublicPath('/strategy/draft-by-tiers')).toBe(true);
    expect(isPublicPath('/rankings')).toBe(true);
    expect(isPublicPath('/draft-simulator')).toBe(true);
    expect(isPublicPath('/players/12345/')).toBe(true); // trailing slash tolerated
  });

  it('does not match the authed app (whose real pathname is "/")', () => {
    expect(isPublicPath('/')).toBe(false);
    expect(isPublicPath('')).toBe(false);
    expect(isPublicPath('/league/7/draft')).toBe(false);
    expect(isPublicPath('/user')).toBe(false);
  });

  it('does not match look-alike paths that only share a prefix string', () => {
    expect(isPublicPath('/playersfoo')).toBe(false);
    expect(isPublicPath('/rankings-abuse')).toBe(false);
    expect(isPublicPath('/waiver-wired')).toBe(false);
    // The authed mock draft lives at /#/draft-sim — its pathname is '/'.
    expect(isPublicPath('/draft-sim')).toBe(false);
    expect(isPublicPath('/draft-simulator-x')).toBe(false);
  });
});
