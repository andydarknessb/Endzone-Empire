import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSnackbar } from '../Snackbar/SnackbarProvider';

/**
 * Shows the whole Push alert once when the service worker opens the app with
 * `?alert=<json {title, body}>` (iOS truncates the expanded body), then strips
 * the param so a reload or share does not replay it. Renders nothing.
 */
export default function PushAlertToast() {
  const notify = useSnackbar();
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('alert');
  const handled = useRef(null);

  useEffect(() => {
    // Keyed on the raw value so StrictMode's double effect shows it once.
    if (raw === null) {
      handled.current = null; // cleared, so the same alert tapped again shows again
      return;
    }
    if (handled.current === raw) return;
    handled.current = raw;
    try {
      const { title, body } = JSON.parse(raw);
      const text = [title, body].filter((part) => typeof part === 'string' && part).join('\n');
      if (text) notify(text, { severity: 'info', duration: 15000 });
    } catch (err) {
      // Garbage in the URL is ignored; the param is still cleared below.
    }
    const next = new URLSearchParams(searchParams);
    next.delete('alert');
    setSearchParams(next, { replace: true });
  }, [raw, notify, searchParams, setSearchParams]);

  return null;
}
