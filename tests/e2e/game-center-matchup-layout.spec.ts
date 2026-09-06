/**
 * Layout guard for Game Center and Matchup Detail (#920, refs #916/#921).
 *
 * jsdom has no layout engine, so every geometry defect in this area (#916,
 * #921) was measured by hand in headless Chromium and written into a test
 * comment; the jsdom suites bind the CSS RULES, which is the right binding for
 * a rule but says nothing about the rendered result. This spec binds the
 * rendered GEOMETRY of three page shapes - Game Center, Matchup Detail in the
 * Standard view, and Matchup Detail in the Scoreboard view - at five widths,
 * to two invariants:
 *
 *   1. No page grows wider than its column, and (away from #927) wider than the
 *      viewport.
 *   2. No header control is covered, in two complementary forms: (a) an
 *      elementFromPoint hit test at each control's centre and inset corners
 *      (catches an occluder painted ON TOP of a control), and (b) a
 *      bounding-box overlap check between the header's non-nested regions -
 *      including the h1 and the breadcrumb, which are not controls but are what
 *      the #921 title-column and header-wrap defects push onto the picker/toggle
 *      (the issue body's "compare bounding boxes ... for the h1 and the picker").
 *      Form (b) is required because when an earlier element overflows its column
 *      UNDER a later control, the control is painted on top, so elementFromPoint
 *      still resolves to it and form (a) alone cannot see the defect.
 *
 * It runs in the `browser-security` job (`npm run test:e2e`), which collects
 * every spec under tests/e2e with no file argument, so this file is picked up
 * with no workflow edit. It is Chromium-only (the e2e config declares no
 * projects). It duplicates no jsdom rule assertion and does not replace the
 * jsdom suites: those bind the rules and run on a much faster job.
 *
 * What this guard does NOT cover, and its green must NOT be read as covering:
 *   - the NFL game strip (needs Supabase, unreachable in CI without env vars),
 *   - the last-plays ticker (needs a socket play this harness never fires),
 *   - the bench what-if (live-only; this fixture is `played`, not `live`),
 *   - the bench panel (collapsed by default).
 * It also routes AROUND #927 (the app nav overflows between 900 and 1024, its
 * own ticket): the document-width assertion is skipped at 900, through the
 * named constant below, and must be lifted when #927 lands rather than
 * forgotten.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  setupLayoutGuard,
  GAME_CENTER_URL,
  MATCHUP_URL,
  LEAGUE_ID,
} from './fixtures/layoutGuardFixtures';

// The corner-inset floor. Measured: 0/1/2 fail broadly and 3 still fails on
// some controls, because the miss is the 9px border-radius corner (for r=9 the
// corner point is outside the rounded shape until ~2.64px, and sub-pixel rect
// origins push the practical floor to 4), not occlusion. 6 keeps a margin.
const INSET = 6;

// The document-width assertion is skipped at this width: at 900 the document is
// wider than the viewport because the app nav overflows (measured 1086px),
// filed as #927. That is app chrome, not these pages. LIFT this exclusion when
// #927 lands. The column assertion still runs at 900.
const WIDTH_927_NAV_OVERFLOW = 900;

const WIDTHS = [
  { w: 390, h: 844 },
  { w: 640, h: 900 },
  { w: 900, h: 900 },
  { w: 1440, h: 900 },
  { w: 1920, h: 900 },
];

// The Matchup toggle and Set-lineup are dropped from the header below this
// width (Set lineup moves to the bottom of the page there, and is not header
// chrome).
const SM_BREAKPOINT = 600;

type Control = { key: string; selector: string; self: string; text?: string };

// ---- Browser-side probes (self-contained: serialised to the page, so they
// close over nothing in this module). ----

/**
 * Width oracle for one element. Returns its `scrollWidth`/`clientWidth` and,
 * for the failure message, the descendant whose right edge overhangs the
 * element's content box by the most (found by walking the DOM). Pass ':root'
 * for the document element.
 */
