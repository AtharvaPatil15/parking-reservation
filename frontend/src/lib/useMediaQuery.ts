import { useEffect, useState } from 'react';

/**
 * Track a CSS media query in JS.
 *
 * Used where two layouts must not both exist in the DOM. Rendering both and hiding
 * one with `hidden md:block` duplicates every cell, which makes a screen reader
 * announce each row twice.
 *
 * `defaultValue` is returned whenever the environment can't answer the query — no
 * `window`, or a `matchMedia` stub that reports every query as unmatched (jsdom has
 * no real implementation, and the test stub answers `false` to everything, which for
 * a `min-width` query would wrongly mean "narrow"). Callers therefore pass the
 * layout that should win when width is unknowable, and the real value takes over on
 * mount in a browser.
 */
export function useMediaQuery(query: string, defaultValue = true): boolean {
  const read = (): boolean => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return defaultValue;
    const mql = window.matchMedia(query);
    // A stub that answers `false` to a query and its negation cannot really evaluate
    // media queries, so fall back rather than trust it.
    if (!mql.matches && !window.matchMedia(`not all and ${query}`).matches) return defaultValue;
    return mql.matches;
  };

  const [matches, setMatches] = useState(read);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(read());
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return matches;
}
