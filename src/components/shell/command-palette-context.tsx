"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/* Who may open the command palette, and whether it is open.

   This exists because the topbar and the palette are SERVER-rendered slots now
   (they need capabilities, which come from the database), and a server slot
   cannot be handed a client callback as a prop. The open/close state is client
   state either way, so it moved into context: the topbar's search button and
   ⌘K both call `open()`, and the palette reads `isOpen`.

   Nothing here knows anything about the user — that stays in the slots, behind
   their own Suspense boundaries. This is the frame's own state. */

type PaletteCtx = { isOpen: boolean; open: () => void; close: () => void };

const Ctx = createContext<PaletteCtx | null>(null);

export function useCommandPalette(): PaletteCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCommandPalette must be used inside CommandPaletteProvider");
  return ctx;
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  // ⌘K / Ctrl+K toggles the command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo(() => ({ isOpen, open, close }), [isOpen, open, close]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
