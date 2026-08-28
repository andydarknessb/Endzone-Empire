// The committed, human-browsable half of the Draft-room screenshot matrix
// (issue #548). The existing Playwright report attachments stay exactly as they
// were - a reviewer can still open the HTML report - but the report stores every
// attachment under a 40-hex hashed filename with no mapping to what it shows, so
// nobody browses it as a set. This helper writes the SAME captured bytes a
// second time to a stable, descriptive path under tests/e2e/draft-room-screenshots/
// so the set can be inspected as ordinary files, and re-running the spec
// regenerates it in place (#548 AC6/AC7).
//
// One capture, two destinations: the buffer is taken once and both attached and
// written, so the report image and the committed file are byte-identical and can
// never drift. Determinism is the whole point of committing binaries (a set that
// differs run to run is a perpetual binary diff nobody re-reviews), so every
// capture here freezes the sources of variance the matrix can reach:
//   - animations: 'disabled' finishes finite CSS transitions and cancels the
//     infinite ones (the on-the-clock cell pulse, the banner timer pulse),
//     rewinding them to one consistent frame;
//   - the text caret is hidden (Playwright's screenshot default), so a focused
//     composer never captures a mid-blink caret;
//   - document.fonts.ready is awaited so glyph metrics are settled before the
//     shot;
//   - callers that render a timestamp pin the browser timezone and locale
//     (test.use in the spec), so a wall-clock string is stable.
// Reduced-motion variants pass through here unchanged; the reduce emulation is
// set by the caller via page.emulateMedia, never by this helper.
import { promises as fs } from 'fs';
import path from 'path';
import type { Page, TestInfo, Locator } from '@playwright/test';

// The browsable set lives beside the spec that owns it, not under
// playwright-report/ or test-results/ (both gitignored), so it is committed and
// reviewable without decoding a report. README.md in this folder documents the
// one command that regenerates it.
export const MATRIX_DIR = path.join(__dirname, '..', 'draft-room-screenshots');

export type MatrixCaptureOptions = {
  /** The committed file's base name (no extension) and, unless `attach`
   *  overrides it, the report attachment name too. It names the capture's SCOPE
   *  first (`room-` for a whole-viewport shot, `region-` for an element shot) so a
   *  reader never has to guess whether they are looking at the room or one region. */
  file: string;
  /** The report attachment name, when it must differ from `file` - used to keep
   *  the three original captures' historical attachment names while giving their
   *  committed files new descriptive names. */
  attach?: string;
  /**
   * When set, capture THIS element rather than the viewport. Region-specific
   * states live inside independently-scrolling regions (the chat log, the
   * composer) or in a portal overlay (the emoji menu); the Draft room's shell is
   * pinned to exactly the viewport height (draft-board.spec.ts #122), so a
   * viewport shot would clip a region that its own scroller has pushed out of
   * view. An element shot frames the region whole, whatever its scroll position.
   * A whole-room state (the four-region composition, a selected tab's room) omits
   * this and captures the viewport, which is what a user sees without scrolling.
   */
  element?: Locator;
};

/**
 * Capture the page (or one element) once, attach it to the Playwright report AND
 * write it to the committed matrix folder under a stable descriptive name.
 * Returns the buffer so a caller can assert on it if it ever needs to.
 */
export async function captureMatrix(
  page: Page,
  testInfo: TestInfo,
  options: MatrixCaptureOptions
): Promise<Buffer> {
  const { file, attach = file, element } = options;

  // Let webfont loading settle so glyph metrics do not shift between runs.
  await page.evaluate(() => (document as Document & { fonts?: FontFaceSet }).fonts?.ready);

  // animations: 'disabled' freezes finite transitions to their end and rewinds
  // infinite ones to a consistent frame; the text caret is hidden by default.
  const buffer = element
    ? await element.screenshot({ animations: 'disabled' })
    : await page.screenshot({ animations: 'disabled' });

  await testInfo.attach(attach, { body: buffer, contentType: 'image/png' });

  await fs.mkdir(MATRIX_DIR, { recursive: true });
  await fs.writeFile(path.join(MATRIX_DIR, `${file}.png`), buffer);

  return buffer;
}
