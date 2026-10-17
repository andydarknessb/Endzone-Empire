import { screen, waitFor } from '@testing-library/react';

/**
 * The toast's sentence as a screen reader gets it: the SnackbarProvider's always-mounted status (or, for an error
 * toast, alert) region. The visible toast repeats the text under aria-hidden, so a test that wants "the toast said X"
 * reads the region, not the first text node it finds. Resolves to the region element that holds `matcher` (a string is
 * a substring, a RegExp is tested), so a caller can go on to assert on it.
 */
export async function findToast(matcher) {
  const holds = (el) => (matcher instanceof RegExp ? matcher.test(el.textContent) : el.textContent.includes(matcher));
  const regions = () => [screen.getByTestId('toast-status'), screen.getByTestId('toast-alert')];
  await waitFor(() => expect(regions().some(holds)).toBe(true));
  return regions().find(holds);
}