function probeWidth(selector: string) {
  const isRoot = selector === ':root';
  const el = isRoot ? document.documentElement : document.querySelector(selector);
  if (!el) return { found: false, selector, scrollWidth: 0, clientWidth: 0, worst: null };
  const scrollWidth = el.scrollWidth;
  const clientWidth = el.clientWidth;
  const originLeft = isRoot ? 0 : el.getBoundingClientRect().left + (el as HTMLElement).clientLeft;
  let worst: { overhang: number; tag: string; testid: string | null; name: string | null } | null = null;
  el.querySelectorAll('*').forEach((child) => {
    const cr = child.getBoundingClientRect();
    if (cr.width === 0 && cr.height === 0) return;
    const overhang = Math.round((cr.right - originLeft) - clientWidth);
    if (overhang > 0 && (!worst || overhang > worst.overhang)) {
      worst = {
        overhang,
        tag: child.tagName.toLowerCase(),
        testid: child.getAttribute('data-testid'),
        name: child.getAttribute('aria-label') || (child.textContent || '').trim().slice(0, 40) || null,
      };
    }
  });
  return { found: true, selector, scrollWidth, clientWidth, worst };
}

/**
 * Header-occlusion oracle. Scrolls to (0,0) first (the week strip's mount-time
 * centring scrolls the DOCUMENT sideways at some widths, and a rect/hit test on
 * a control scrolled out of the viewport returns null, which means off-viewport,
 * never occluded). For each control: locate it inside the header, skip it while
 * disabled (a disabled chevron carries `pointer-events: none`, so every sample
 * falls through to the row behind it - the normal case, not an edge), then
 * sample the centre and the four corners inset by `inset`, resolving each hit
 * with elementFromPoint().closest(control's own selector). The control passes
 * only when every sample resolves back to it.
 */
function probeOcclusion(args: { headerSelector: string; controls: Control[]; inset: number }) {
  const { headerSelector, controls, inset } = args;
  window.scrollTo(0, 0);
  const result = {
    headerFound: false,
    probed: [] as string[],
    skippedDisabled: [] as string[],
    missing: [] as string[],
    failures: [] as Array<{
      control: string;
      controlName: string;
      point: string;
      reason: string;
      occluder: { tag: string; testid: string | null; name: string | null } | null;
    }>,
  };
  const header = document.querySelector(headerSelector);
  if (!header) return result;
  result.headerFound = true;

  const accName = (el: Element) =>
    el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 40) || el.getAttribute('data-testid') || el.tagName.toLowerCase();
  const isDisabled = (el: Element) =>
    (el as HTMLButtonElement).disabled === true ||
    el.getAttribute('aria-disabled') === 'true' ||
    getComputedStyle(el).pointerEvents === 'none';

  for (const c of controls) {
    let matches = Array.from(header.querySelectorAll(c.selector));
    if (c.text != null) matches = matches.filter((el) => (el.textContent || '').trim() === c.text);
    const el = matches[0];
    if (!el) { result.missing.push(c.key); continue; }
    if (isDisabled(el)) { result.skippedDisabled.push(c.key); continue; }

    const r = el.getBoundingClientRect();
    const points = [
      { name: 'center', x: r.left + r.width / 2, y: r.top + r.height / 2 },
      { name: 'top-left', x: r.left + inset, y: r.top + inset },
      { name: 'top-right', x: r.right - inset, y: r.top + inset },
      { name: 'bottom-left', x: r.left + inset, y: r.bottom - inset },
      { name: 'bottom-right', x: r.right - inset, y: r.bottom - inset },
    ];
    let ok = true;
    for (const p of points) {
      const hit = document.elementFromPoint(p.x, p.y);
      const resolved = hit ? hit.closest(c.self) : null;
      if (resolved !== el) {
        ok = false;
        result.failures.push({
          control: c.key,
          controlName: accName(el),
          point: p.name,
          reason: hit ? 'occluded' : 'null/off-viewport',
          occluder: hit
            ? { tag: hit.tagName.toLowerCase(), testid: hit.getAttribute('data-testid'), name: accName(hit) }
            : null,
        });
        break; // the first failing sample is enough to diagnose
      }
    }
    if (ok) result.probed.push(c.key);
  }
  return result;
}

