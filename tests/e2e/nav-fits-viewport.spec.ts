// The app nav fits the viewport at every width (#927).
//
// WHY A BROWSER SPEC, AND WHY IT MEASURES THE TOOLBAR ELEMENT rather than the
// document:
//   - jsdom cannot bind or break this fix. MUI puts BOTH branches of a
//     responsive `sx` inside `@media` queries, jsdom ignores media queries in
//     getComputedStyle and has no `matchMedia`, so in every jsdom render the
//     desktop links, the desktop search AND the mobile hamburger are all
//     present at once. Only a real browser resolves the breakpoints. Hence
//     Playwright.
//   - The assertions are scoped to the Toolbar element, not the document, for
//     two reasons. (1) It is route-independent: the overflow is chrome, not a
//     page, so any authenticated route shows it. (2) It survives the Draft
//     route's desktop shell, which is `height:100vh; overflow:hidden` and so
//     clips the document - a `document.scrollWidth` assertion there is vacuous
//     at md+, but the Toolbar's own scrollWidth still sees the overflow. That
//     lets this spec host on the already-mocked Draft route as an incidental
//     authenticated host, needing zero new route-table entries (the nav's own
//     mount-time calls - /api/user, /api/notifications, /api/players - are
//     already answered by the Draft harness).
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
} from './fixtures/draftHarness';
import type { Page } from '@playwright/test';
import { ACTIVE_STATE, ACTIVE_PICKS } from './fixtures/draftFixtures';

const TOOLBAR = '[data-testid="app-nav-toolbar"]';
const CLUSTER = '[data-testid="nav-right-cluster"]';

// The AC width set: the two overflow bands (320..385 and 900..1085) sampled at
// their edges and interior, plus green controls on either side of each band.
const WIDTHS = [320, 360, 385, 390, 768, 900, 960, 1024, 1085, 1100, 1200];

type ClusterChild = { label: string; left: number; right: number };
type Measurement = {
  scrollWidth: number;
  clientWidth: number;
  fits: boolean;
  overlaps: Array<{ a: string; b: string; by: number }>;
};

// Read the Toolbar's own overflow and the right cluster's child geometry in one
// page round trip. The overlap check looks only at rendered (non-zero-area)
// children so a CSS-hidden sibling (the inline search below `lg`) is not counted
// as a phantom overlap, and compares each adjacent pair in DOM order.
async function measure(page: Page): Promise<Measurement> {
  return page.evaluate(
    ({ toolbarSel, clusterSel }) => {
      const toolbar = document.querySelector(toolbarSel) as HTMLElement;
      const cluster = document.querySelector(clusterSel) as HTMLElement | null;
      const labelOf = (el: Element): string =>
        el.getAttribute('aria-label') ||
        (el.textContent || '').trim().slice(0, 24) ||
        el.tagName.toLowerCase();

      const children: Array<{ label: string; left: number; right: number }> = [];
      if (cluster) {
        for (const child of Array.from(cluster.children)) {
          const r = child.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            children.push({ label: labelOf(child), left: r.left, right: r.right });
          }
        }
      }

      const overlaps: Array<{ a: string; b: string; by: number }> = [];
      for (let i = 0; i < children.length - 1; i += 1) {
        const cur = children[i];
        const next = children[i + 1];
        const by = cur.right - next.left;
        // > 1px of overlap: subpixel touching at a shared edge is not a defect.
        if (by > 1) overlaps.push({ a: cur.label, b: next.label, by: Math.round(by * 100) / 100 });
      }

      return {
        scrollWidth: toolbar.scrollWidth,
        clientWidth: toolbar.clientWidth,
        fits: toolbar.scrollWidth <= toolbar.clientWidth + 1,
        overlaps,
      };
    },
    { toolbarSel: TOOLBAR, clusterSel: CLUSTER }
  );
}

async function openAuthedHost(page: Page) {
  await setTheme(page, 'light');
  await installDraftSocketHarness(page, { ...ACTIVE_STATE });
  await installDraftRestApi(page, { league: ACTIVE_STATE.league, picks: ACTIVE_PICKS });
  await gotoDraft(page);
  await expect(page.locator(TOOLBAR)).toBeVisible();
}

