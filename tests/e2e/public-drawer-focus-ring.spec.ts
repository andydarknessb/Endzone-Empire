// The public header's mobile drawer draws every keyboard focus ring whole (#2908).
//
// WHY A BROWSER SPEC: the ring is a computed outline, and whether it is clipped
// depends on where each item sits inside the right-anchored drawer Paper after
// the slide-in. jsdom has no layout and runs no transition, so only a real
// browser can read the edges.
//
// Signed out, so nothing reaches Supabase or Tank01: mockAnonymousApi answers
// /api/** with the signed-out responses.
import { test, expect, type Page } from '@playwright/test';
import { mockAnonymousApi } from './fixtures/anonymousApi';
import { setTheme, type ThemeMode } from './fixtures/draftHarness';

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
  outlineOffset: string;
};

// Reads the focused drawer item. Null when focus is not on one (the Wordmark
// link, the Close button, the auth buttons, or the Paper itself).
async function probeFocused(page: Page): Promise<Probe | null> {
  return page.evaluate((sel) => {
    const items = Array.from(document.querySelectorAll(sel));
    const index = items.indexOf(document.activeElement as Element);
    if (index < 0) return null;
    const r = items[index].getBoundingClientRect();
    const paper = (document.querySelector('.MuiDrawer-paper') as HTMLElement).getBoundingClientRect();
    const cs = getComputedStyle(items[index]);
    return {
      index,
      left: r.left,
      right: r.right,
      paperLeft: paper.left,
      paperRight: paper.right,
      viewportWidth: window.innerWidth,
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      outlineOffset: cs.outlineOffset,
    };
  }, DRAWER_ITEM);
}

// Tabs through the drawer and measures each distinct item once. The focus trap
// wraps (Wordmark, Close, the five items, Log In, Register), so the first repeat
// ends the walk; twelve Tab stops cover one full lap plus the repeat.
async function measureDrawerItems(page: Page): Promise<Probe[]> {
  const seen = new Map<number, Probe>();
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab');
    const probe = await probeFocused(page);
    if (!probe) continue;
    if (seen.has(probe.index)) break;
    seen.set(probe.index, probe);
  }
  return [...seen.values()];
}

for (const mode of ['light', 'dark'] as ThemeMode[]) {
  test.describe(`Public drawer focus ring, ${mode} (#2908)`, () => {
    test('every focused drawer item shows its whole ring inside the drawer', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await setTheme(page, mode);
      await mockAnonymousApi(page);
      await page.goto('/rankings');
      await expect(page.getByText('Josh Allen', { exact: true })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);

      await page.getByRole('button', { name: 'Open navigation menu' }).click();
      await expect(page.locator('.MuiDrawer-paper')).toBeVisible();
      // The Paper slides in from the right; measuring mid-slide puts the ring
      // off the edges for reasons that are not the defect.
      await expect
        .poll(() =>
          page.locator('.MuiDrawer-paper').evaluate((el) => window.innerWidth - el.getBoundingClientRect().left),
        )
        .toBe(260);

      const probes = await measureDrawerItems(page);
      const domCount = await page.locator(DRAWER_ITEM).count();
      expect(domCount).toBe(5);
      expect(probes.length).toBe(domCount);

      const violations = probes.flatMap((p) => {
        const problems: string[] = [];
        const width = parseFloat(p.outlineWidth);
        const offset = parseFloat(p.outlineOffset);
        if (p.outlineStyle !== 'solid') problems.push(`outline-style ${p.outlineStyle}`);
        if (p.outlineWidth !== '2px') problems.push(`outline-width ${p.outlineWidth}`);
        const leftEdge = p.left - offset - width;
        const rightEdge = p.right + offset + width;
        const paperRight = Math.min(p.paperRight, p.viewportWidth);
        if (leftEdge < p.paperLeft) problems.push(`left ring edge ${leftEdge}px, past ${p.paperLeft}px`);
        if (rightEdge > paperRight) problems.push(`right ring edge ${rightEdge}px, past ${paperRight}px`);
        return problems.length ? [`item ${p.index}: ${problems.join('; ')}`] : [];
      });
      expect(violations).toEqual([]);
    });
  });
}
