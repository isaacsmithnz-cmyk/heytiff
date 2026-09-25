"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { prefersStill } from "./box-motion";
import { TiffContext, type TiffApi, type TiffLanded, type TiffOpen } from "./tiff-context";
import { TiffModal, type TiffClosed, type TiffSession } from "./tiff-modal";

export { useTiff, useTiffModalSwitch } from "./tiff-context";
export type { TiffLanded, TiffOpen } from "./tiff-context";

/* THE TIFF MODAL'S HOST — one conversation, app-wide.

   Mounted once, in the dashboard layout, inside the note scope, and INERT:
   nothing renders and nothing is read until a Tiff button opens it. The
   layout stays synchronous — whether this viewer gets the modal is not
   something the layout awaits. The top bar already knows the viewer's role
   (its slot is a server component), so it asks `deskOn(role)` there and
   reports the answer UP, the way a screen reports what it is about into the
   note scope. Until it has, and for everyone the switch leaves out, every
   Tiff button opens the capture sheet it always has (the crew keep it until
   the flip).

   ONE AT A TIME. A second press while a conversation is open is refused
   rather than starting another over it.

   THE MODAL PORTALS TO THE BODY ONLY WHILE IT IS OPEN, so it is the last
   thing there and sits above any open sheet on the modal layer. Its wrapper
   is `.fg` with no box of its own (`display: contents`): the frame's resets
   and type reach it, where a portal otherwise gets none of them.

   Where it grew from is measured in the click — the button's rect, read in
   the handler, never in render. */

/** How long `landed` stays up after the modal closes. */
export const LANDED_MS = 2000;

export function TiffModalProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [session, setSession] = useState<TiffSession | null>(null);
  const [landed, setLanded] = useState<TiffLanded | null>(null);
  const opened = useRef(0);

  const report = useCallback((on: boolean) => setEnabled(on), []);

  const open = useCallback(
    (o: TiffOpen) => {
      if (!enabled || session) return false;
      const r = o.from.getBoundingClientRect();
      const next: TiffSession = {
        n: ++opened.current,
        from: o.from,
        origin: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
        words: o.words?.trim() || undefined,
        room: o.room,
        openerId: o.id ?? null,
        /* Two different things. Reduced motion stills all of it; a keyboard
           press only keeps anything from flying out of the button (law 8) —
           Tiff's thinking is state, not the press, and keeps its floors. */
        still: prefersStill(),
        keyboard: o.keyboard === true,
        at: Date.now(),
      };
      /* A double press lands twice before either render: the first wins. */
      setSession((s) => s ?? next);
      return true;
    },
    [enabled, session]
  );

  const closed = useCallback(
    (c: TiffClosed) => {
      setSession(null);
      if (c.landed) setLanded(c.landed);
      /* The results land on the page after it closes — and only when
         something was written; closing on nothing costs no refetch. */
      if (c.changed) router.refresh();
      if (c.from.isConnected) c.from.focus({ preventScroll: true });
    },
    [router]
  );

  useEffect(() => {
    if (!landed) return;
    const t = setTimeout(() => setLanded(null), LANDED_MS);
    return () => clearTimeout(t);
  }, [landed]);

  const api = useMemo<TiffApi>(
    () => ({
      enabled,
      open,
      openedBy: session?.openerId ?? null,
      isOpen: !!session,
      landed,
      report,
    }),
    [enabled, open, session, landed, report]
  );

  return (
    <TiffContext.Provider value={api}>
      {children}
      {session &&
        createPortal(
          <div className="fg" style={{ display: "contents" }}>
            <TiffModal key={session.n} session={session} onClosed={closed} />
          </div>,
          document.body
        )}
    </TiffContext.Provider>
  );
}