/**
 * Bounding-box overlap oracle (the issue body's assertion 2: "no two interactive
 * controls in the header overlap ... compare bounding boxes ... for the h1 and
 * the picker"). It complements the elementFromPoint probe above, which by
 * construction only catches an occluder painted ON TOP of a control: when an
 * earlier sibling's content (the h1, the breadcrumb) overflows its own column
 * and lands UNDER a later control, elementFromPoint at the control still returns
 * the control (it is on top), so that defect - exactly the #921 title-column and
 * the Matchup header-wrap red-tells - is invisible to it. Two rects overlapping
 * in BOTH axes by more than `tol` is that defect, whatever the paint order.
 *
 * `regions` are NON-NESTED header areas (a control never nested in another, and
 * never a container that holds another region), so a legitimate parent/child
 * (the checked radio inside its radiogroup) is never reported. A region absent
 * at this width is skipped, not failed - the control-count assertion owns
 * "stopped rendering".
 */
function probeRegionOverlap(args: { headerSelector: string; regions: Array<{ key: string; selector: string; text?: string }>; tol: number }) {
  const { headerSelector, regions, tol } = args;
  window.scrollTo(0, 0);
  const result = { headerFound: false, overlaps: [] as Array<{ a: string; b: string; x: number; y: number }> };
  const header = document.querySelector(headerSelector);
  if (!header) return result;
  result.headerFound = true;
  const resolved: Array<{ key: string; rect: DOMRect }> = [];
  for (const rg of regions) {
    let matches = Array.from(header.querySelectorAll(rg.selector));
    if (rg.text != null) matches = matches.filter((el) => (el.textContent || '').trim() === rg.text);
    const el = matches[0];
    if (!el) continue;
    resolved.push({ key: rg.key, rect: el.getBoundingClientRect() });
  }
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const a = resolved[i].rect;
      const b = resolved[j].rect;
      const x = Math.round(Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const y = Math.round(Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      if (x > tol && y > tol) result.overlaps.push({ a: resolved[i].key, b: resolved[j].key, x, y });
    }
  }
  return result;
}

// ---- Failure messages ----

type WidthResult = ReturnType<typeof probeWidth>;
type OcclusionResult = ReturnType<typeof probeOcclusion>;

function widthMessage(target: string, shapeName: string, width: number, r: WidthResult): string {
  const w = r.worst;
  const worst = w
    ? ` worst overhang: <${w.tag}${w.testid ? ` data-testid="${w.testid}"` : ''}> "${w.name ?? ''}" overhangs by ${w.overhang}px`
    : ' (no overhanging element found)';
  return `${shapeName} @ ${width}: ${target} scrollWidth=${r.scrollWidth} clientWidth=${r.clientWidth}.${worst}`;
}

function occlusionMessage(shapeName: string, width: number, r: OcclusionResult): string {
  if (r.failures.length === 0) return `${shapeName} @ ${width}: no occlusion`;
  return `${shapeName} @ ${width}: ` + r.failures
    .map((f) => {
      const o = f.occluder
        ? `<${o_tag(f)}${f.occluder.testid ? ` data-testid="${f.occluder.testid}"` : ''}> "${f.occluder.name ?? ''}"`
        : '(off-viewport / null)';
      return `"${f.controlName}" ${f.reason} at ${f.point} by ${o}`;
    })
    .join('; ');
}
function o_tag(f: OcclusionResult['failures'][number]): string {
  return f.occluder ? f.occluder.tag : '';
}

type OverlapResult = ReturnType<typeof probeRegionOverlap>;

function overlapMessage(shapeName: string, width: number, r: OverlapResult): string {
  if (r.overlaps.length === 0) return `${shapeName} @ ${width}: no header-region overlap`;
  return `${shapeName} @ ${width}: header regions overlap: ` + r.overlaps.map((o) => `"${o.a}" and "${o.b}" overlap by ${o.x}x${o.y}px`).join('; ');
}

