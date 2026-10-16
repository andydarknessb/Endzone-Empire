import React from 'react';
import { PixelClock, PixelWarn } from '../../../shared/ui/playselect';
import { Glyph } from '../../../shared/ui/playselect/LineupParts';

/**
 * The Edge line's per-kind pictogram (see `./edgeLine.js`): the injury designation, a bench player
 * outprojecting his slot's starter, the largest projection Factor, a game in progress and a final result.
 * Pixel marks in the surrounding ink, decorative: the Edge line's own text carries the meaning, so every
 * mark is `aria-hidden`.
 */
const ICON_BY_KIND = {
  injury: () => <PixelWarn />,
  'bench-above-starter': () => <Glyph kind="up" />,
  factor: () => <Glyph kind="bolt" />,
  pace: () => <PixelClock />,
  result: () => <Glyph kind="flag" />,
};

/** The Edge line's icon for `kind`, or null for an unknown kind. */
export default function EdgeLineIcon({ kind }) {
  const Icon = ICON_BY_KIND[kind];
  return Icon ? <Icon /> : null;
}
