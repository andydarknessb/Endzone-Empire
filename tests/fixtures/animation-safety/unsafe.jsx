// DELIBERATELY UNSAFE fixture for the #542 animation-safety guard (JS/Emotion
// side). Not part of the app: it lives under tests/fixtures/ so no scan path
// reaches it, and scripts/animationSafetyGuard.test.js points the scanner at it
// explicitly and asserts it IS flagged. See unsafe.css in this directory for
// the full rationale (a clean tree proves nothing permanent; this fixture is
// the standing proof the check still fires).
//
// The defect shape: a forwards-filled Emotion animation whose keyframes end in
// a hidden state (opacity 0), applied UNCONDITIONALLY - no prefers-reduced
// -motion off-ramp for this declaration. This is the exact RetroField defect
// that #542 exists to prevent reintroducing.

import { keyframes } from '@mui/material/styles';

const fixtureFlashOut = keyframes`
  0% { opacity: 0; }
  15% { opacity: 1; }
  80% { opacity: 1; }
  100% { opacity: 0; }
`;

export const fixtureCalloutSx = {
  position: 'absolute',
  animation: `${fixtureFlashOut} 1800ms ease-in-out forwards`,
};
