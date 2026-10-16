import type { Locator } from '@playwright/test';

/**
 * Where the compact scoreboard bar's margin text paints against its Live chip (RULINGS Critique 11 item 8).
 * `paintedRight` is the text's right edge, cut at the span's own box when the span clips (overflow not visible),
 * so a clipped ellipsis passes and text that runs on under the chip fails. `bar` is the group or a holder around it.
 */
export function probeCompactBar(bar: Locator) {
  return bar.evaluate((holder) => {
    const el = holder.matches('[role="group"]') ? holder : holder.querySelector('[role="group"]')!;
    const board = el.querySelector(':scope > [aria-hidden="true"]') as HTMLElement;
    const span = board.children[1] as HTMLElement;
    const chip = el.lastElementChild as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(span);
    const style = getComputedStyle(span);
    const textRight = Math.max(...Array.from(range.getClientRects()).map((r) => r.right));
    const clips = style.overflowX !== 'visible';
    return {
      chipLeft: chip.getBoundingClientRect().left,
      paintedRight: clips ? Math.min(textRight, span.getBoundingClientRect().right) : textRight,
      overflow: style.overflowX,
      textOverflow: style.textOverflow,
      text: span.innerText,
    };
  });
}
