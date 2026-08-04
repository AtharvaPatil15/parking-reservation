import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface NavDrawerItem {
  to: string;
  label: string;
  end?: boolean;
  /** Key into the sidebar's icon set (see app/navIcons.tsx). Falls back to a generic mark. */
  icon?: NavIconName;
  /** Renders a divider above this item, grouping the cross-role booking links. */
  dividerBefore?: boolean;
}

/** Names of the Lucide-derived glyphs the nav rail can draw. */
export type NavIconName =
  | 'dashboard'
  | 'park'
  | 'history'
  | 'users'
  | 'ban'
  | 'building'
  | 'sliders'
  | 'grid'
  | 'shield'
  | 'play'
  | 'calendar'
  | 'user';

interface NavDrawerContextValue {
  items: NavDrawerItem[];
  setItems: (items: NavDrawerItem[]) => void;
}

const NavDrawerContext = createContext<NavDrawerContextValue | null>(null);

/** Holds the current role shell's nav items so the top bar's hamburger drawer can render them. */
export function NavDrawerProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<NavDrawerItem[]>([]);
  const value = useMemo(() => ({ items, setItems }), [items]);
  return <NavDrawerContext.Provider value={value}>{children}</NavDrawerContext.Provider>;
}

function useNavDrawerContext() {
  const ctx = useContext(NavDrawerContext);
  if (!ctx) throw new Error('useNavDrawerContext must be used within NavDrawerProvider');
  return ctx;
}

/** Reads the active role shell's nav items, for the top bar to render in the drawer. */
export function useNavDrawerItems() {
  return useNavDrawerContext().items;
}

/** Registers a role shell's nav items for the duration it's mounted. */
export function useRegisterNavDrawerItems(items: NavDrawerItem[]) {
  const { setItems } = useNavDrawerContext();
  useEffect(() => {
    setItems(items);
    return () => setItems([]);
  }, [items, setItems]);
}