// A parseable line per measured width pair, for the PR body (15 container pairs
// + 12 document pairs). Grepped from the run output; harmless otherwise.
function logPair(shapeName: string, width: number, target: string, r: WidthResult): void {
  // eslint-disable-next-line no-console
  console.log(`LAYOUT_GUARD_PAIR ${JSON.stringify({ shape: shapeName, width, target, scrollWidth: r.scrollWidth, clientWidth: r.clientWidth })}`);
}

// ---- Control lists ----

const GAME_CENTER_CONTROLS: Control[] = [
  { key: 'previous-week', selector: 'button[aria-label="Previous week"]', self: 'button[aria-label="Previous week"]' },
  { key: 'next-week', selector: 'button[aria-label="Next week"]', self: 'button[aria-label="Next week"]' },
  { key: 'week-radiogroup', selector: '[data-testid="pick-week-weeks"]', self: '[role="radiogroup"]' },
  { key: 'checked-week', selector: '[data-testid="pick-week-weeks"] [role="radio"][aria-checked="true"]', self: '[role="radio"]' },
  { key: 'all-weeks', selector: '[data-testid="pick-week"] button[aria-pressed]', self: 'button[aria-pressed]' },
];

// Non-nested header regions for the bounding-box overlap check. The h1 is not a
// control (it is not hit-tested), but it is the element the title-column (#921)
// and header-wrap defects push onto the picker/toggle, so it is compared here.
const GAME_CENTER_REGIONS = [
  { key: 'h1', selector: 'h1' },
  { key: 'week-picker', selector: '[data-testid="pick-week"]' },
];

function matchupRegions(width: number) {
  const regions = [
    { key: 'breadcrumb', selector: '[data-testid="matchup-breadcrumb"]' },
    { key: 'h1', selector: 'h1' },
    { key: 'view-toggle', selector: '[data-testid="toggle-matchup-view"]' },
  ];
  if (width >= SM_BREAKPOINT) regions.push({ key: 'set-lineup', selector: '[data-testid="set-lineup"][data-placement="header"]' });
  return regions;
}

function matchupControls(width: number): Control[] {
  const base: Control[] = [
    { key: 'breadcrumb-league', selector: `[data-testid="matchup-breadcrumb"] a[href$="/league/${LEAGUE_ID}"]`, self: 'a' },
    { key: 'breadcrumb-game-center', selector: '[data-testid="matchup-breadcrumb"] a[href$="/game-center"]', self: 'a' },
    { key: 'standard-radio', selector: '[role="radio"]', text: 'Standard', self: '[role="radio"]' },
    { key: 'scoreboard-radio', selector: '[role="radio"]', text: 'Scoreboard', self: '[role="radio"]' },
  ];
  if (width >= SM_BREAKPOINT) {
    base.push({ key: 'set-lineup-header', selector: '[data-testid="set-lineup"][data-placement="header"]', self: '[data-testid="set-lineup"]' });
  }
  return base;
}

// ---- Page shapes ----

type Shape = {
  name: string;
  url: string;
  view?: 'standard' | 'scoreboard';
  columnSelector: string;
  headerSelector: string;
  ready: (page: Page) => Promise<void>;
  controls: (width: number) => Control[];
  regions: (width: number) => Array<{ key: string; selector: string; text?: string }>;
  // On this fixture the Game Center picker opens on Wk 18, so Next is disabled
  // at every width and four of the five controls are probed. The Matchup header
  // drops Set lineup below sm, so four below 600 and five at or above it.
  expectedProbed: (width: number) => number;
};

