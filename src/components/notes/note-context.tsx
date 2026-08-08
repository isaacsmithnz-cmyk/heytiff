"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { NoteTarget } from "@/app/actions/workboard-notes";

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
  /* THE JOB LIST IS NOT IN SCOPE ANY MORE. Screens used to push the jobs a
     note could be pinned to, which quietly made the review card's picker a
     board-screens-only feature — dictated from anywhere else, a jobless flag
     was told to "say which one" with nowhere to say it. The roster now rides
     the route result (`routeNote` returns `jobs`), because only the server
     can hand it to a screen with no board behind it. */
  /** Staff first names, for the field mics' local sniff — a named person is
      the single strongest signal that a sentence is a job for somebody, and
      the sieve can't know one without the roster. Empty just costs that
      signal; it never breaks anything. */
  staffFirstNames: string[];
};

const EMPTY: NoteScope = {
  voiceEnabled: false,
  target: { kind: "none" },
  staffFirstNames: [],
};

type Push = Partial<NoteScope>;

const Ctx = createContext<
  NoteScope & { pushScreen: (p: Push | null) => void; pushFocus: (p: Push | null) => void }
>({
  ...EMPTY,
  pushScreen: () => {},
  pushFocus: () => {},
});

/** Wrap the APP, once, in the dashboard layout. Everything inside gets the
    token's behaviour for free — including the Tiff button, which lives in the
    frame and is therefore ABOVE every screen in the tree. */
export function NoteScopeProvider({
  voiceEnabled,
  children,
}: {
  voiceEnabled: boolean;
  children: React.ReactNode;
}) {
  /* TWO SLOTS, NOT ONE, and the reason is the button.

     This used to be seeded from props by whichever screen wrapped itself, and
     a single `pushed` slot let a sheet override the target. That worked while
     every token stood INSIDE the screen that configured it. The global button
     stands in the frame, above all of them, so the direction reversed: the
     screen no longer wraps the button, it reports up to it.

     With one slot those two reports fight. A screen pushes its roster on
     mount; a sheet opens and pushes a target; the roster vanishes because
     the second push replaced the first, and the field mics' sieve goes
     name-blind. (The original casualty was the board's job list, which has
     since moved to the route result — the structural problem is the same.)
     So they get a slot each:

       screen  what the SCREEN is about — its roster, its default target.
               Set on mount, cleared on unmount.
       focus   what is OPEN OVER it — a visit sheet, a trip. Outranks the
               screen for as long as it is up, and only ever a target.

     Closing a sheet drops `focus` and the button falls back to the screen
     underneath, which is what a person would predict and what the old
     single-slot version got wrong the moment two things pushed at once. */
  const [screen, setScreen] = useState<Push | null>(null);
  const [focus, setFocus] = useState<Push | null>(null);
  const pushScreen = useCallback((p: Push | null) => setScreen(p), []);
  const pushFocus = useCallback((p: Push | null) => setFocus(p), []);

  const value = useMemo(() => {
    const aiming = focus ?? screen;
    return {
      voiceEnabled,
      target: aiming?.target ?? EMPTY.target,
      /* A target pushed WITHOUT a label must not inherit the last one — the
         ribbon would name the wrong job out loud while someone spoke into it. */
      targetLabel: aiming?.targetLabel,
      staffFirstNames: screen?.staffFirstNames ?? EMPTY.staffFirstNames,
      pushScreen,
      pushFocus,
    };
  }, [voiceEnabled, screen, focus, pushScreen, pushFocus]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useNoteScope = () => useContext(Ctx);

/** Point the token at this job for as long as the caller is mounted.

    Call it at the top of a sheet: `useNoteScopeTarget({ kind: "visit", id },
    "Meridian Data · CRACs")`. Closing the sheet unmounts the caller and the
    token goes back to whatever the SCREEN underneath was about — which is the
    behaviour a person would predict, and the one the old `register`/`send`
    pair got wrong by leaving the last target in place. */
export function useNoteScopeTarget(target: NoteTarget, label?: string): void {
  const { pushFocus } = useNoteScope();
  /* Depend on the PRIMITIVES, not the object. `target` is almost always an
     inline literal, so a `[target]` dependency would re-run this on every
     render of the sheet and push scope in a loop. */
  const id = target.id ?? null;
  const kind = target.kind;

  useEffect(() => {
    pushFocus({ target: { kind, id }, targetLabel: label });
    return () => pushFocus(null);
  }, [kind, id, label, pushFocus]);
}

/** Tell the frame what THIS SCREEN is about — its default target and the
    roster the local sieve reads names from.

    This is the half that replaced wrapping each screen in its own provider.
    The button that consumes it is in the frame, above every screen, so a
    screen cannot wrap it; it reports up instead. Everything is cleared on
    unmount, so navigating away leaves the button a universal note taker
    rather than one still holding the last screen's roster.

    Arrays are compared by CONTENT, not identity: callers build
    `staffFirstNames` inline with `.map()`, so an identity dependency would
    push on every render forever. */
export function useNoteScopeScreen(scope: {
  target?: NoteTarget;
  targetLabel?: string;
  staffFirstNames?: string[];
}): void {
  const { pushScreen } = useNoteScope();
  const kind = scope.target?.kind ?? null;
  const id = scope.target?.id ?? null;
  const label = scope.targetLabel;
  const nameKey = (scope.staffFirstNames ?? []).join("|");

  /* The array itself rides in a ref so the push effect can hand over the
     real object while depending only on the key above. Written in its OWN
     effect rather than during render: effects run in declaration order, so
     this one has always updated the ref before the push below reads it. */
  const latest = useRef(scope);
  useEffect(() => {
    latest.current = scope;
  });

  useEffect(() => {
    pushScreen({
      target: kind ? { kind, id } : { kind: "none" },
      targetLabel: label,
      staffFirstNames: latest.current.staffFirstNames ?? [],
    });
    return () => pushScreen(null);
  }, [kind, id, label, nameKey, pushScreen]);
}

/** The same thing as a component, for the server pages that used to wrap
    themselves in a provider and have no client component of their own to
    hang the hook off. Renders nothing. */
export function NoteScopeScreen(props: {
  target?: NoteTarget;
  targetLabel?: string;
  staffFirstNames?: string[];
}): null {
  useNoteScopeScreen(props);
  return null;
}