test.describe('Nav fits the viewport (#927)', () => {
  test('the toolbar never overflows and its right-cluster children never overlap, across the width set', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await openAuthedHost(page);

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      // A resize crosses breakpoints and remounts responsive branches, so poll
      // until the geometry settles. Poll the measured VALUE, not a boolean, so a
      // persistent regression prints the pixel overflow AND the overlapping
      // sibling names into the failure. The overlap is the defect the width
      // predicate cannot see - the search can slide ~158px under the icon
      // buttons while scrollWidth still reads exactly the viewport - so its
      // labels have to survive into the message (each entry is {a, b, by}).
      await expect
        .poll(async () => {
          const m = await measure(page);
          return { over: Math.max(0, m.scrollWidth - m.clientWidth), overlaps: m.overlaps };
        }, { message: `nav geometry at ${width}px` })
        .toEqual({ over: 0, overlaps: [] });
    }
  });

  // Permanent negative control #1 (the width predicate can still fail). A guard
  // that can never go red is not a guard; the one-time red-tell in the PR body
  // proves it at merge, this proves it on every run. A fixed-width element wider
  // than the viewport is injected into the toolbar, the width predicate is
  // asserted to catch it, then the element is removed.
  test('negative control: the width predicate reports an injected over-wide toolbar child', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await openAuthedHost(page);

    await page.evaluate((sel) => {
      const toolbar = document.querySelector(sel) as HTMLElement;
      const spacer = document.createElement('div');
      spacer.id = 'nav-927-width-control';
      spacer.style.flex = '0 0 auto';
      spacer.style.width = '2000px';
      spacer.style.height = '1px';
      toolbar.appendChild(spacer);
    }, TOOLBAR);

    const withControl = await measure(page);
    expect(
      withControl.fits,
      `injected 2000px child did not force overflow: scrollWidth=${withControl.scrollWidth} clientWidth=${withControl.clientWidth}`
    ).toBe(false);

    await page.evaluate(() => document.getElementById('nav-927-width-control')?.remove());
    const restored = await measure(page);
    expect(restored.fits, 'toolbar did not return to fitting after removing the control').toBe(true);
  });

  // Permanent negative control #2 (the overlap predicate can still fail). This
  // is the assertion that catches the zero-minimum trap the width predicate
  // alone passes: a negative margin slides one cluster child under the next,
  // which the overlap check must report even though the document reports no
  // overflow.
  test('negative control: the overlap predicate reports an injected sibling overlap', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await openAuthedHost(page);

    const applied = await page.evaluate((sel) => {
      const cluster = document.querySelector(sel) as HTMLElement;
      const kids = Array.from(cluster.children) as HTMLElement[];
      // Pull the last child left under its predecessor.
      const target = kids[kids.length - 1];
      target.style.marginLeft = '-60px';
      return Boolean(target);
    }, CLUSTER);
    expect(applied, 'no cluster child to perturb').toBe(true);

    const perturbed = await measure(page);
    expect(
      perturbed.overlaps.length,
      'a -60px margin did not produce a detectable overlap'
    ).toBeGreaterThan(0);

    await page.evaluate((sel) => {
      const cluster = document.querySelector(sel) as HTMLElement;
      const kids = Array.from(cluster.children) as HTMLElement[];
      kids[kids.length - 1].style.marginLeft = '';
    }, CLUSTER);
    const restored = await measure(page);
    expect(restored.overlaps, 'overlap persisted after removing the injected margin').toEqual([]);
  });

  // The "/" shortcut is no longer swallowed below the desktop breakpoint (#927;
  // its narrow-window behaviour is #934). This can only be proven in a browser:
  // jsdom renders the inline search focusable regardless of width, so it can
  // neither see the swallow nor the fix.
  test('below `lg`, pressing "/" is not consumed by the (hidden) inline search', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await openAuthedHost(page);

    // Record whether the app's window handler called preventDefault. This
    // listener is registered AFTER the app's (which mounts with the nav), so on
    // a shared window in bubble phase it runs second and reads the outcome.
    await page.evaluate(() => {
      (window as unknown as { __slashDefaultPrevented?: boolean }).__slashDefaultPrevented = undefined;
      window.addEventListener('keydown', (e) => {
        if (e.key === '/') {
          (window as unknown as { __slashDefaultPrevented?: boolean }).__slashDefaultPrevented = e.defaultPrevented;
        }
      });
      (document.activeElement as HTMLElement | null)?.blur();
    });

    await page.keyboard.press('/');

    const prevented = await page.evaluate(
      () => (window as unknown as { __slashDefaultPrevented?: boolean }).__slashDefaultPrevented
    );
    expect(prevented, 'the "/" key was consumed (preventDefault) below the desktop breakpoint').toBe(false);
    // The hidden inline search did not steal focus.
    await expect(page.getByLabel('Search players')).not.toBeFocused();
  });

  test('at `lg` and above, pressing "/" focuses the inline search', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await openAuthedHost(page);

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('/');

    await expect(page.getByLabel('Search players')).toBeFocused();
  });

  // The brand link keeps its accessible name at every width, including the
  // narrow-phone widths where the wordmark text is not rendered (icon-only).
  test('the brand link keeps the accessible name "Endzone Empire" icon-only and full', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await openAuthedHost(page);
    await expect(page.getByRole('link', { name: 'Endzone Empire' })).toBeVisible();

    await page.setViewportSize({ width: 1200, height: 900 });
    await expect(page.getByRole('link', { name: 'Endzone Empire' })).toBeVisible();
  });

  // Below `lg` the hamburger opens a drawer with a working player search; at
  // `lg`+ the six inline links and the inline search are present.
  test('below `lg` the drawer holds the search; at `lg`+ the inline links and search are present', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await openAuthedHost(page);

    // Compact arrangement: hamburger present, inline links absent.
    await expect(page.getByRole('button', { name: 'open navigation menu' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toHaveCount(0);

    await page.getByRole('button', { name: 'open navigation menu' }).click();
    const drawer = page.locator('.MuiDrawer-paper');
    const drawerNav = drawer.getByRole('navigation', { name: 'Navigation menu' });
    await expect(drawerNav.getByRole('link', { name: 'League' })).toBeVisible();
    // The drawer's own search (the inline app-bar instance is CSS-hidden here),
    // scoped to the drawer so it is unambiguous.
    await expect(drawer.getByRole('combobox', { name: 'Search players' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Desktop arrangement at `lg`+: the six inline links and the inline search.
    await page.setViewportSize({ width: 1200, height: 900 });
    const primaryNav = page.getByRole('navigation', { name: 'Primary navigation' });
    await expect(primaryNav.getByRole('link', { name: 'Home' })).toBeVisible();
    await expect(primaryNav.getByRole('link', { name: 'Mock Draft' })).toBeVisible();
    await expect(
      page.getByTestId('nav-right-cluster').getByRole('combobox', { name: 'Search players' })
    ).toBeVisible();
  });
});
