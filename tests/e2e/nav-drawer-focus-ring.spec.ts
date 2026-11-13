// The signed-in mobile nav drawer draws every keyboard focus ring whole (#2904).
//
// WHY A BROWSER SPEC: the ring is a computed outline, and whether it is clipped
// depends on where each item sits inside the drawer's Paper after the slide-in.
// jsdom has no layout and runs no transition, so only a real browser can read
// the edges. The ring is clipped unless its outer edge stays inside the Paper.
//
// Nothing here reaches a live league, the shared Supabase database or Tank01:
// the Draft harness intercepts both the REST and Socket.IO channels in page.
import {
  test,
  expect,
  installDraftSocketHarness,
  installDraftRestApi,
  setTheme,
  gotoDraft,
  type ThemeMode,
} from './fixtures/draftHarness';
import type { Page } from '@playwright/test';
import { ACTIVE_STATE, ACTIVE_PICKS } from './fixtures/draftFixtures';

const DRAWER_ITEM = '.MuiDrawer-paper .MuiListItemButton-root';

type Probe = {
  index: number;
  left: number;
  right: number;
  paperLeft: number;
  paperRight: number;
  viewportWidth: number;
  outlineStyle: string;
  outlineWidth: string;
  ringWidth: number;
  outlineOffset: number;
};

// Reads the focused element. Null when focus is not on a drawer item (the
// drawer's search input, or the Paper itself).
async function probeFocused(page: Page): Promise<Probe | null> {
  return page.evaluate((sel) => {
    const items = Array.from(document.querySelectorAll(sel));
    const index = items.indexOf(document.activeElement as Element);
    if (index < 0) return null;
    const item = items[index] as HTMLElement;
    const r = item.getBoundingClientRect();
    const paper = (document.querySelector('.MuiDrawer-paper') as HTMLElement).getBoundingClientRect();
    const cs = getComputedStyle(item);
    return {
      index,
      left: r.left,
      right: r.right,
      paperLeft: paper.left,
      paperRight: paper.right,
      viewportWidth: window.innerWidth,
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      ringWidth: parseFloat(cs.outlineWidth),
      outlineOffset: parseFloat(cs.outlineOffset),
    };
  }, DRAWER_ITEM);
}

// Tabs through the drawer and measures each distinct item once. The focus trap
// wraps (search input, the items, search input, Home, League), so a Tab stop can
// land on an item already measured; the first repeat ends the walk.
async function measureDrawerItems(page: Page): Promise<Probe[]> {
  const seen = new Map<number, Probe>();
  const maxTabs = (await page.locator(DRAWER_ITEM).count()) + 4;
  for (let i = 0; i < maxTabs; i += 1) {
    await page.keyboard.press('Tab');
    const probe = await probeFocused(page);
    if (!probe) continue;
    if (seen.has(probe.index)) break;
    seen.set(probe.index, probe);
  }
  return [...seen.values()];
}

for (const mode of ['light', 'dark'] as ThemeMode[]) {
  test.describe(`Nav drawer focus ring, ${mode} (#2904)`, () => {
    test('every focused drawer item shows its whole ring inside the drawer', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await setTheme(page, mode);
      await installDraftSocketHarness(page, { ...ACTIVE_STATE });
      await installDraftRestApi(page, { league: ACTIVE_STATE.league, picks: ACTIVE_PICKS });
      await gotoDraft(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);

      await page.getByRole('button', { name: 'open navigation menu' }).click();
      await expect(page.locator('nav[aria-label="Navigation menu"]')).toBeVisible();
      // The Paper slides in from off screen; measuring mid-slide puts the ring
      // off the left edge for reasons that are not the defect.
      await expect
        .poll(() => page.locator('.MuiDrawer-paper').evaluate((el) => el.getBoundingClientRect().left))
        .toBe(0);

      const probes = await measureDrawerItems(page);
      const domCount = await page.locator(DRAWER_ITEM).count();
      expect(domCount).toBeGreaterThanOrEqual(3);
      expect(probes.length).toBe(domCount);

      const violations = probes.flatMap((p) => {
        const problems: string[] = [];
        if (p.outlineStyle !== 'solid') problems.push(`outline-style ${p.outlineStyle}`);
        if (p.outlineWidth !== '2px') problems.push(`outline-width ${p.outlineWidth}`);
        const leftEdge = p.left - p.outlineOffset - p.ringWidth;
        const rightEdge = p.right + p.outlineOffset + p.ringWidth;
        const paperLeft = Math.max(0, p.paperLeft);
        const paperRight = Math.min(p.paperRight, p.viewportWidth);
        if (leftEdge < paperLeft) problems.push(`left ring edge ${leftEdge}px, past ${paperLeft}px`);
        if (rightEdge > paperRight) problems.push(`right ring edge ${rightEdge}px, past ${paperRight}px`);
        return problems.length ? [`item ${p.index}: ${problems.join('; ')}`] : [];
      });
      expect(violations).toEqual([]);
    });
  });
}