async function fontsReady(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

const SHAPES: Shape[] = [
  {
    name: 'Game Center',
    url: GAME_CENTER_URL,
    columnSelector: '[data-testid="game-center-column"]',
    headerSelector: '[data-testid="game-center-header"]',
    controls: () => GAME_CENTER_CONTROLS,
    regions: () => GAME_CENTER_REGIONS,
    expectedProbed: () => 4,
    ready: async (page) => {
      // Content first, then fonts: the header is fully mounted while loading,
      // with a 38px skeleton where the picker will be, so wait on the loaded
      // picker. `Wk 18` matched exactly, or `Wk 1` also matches it; the radio
      // proves the list really returned 18 weeks.
      await page.getByRole('radio', { name: 'Wk 18', exact: true }).waitFor();
      await expect(page.locator('[data-testid="pick-week-weeks"] [role="radio"][aria-checked="true"]')).toHaveCount(1);
      await fontsReady(page);
    },
  },
  {
    name: 'Matchup Standard',
    url: MATCHUP_URL,
    view: 'standard',
    columnSelector: '[data-testid="matchup-column"]',
    headerSelector: '[data-testid="matchup-header"]',
    controls: matchupControls,
    regions: matchupRegions,
    expectedProbed: (width) => (width >= SM_BREAKPOINT ? 5 : 4),
    ready: async (page) => {
      // The whole header is absent while loading here (the opposite trap to
      // Game Center); the container renders in both states. The league row
      // arrives after the header and fills the starters table, changing the
      // document height by hundreds of pixels, which decides whether a vertical
      // scrollbar exists and therefore what clientWidth is - so wait for the
      // first starter row, not merely the header.
      await page.getByRole('radio', { name: 'Standard', exact: true }).waitFor();
      await page.getByTestId('slot-row').first().waitFor();
      await fontsReady(page);
    },
  },
  {
    name: 'Matchup Scoreboard',
    url: MATCHUP_URL,
    view: 'scoreboard',
    columnSelector: '[data-testid="matchup-column"]',
    headerSelector: '[data-testid="matchup-header"]',
    controls: matchupControls,
    regions: matchupRegions,
    expectedProbed: (width) => (width >= SM_BREAKPOINT ? 5 : 4),
    ready: async (page) => {
      // The Scoreboard view carries no starters table, so wait on a
      // Scoreboard-only node (the retro LED board), not merely the header.
      await page.getByRole('radio', { name: 'Standard', exact: true }).waitFor();
      await page.getByTestId('led-board').waitFor();
      await fontsReady(page);
    },
  },
];

for (const shape of SHAPES) {
  for (const { w, h } of WIDTHS) {
    test(`${shape.name} @ ${w}x${h}: page never wider than its column or the viewport, no header control occluded`, async ({ page }) => {
      await setupLayoutGuard(page, { view: shape.view });
      await page.setViewportSize({ width: w, height: h });
      await page.goto(shape.url);
      await shape.ready(page);

      // Assertion 1a: the page's own column never overflows itself. This is the
      // one that bites: the columns cap at 1120/1200px, so at a wide viewport a
      // child can overflow its own column by up to 160px without ever reaching
      // the document edge.
      const column = await page.evaluate(probeWidth, shape.columnSelector);
      logPair(shape.name, w, 'container', column);
      expect(column.found, `${shape.columnSelector} must exist`).toBe(true);
      expect(column.scrollWidth, widthMessage('container', shape.name, w, column)).toBeLessThanOrEqual(column.clientWidth + 1);

      // Assertion 1b: the document never overflows the viewport (compare against
      // clientWidth, never innerWidth, which includes the scrollbar and would
      // tolerate ~15px of real overflow). Skipped at 900 (#927).
      if (w !== WIDTH_927_NAV_OVERFLOW) {
        const doc = await page.evaluate(probeWidth, ':root');
        logPair(shape.name, w, 'document', doc);
        expect(doc.scrollWidth, widthMessage('document', shape.name, w, doc)).toBeLessThanOrEqual(doc.clientWidth + 1);
      }

      // Assertion 2: no header control is occluded, and every control that
      // should render at this width did (a control that quietly stops rendering
      // must fail, not be silently skipped).
      const res = await page.evaluate(probeOcclusion, {
        headerSelector: shape.headerSelector,
        controls: shape.controls(w),
        inset: INSET,
      });
      expect(res.headerFound, `${shape.headerSelector} must exist`).toBe(true);
      expect(res.missing, `controls that stopped rendering: ${res.missing.join(', ') || '(none)'}`).toEqual([]);
      expect(res.failures, occlusionMessage(shape.name, w, res)).toEqual([]);
      expect(
        res.probed.length,
        `probed [${res.probed.join(', ')}], skipped-disabled [${res.skippedDisabled.join(', ')}]`,
      ).toBe(shape.expectedProbed(w));

      // Assertion 2b: no header region overlaps another (bounding boxes). This
      // catches an earlier element (the h1, the breadcrumb) overflowing its own
      // column UNDER a later control, which the elementFromPoint probe above
      // cannot see because the control is painted on top.
      const overlap = await page.evaluate(probeRegionOverlap, {
        headerSelector: shape.headerSelector,
        regions: shape.regions(w),
        tol: 1,
      });
      expect(overlap.headerFound, `${shape.headerSelector} must exist`).toBe(true);
      expect(overlap.overlaps, overlapMessage(shape.name, w, overlap)).toEqual([]);
    });
  }
}

// ---- Red-tell outcomes (#920, each run in Chromium; see the PR body) ----
//
// Game Center (both fire, and each co-binds the jsdom case in
// GameCenterPage.test.jsx that already claims it):
//   - Deleting `minWidth: 0` from the header row turns the Game Center @ 390
//     width case red: document 1347px inside a 390px viewport (the #916 signature
//     was ~1366px).
//   - Putting `minWidth: 0` back on the title column turns the Game Center @ 640
//     region-overlap case red: h1 over the picker by 11x38px (the #921 signature
//     was 11.47px), caught by the bounding-box check, not elementFromPoint (the
//     h1 overflows UNDER the chevron). The fixture serves no sync line, the
//     condition #921 measured.
//
// Matchup Detail (all three RUN, none reproduced with representative 22-30 char
// names and the real fonts loaded, so all three are dropped per the brief; the
// clip and wrap RULES stay bound by the jsdom widget/page suites):
//   - Deleting the header row's wrapping: no overlap at 390. The header content
//     fits with room to spare (left column min-content ~130px + the fill toggle
//     min-content ~180px < ~362px available), so the left column is never
//     squeezed below its content.
//   - Deleting the LED board team-name clip: no width overflow at 390. A 30-char
//     name at the mobile LED size fits its ~177px grid cell; the clip only bites
//     pathological (~48+ char) names.
//   - Deleting the scoreboard-strip team-name clip: no width overflow at 390. The
//     strip stacks below sm, giving each name a full ~362px row; a 30-char name
//     is ~186px. The clip only bites pathological names.
//
// ---- Permanent negative controls ----
//
// One per predicate: inject a style that forces the defect, assert the predicate
// reports it, remove it. The one-time red-tell mutations (recorded in the PR)
// verify the guard at merge; these keep it PROVING on every CI run that it can
// still go red - the failure mode a guard that has quietly stopped working looks
// exactly like. They run on Game Center at 1440, loaded.

test('negative control: the width predicate reports a forced column overflow', async ({ page }) => {
  await setupLayoutGuard(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(GAME_CENTER_URL);
  await SHAPES[0].ready(page);

  const before = await page.evaluate(probeWidth, '[data-testid="game-center-column"]');
  expect(before.scrollWidth, 'baseline column must not overflow').toBeLessThanOrEqual(before.clientWidth + 1);

  await page.evaluate(() => {
    const col = document.querySelector('[data-testid="game-center-column"]');
    const spacer = document.createElement('div');
    spacer.id = '__forced_overflow__';
    spacer.setAttribute('data-testid', 'forced-overflow');
    spacer.style.width = '4000px';
    spacer.style.height = '1px';
    col?.appendChild(spacer);
  });
  const during = await page.evaluate(probeWidth, '[data-testid="game-center-column"]');
  expect(during.scrollWidth, 'a forced 4000px child must overflow the column').toBeGreaterThan(during.clientWidth + 1);
  expect(during.worst, 'the overflowing child must be reported').not.toBeNull();

  await page.evaluate(() => document.getElementById('__forced_overflow__')?.remove());
  const after = await page.evaluate(probeWidth, '[data-testid="game-center-column"]');
  expect(after.scrollWidth, 'removing the spacer must restore the column').toBeLessThanOrEqual(after.clientWidth + 1);
});

test('negative control: the occlusion predicate reports a forced overlay', async ({ page }) => {
  await setupLayoutGuard(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(GAME_CENTER_URL);
  await SHAPES[0].ready(page);

  const clean = await page.evaluate(probeOcclusion, {
    headerSelector: '[data-testid="game-center-header"]',
    controls: GAME_CENTER_CONTROLS,
    inset: INSET,
  });
  expect(clean.failures, occlusionMessage('Game Center', 1440, clean)).toEqual([]);

  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="game-center-header"] [data-testid="pick-week"] button[aria-pressed]');
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const overlay = document.createElement('div');
    overlay.id = '__forced_overlay__';
    overlay.setAttribute('data-testid', 'forced-overlay');
    Object.assign(overlay.style, {
      position: 'fixed',
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      zIndex: '99999',
      background: 'rgba(255,0,0,0.5)',
    });
    document.body.appendChild(overlay);
  });
  const covered = await page.evaluate(probeOcclusion, {
    headerSelector: '[data-testid="game-center-header"]',
    controls: GAME_CENTER_CONTROLS,
    inset: INSET,
  });
  const hit = covered.failures.find((f) => f.control === 'all-weeks');
  expect(hit, 'an overlay over All weeks must be reported as occlusion').toBeTruthy();
  expect(hit?.occluder?.testid, 'the reported occluder must be the overlay').toBe('forced-overlay');

  await page.evaluate(() => document.getElementById('__forced_overlay__')?.remove());
  const restored = await page.evaluate(probeOcclusion, {
    headerSelector: '[data-testid="game-center-header"]',
    controls: GAME_CENTER_CONTROLS,
    inset: INSET,
  });
  expect(restored.failures, occlusionMessage('Game Center', 1440, restored)).toEqual([]);
});

