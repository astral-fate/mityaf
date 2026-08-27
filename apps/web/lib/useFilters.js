'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Filter state, kept in the URL.
 *
 * The map and the statistics page must agree on what is being looked at, and
 * an operator who has narrowed to one district over one storm should be able
 * to send that view to a colleague. Both of those come free if the URL is the
 * state.
 *
 * This reads `window.location` directly rather than using `useSearchParams`,
 * which forces every consuming page under a Suspense boundary or the static
 * build fails. `history.replaceState` also avoids pushing a history entry per
 * keystroke, so Back still means "the previous page", not "the previous
 * filter".
 */

export const EMPTY = { district: null, from: null, to: null };

function read() {
  if (typeof window === 'undefined') return EMPTY;
  const q = new URLSearchParams(window.location.search);
  return {
    district: q.get('district') || null,
    from: q.get('from') || null,
    to: q.get('to') || null,
  };
}

export function useFilters() {
  // Start empty on both passes: reading window during render would disagree
  // with the server-rendered HTML and trip hydration.
  const [filters, setFilters] = useState(EMPTY);

  useEffect(() => {
    setFilters(read());
    const onPop = () => setFilters(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const update = useCallback((patch) => {
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      const q = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(next)) {
        if (v) q.set(k, v);
        else q.delete(k);
      }
      const qs = q.toString();
      window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
      return next;
    });
  }, []);

  const clear = useCallback(() => update(EMPTY), [update]);

  const active = Boolean(filters.district || filters.from || filters.to);
  return { filters, update, clear, active };
}

/** Does a dated record fall inside the selected window? */
export function inWindow(dateish, { from, to }) {
  if (!from && !to) return true;
  const d = String(dateish ?? '').slice(0, 10);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

/** A link that carries the current filters across a route change. */
export function withFilters(href, filters) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
  const qs = q.toString();
  return qs ? `${href}?${qs}` : href;
}
