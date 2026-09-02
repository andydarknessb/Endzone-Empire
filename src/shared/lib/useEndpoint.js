import { useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';

/**
 * One GET bound to a URL, tracking loading -> ready | error. The shared read
 * for the League Dashboard island (ADR 0020): every dashboard widget that owns
 * a plain read consumes this hook rather than carrying its own copy (#669).
 * It lives in `src/shared/lib`, the bottom of the island alongside `shared/ui`,
 * and depends on nothing above it (no widget, feature, or page).
 *
 * The shape is the SUPERSET of what the widgets need:
 *
 *   { status: 'loading' | 'ready' | 'error', data, httpStatus }
 *
 * `httpStatus` is the failing response's HTTP status (or null when there is no
 * response, e.g. a network error), and it is null on every non-error state. It
 * exists for the one consumer that renders a 404 differently from a 500
 * (draft-grades: a 404 means the draft has not produced grades yet, not a real
 * failure). Every other consumer ignores `httpStatus` deliberately, because its
 * failures all degrade identically; carrying the field they ignore is cheaper
 * and safer than the four diverging private copies this hook replaces, where a
 * capability dropped from the copy that became the template silently became a
 * capability the later copies inherited the absence of.
 *
 * A null `url` never fetches and parks the state on the idle shape
 * (`status: 'loading'`, null data, null httpStatus). This is load-bearing, not
 * a formality: matchup-preview chains a detail read behind a null URL on its
 * happy path and short-circuits on its own signal BEFORE ever reading this
 * hook's status, precisely because a null URL idles at 'loading' forever. Do
 * not "clean this up" to an 'idle' status without revisiting that widget; its
 * docblock records the reasoning.
 *
 * The read cancels on unmount and on URL change (a `cancelled` flag closed over
 * the effect), so a late or superseded response can never land on state after
 * the widget has moved on.
 */

const IDLE = { status: 'loading', data: null, httpStatus: null };

export function useEndpoint(url) {
  const [state, setState] = useState(IDLE);
  useEffect(() => {
    if (!url) {
      setState(IDLE);
      return undefined;
    }
    let cancelled = false;
    setState(IDLE);
    apiClient
      .get(url)
      .then((res) => {
        if (!cancelled) setState({ status: 'ready', data: res?.data ?? null, httpStatus: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({ status: 'error', data: null, httpStatus: err?.response?.status ?? null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return state;
}