test('negative control: the region-overlap predicate reports a forced h1 shift onto the picker', async ({ page }) => {
  await setupLayoutGuard(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(GAME_CENTER_URL);
  await SHAPES[0].ready(page);

  const clean = await page.evaluate(probeRegionOverlap, {
    headerSelector: '[data-testid="game-center-header"]',
    regions: GAME_CENTER_REGIONS,
    tol: 1,
  });
  expect(clean.overlaps, overlapMessage('Game Center', 1440, clean)).toEqual([]);

  // Slide the h1 to the right so its box overlaps the picker, the shape the
  // #921 title-column defect takes (the h1 overflowing onto the picker).
  await page.evaluate(() => {
    const h1 = document.querySelector('[data-testid="game-center-header"] h1') as HTMLElement | null;
    const picker = document.querySelector('[data-testid="game-center-header"] [data-testid="pick-week"]');
    if (!h1 || !picker) return;
    const shift = picker.getBoundingClientRect().left - h1.getBoundingClientRect().left + 20;
    h1.style.transform = `translateX(${shift}px)`;
  });
  const shifted = await page.evaluate(probeRegionOverlap, {
    headerSelector: '[data-testid="game-center-header"]',
    regions: GAME_CENTER_REGIONS,
    tol: 1,
  });
  expect(shifted.overlaps.some((o) => (o.a === 'h1' && o.b === 'week-picker') || (o.a === 'week-picker' && o.b === 'h1')), 'the shifted h1 must be reported as overlapping the picker').toBe(true);

  await page.evaluate(() => {
    const h1 = document.querySelector('[data-testid="game-center-header"] h1') as HTMLElement | null;
    if (h1) h1.style.transform = '';
  });
  const back = await page.evaluate(probeRegionOverlap, {
    headerSelector: '[data-testid="game-center-header"]',
    regions: GAME_CENTER_REGIONS,
    tol: 1,
  });
  expect(back.overlaps, overlapMessage('Game Center', 1440, back)).toEqual([]);
});
