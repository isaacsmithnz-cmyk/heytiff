/* The sidebar's two sizes — expanded (default) or a 64px icon rail.

   The state is an attribute on <html>, not React state: the layout inlines
   RAIL_BOOT so a collapsed rail is collapsed before first paint (no flash of
   the wide sidebar), and every collapsed style keys off `html[data-rail]` in
   CSS. React only needs to KNOW the state (for the toggle's label and the
   items' hover titles), which it reads through useSyncExternalStore — server
   snapshot false, the same pattern as the studio sim flag, so hydration never
   fights the boot script.

   No "use client" directive on purpose: the sidebar (client) imports the
   store, the layout (server) imports only the RAIL_BOOT string. */

const KEY = "ht-rail";
const ATTR = "data-rail";

const listeners = new Set<() => void>();

export function railCollapsed(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.hasAttribute(ATTR);
}

/** the server's answer — expanded; the boot script has already corrected the
    DOM before hydration, and useSyncExternalStore reconciles on mount */
export function railServerSnapshot(): boolean {
  return false;
}

export function subscribeRail(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function toggleRail(): void {
  const el = document.documentElement;
  const collapsed = !el.hasAttribute(ATTR);
  if (collapsed) el.setAttribute(ATTR, "");
  else el.removeAttribute(ATTR);
  try {
    localStorage.setItem(KEY, collapsed ? "1" : "0");
  } catch {
    /* private mode — the toggle still works, it just isn't remembered */
  }
  listeners.forEach((l) => l());
}

/** inlined by the dashboard layout, before the frame renders */
export const RAIL_BOOT = `try{if(localStorage.getItem("${KEY}")==="1")document.documentElement.setAttribute("${ATTR}","")}catch(e){}`;
