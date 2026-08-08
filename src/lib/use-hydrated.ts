"use client";

import { useSyncExternalStore } from "react";

/* FALSE ON THE SERVER AND DURING HYDRATION, TRUE AFTER.

   The shape of "this bit only exists in a browser", for the two things that
   need it: reading localStorage without a server/client markup mismatch (the
   Tiff assistant's threads), and portalling into `document.body`, which has
   no server equivalent at all (the Tiff button).

   `useSyncExternalStore` rather than `useEffect(() => setState(true))`. The
   effect version is the one everybody writes and it sets state synchronously
   inside an effect body, which cascades a second render on every mount and is
   a lint error in this codebase. This asks React what phase it is in instead
   of telling it, which is what the hook is for — the store never changes, so
   `subscribe` returns a no-op unsubscribe and nothing is ever notified. */
const neverChanges = () => () => {};

export function useHydrated(): boolean {
  return useSyncExternalStore(
    neverChanges,
    () => true,
    () => false
  );
}
