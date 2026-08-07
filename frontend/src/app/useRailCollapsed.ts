import { useEffect, useState } from 'react';

const KEY = 'nav-rail-collapsed';

/**
 * Whether the nav rail is collapsed to icons, persisted across reloads.
 *
 * localStorage, not sessionStorage: this is a display preference, not session
 * state, so it should survive closing the tab (auth deliberately does not — see
 * lib/auth). Reads lazily inside useState so the first paint is already correct
 * and the rail doesn't visibly snap from wide to narrow on load.
 */
export function useRailCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      // Private-mode / storage-disabled: fall back to expanded rather than throwing.
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(KEY, collapsed ? '1' : '0');
    } catch {
      // Preference just won't persist; not worth surfacing to the user.
    }
  }, [collapsed]);

  return [collapsed, () => setCollapsed((c) => !c)];
}
