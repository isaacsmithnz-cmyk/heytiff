"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { NoteTarget } from "@/app/actions/workboard-notes";
import type { JobCandidate } from "@/lib/workboard/note-match";

/* WHERE THE TOKEN IS STANDING.

   One token appears all over the app and behaves slightly differently
   depending on what's on screen: on a job card its job is to add notes to
   THAT job; anywhere else it's a universal note taker. That difference is
   the only thing that varies, so it is the only thing this carries — and it
   comes from context rather than props because the alternative is threading
   a target id through every sheet, modal and screen that might contain a
   text box.

   The predecessor (`note-brain-context`) carried a `send` function so a dumb
   field could hand its text to the one smart component. That bridge existed
   because the smart and dumb controls were different components; now they're
   postures of the same one, so the bridge is gone and `target` took its
   place. What survives is the lesson that made it: the widget must never
   need its caller to know how routing works.

   `voiceEnabled` rides along because it's the same kind of fact — whether
   this deployment can hear you at all — and every posture needs it. */

export type NoteScope = {
  /** ELEVENLABS_API_KEY is set on this deployment. No key, no mic offered;
      every posture still works as a plain text control. */
  voiceEnabled: boolean;
  /** What a note lands against by default. `{ kind: "none" }` is the
      universal case and is NOT an error state — most of the app is that. */
  target: NoteTarget;
  /** "Meridian Data · Server room CRACs" — what the ribbon says out loud so
      the person speaking can see where their words are going. Absent means
      the token says "General note" instead. */
  targetLabel?: string;
  /** Jobs a note can be pinned to when it arrived against nothing. Empty on
      screens with no board behind them, which simply means the token won't
      offer a job picker. */
  jobs: JobCandidate[];
  /** Staff first names, for the field mics' local sniff — a named person is
      the single strongest signal that a sentence is a job for somebody, and
      the sieve can't know one without the roster. Empty just costs that
      signal; it never breaks anything. */
  staffFirstNames: string[];
};

const EMPTY: NoteScope = {
  voiceEnabled: false,
  target: { kind: "none" },
  jobs: [],
  staffFirstNames: [],
};

const Ctx = createContext<NoteScope & { setScope: (patch: Partial<NoteScope>) => void }>({
  ...EMPTY,
  setScope: () => {},
});

/** Wrap a screen. Everything inside gets the token's behaviour for free. */
export function NoteScopeProvider({
  voiceEnabled,
  target = EMPTY.target,
  targetLabel,
  jobs = [],
  staffFirstNames = [],
  children,
}: Partial<NoteScope> & { voiceEnabled: boolean; children: React.ReactNode }) {
  /* A sheet opening over a board CHANGES what a note is about, and it does
     that while the provider above it stays mounted. So the scope is state
     the tree can push into, seeded from props — `useNoteScopeTarget` below
     is the tidy way in, and it puts the target back on unmount so closing a
     sheet returns the token to the board it was covering. */
  const [pushed, setPushed] = useState<Partial<NoteScope> | null>(null);
  const setScope = useCallback((patch: Partial<NoteScope>) => setPushed(patch), []);

  const value = useMemo(
    () => ({
      voiceEnabled,
      target: pushed?.target ?? target,
      targetLabel: pushed?.targetLabel ?? (pushed?.target ? undefined : targetLabel),
      jobs: pushed?.jobs ?? jobs,
      staffFirstNames,
      setScope,
    }),
    [voiceEnabled, target, targetLabel, jobs, staffFirstNames, pushed, setScope]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useNoteScope = () => useContext(Ctx);

/** Point the token at this job for as long as the caller is mounted.

    Call it at the top of a sheet: `useNoteScopeTarget({ kind: "visit", id },
    "Meridian Data · CRACs")`. Closing the sheet unmounts the caller and the
    token goes back to whatever the screen's own scope was — which is the
    behaviour a person would predict, and the one the old `register`/`send`
    pair got wrong by leaving the last target in place. */
export function useNoteScopeTarget(target: NoteTarget, label?: string): void {
  const { setScope } = useNoteScope();
  /* Depend on the PRIMITIVES, not the object. `target` is almost always an
     inline literal, so a `[target]` dependency would re-run this on every
     render of the sheet and push scope in a loop. */
  const id = target.id ?? null;
  const kind = target.kind;

  useEffect(() => {
    setScope({ target: { kind, id }, targetLabel: label });
    return () => setScope({});
  }, [kind, id, label, setScope]);
}
