// Four screens don't need a routing library; a typed route object is enough.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type Route =
  | { name: "dashboard" }
  | { name: "session"; id: string }
  | { name: "editor"; sessionId: string; markerId: string }
  | { name: "settings" };

interface RouterValue {
  route: Route;
  navigate: (route: Route) => void;
  /** Swap the current screen without growing history (e.g. prev/next clip). */
  replace: (route: Route) => void;
  back: () => void;
}

const RouterContext = createContext<RouterValue | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: "dashboard" }]);
  const navigate = useCallback((route: Route) => setStack((s) => [...s, route]), []);
  const replace = useCallback((route: Route) => setStack((s) => [...s.slice(0, -1), route]), []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const value = useMemo(() => ({ route: stack[stack.length - 1], navigate, replace, back }), [stack, navigate, replace, back]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useRouter outside RouterProvider");
  return ctx;
}
