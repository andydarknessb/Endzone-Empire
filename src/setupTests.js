// jest-dom adds custom jest matchers for asserting on DOM nodes.
// https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

// Widen Testing Library's async budget: under saturated CI workers, React 18
// scheduler rendering can starve findBy*/waitFor past the 1s default. Element
// waits still fail with "element not found" at 4s — well before the per-test
// ceiling below — so diagnostics stay sharp.
configure({ asyncUtilTimeout: 4000 });

// The heaviest userEvent+MUI tests run ~3.5s in isolation; under parallel
// worker contention they can exceed Jest's 5s default and flake. 15s only
// matters on the failure path — passing tests are unaffected.
jest.setTimeout(15000);
