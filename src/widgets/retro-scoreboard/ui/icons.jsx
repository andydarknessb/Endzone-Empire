import React from 'react';

/**
 * The widget's inline stroke icons on the design canvas's 20px grid (one
 * style: 1.6 stroke, round caps, currentColor). Decorative in every use here,
 * so each is aria-hidden; the text beside it carries the meaning. The name is
 * exposed as a stable `data-icon` so a test can assert which glyph rendered.
 */
const PATHS = {
  clock: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l3 2" />
    </>
  ),
  chevR: <path d="M7.5 4.5 13 10l-5.5 5.5" />,
};

export default function Icon({ name, size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
    >
      {PATHS[name] || null}
    </svg>
  );
}
