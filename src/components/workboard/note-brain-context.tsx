"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

/* One brain, reachable from anywhere on the board.

   The note pill routes what you say into tasks, flags and issues behind an
   editable review card. That machinery was reachable only by pressing the
   pill, so a box literally labelled "Notes for the visit" was a dumb string
   field — you could write "Luke needs to order the grilles" in it and nothing
   would ever come of it (Isaac, 2026-08-02: the visit notes "should also use
   the same smart system as the rest of the note setup").

   Rather than give every field its own copy of the engine, the pill REGISTERS
   itself here and any field can hand it text. The pill's target already
   follows whatever sheet is open, so a note handed over from a visit sheet
   lands against that visit without anyone passing an id around.

   `voiceEnabled` rides along because it's the same fact — whether this
   deployment can hear you at all — and every dictation box needs it. */

type Sender = (text: string) => void;

const NoteBrainCtx = createContext<{
  /** ELEVENLABS_API_KEY is set on this deployment. */
  voiceEnabled: boolean;
  /** Null until the pill mounts, and on screens that have no pill. */
  send: Sender | null;
  register: (send: Sender | null) => void;
}>({ voiceEnabled: false, send: null, register: () => {} });

export function NoteBrainProvider({
  voiceEnabled,
  children,
}: {
  voiceEnabled: boolean;
  children: React.ReactNode;
}) {
  const [send, setSend] = useState<Sender | null>(null);
  // setState with a function argument would CALL it — wrap it
  const register = useCallback((next: Sender | null) => setSend(() => next), []);
  const value = useMemo(() => ({ voiceEnabled, send, register }), [voiceEnabled, send, register]);
  return <NoteBrainCtx.Provider value={value}>{children}</NoteBrainCtx.Provider>;
}

export const useNoteBrain = () => useContext(NoteBrainCtx);
