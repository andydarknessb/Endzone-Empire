import React from 'react';

/**
 * The Edge line's per-kind icon (see `./edgeLine.js` for the matching
 * colour). Inline stroke SVG, one 14px style, decorative: the Edge line's
 * own text carries the meaning (LedgerRow.jsx renders it beside the icon),
 * so every icon here is `aria-hidden`.
 */
const ICON_PROPS = {
  width: 14,
  height: 14,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false',
  style: { display: 'block', flex: 'none' },
};

// A caution triangle: the injury designation.
function InjuryIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M10 3.5 17.5 16h-15z" />
      <path d="M10 8.5v3.5M10 14.25v.1" />
    </svg>
  );
}

// An upward arrow: a bench player outprojecting his slot's starter.
function BenchAboveIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M10 15V5m0 0-4.5 4.5M10 5l4.5 4.5" />
    </svg>
  );
}

// A spark: the largest projection Factor.
function FactorIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M11 2 5 11h4l-1 7 7-9h-4z" />
    </svg>
  );
}

// A clock: a game in progress.
function PaceIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l3 2" />
    </svg>
  );
}

// A checkered flag: a final result.
function ResultIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M5 3v14" />
      <path d="M5 4h10l-2.5 3L15 10H5" />
    </svg>
  );
}

const ICON_BY_KIND = {
  injury: InjuryIcon,
  'bench-above-starter': BenchAboveIcon,
  factor: FactorIcon,
  pace: PaceIcon,
  result: ResultIcon,
};

/** The Edge line's icon component for `kind`, or null for an unknown kind. */
export default function EdgeLineIcon({ kind }) {
  const Icon = ICON_BY_KIND[kind];
  return Icon ? <Icon /> : null;
}
