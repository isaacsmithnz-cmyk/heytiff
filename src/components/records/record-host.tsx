"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { openMirrorJob } from "@/app/actions/workboard";
import type { JobSheetTab } from "@/components/workboard/board/job-sheet";
import type { ScheduleJobState } from "@/components/workboard/board/schedule-tab";
import { ToastHost, useBoardToasts } from "@/components/workboard/board/toasts";
import type { AllJobRow } from "@/lib/workboard/all-jobs";
import { encodeRecord, openParamOf, recordKey, withOpenParam, type RecordRef } from "@/lib/records/ref";
import { RecordsContext, type OpenRecordOptions, type RecordsApi } from "./records-context";

export { useRecords } from "./records-context";
export type { OpenRecordOptions, RecordsApi } from "./records-context";

/* THE RECORD HOST — one place, app-wide, where a record opens.

   Before this, a job opened from ⌘K, Tiff, the bell, Action required or
   Analytics by SENDING YOU to the Workboard: the outlet is keyed on the
   pathname, so the screen you were on was thrown away, the Workboard loaded
   all three boards, and then took the job back out of the address. Only
   Home opened a job in place, through a host of its own.

   This is Home's host, lifted into the dashboard layout beside Tiff's: it
   sits above the outlet, so opening a record changes no route and the
   screen underneath stays exactly as it was. Every door calls `open()`.

   THE ADDRESS CARRIES THE OPEN RECORD (`?open=job.<uuid>`), pushed when a
   door opens it, so Back closes it, a refresh brings it back over the same
   screen, and the address can be copied. Closing it from the card takes the
   entry back off. The other screens' own `?job=`-style links keep working.

   GOING SOMEWHERE ELSE CLOSES IT. A card's own doors (its project, its
   quote, Create agreement) lead to another screen, and a card left open on
   top of the screen it sent you to would hide what you went to see. Back
   to the screen it was open over brings it back, since the address there
   still names it.

   The card is the board's own `JobSheet`; this host only decides where it
   opens. Its permissions come from the shell's capability read, through
   the `ShellRecords` slot, so the card offers here exactly what it offers
   on the board. */

/** Marks the history entry this host pushed, so closing knows whether Back
    is ours to take. Next keeps its own state beside it. */
const MARK = "heytiffOpen";

export type Win = {
  key: string;
  /** The screen it was opened over. It is drawn only there: going
      somewhere else closes it (see above). */
  path: string;
  ref: RecordRef;
  row: AllJobRow;
  state: ScheduleJobState | null;
  tab: JobSheetTab | undefined;
  from: HTMLElement | null;
  /** What a booking door came for — Book in, or a leftover's Clear — and
      the ask that brought it, so the card opens afresh on it. */
  door: { bookIn: boolean; clear: string | null; n: number } | null;
};

export type WindowsApi = {
  windows: readonly Win[];
  close: (key: string) => void;
  /** Close without touching the address: the next move writes its own. */
  dismiss: () => void;
  toast: (words: string) => void;
};

export const WindowsContext = createContext<WindowsApi | null>(null);

/** The element that has focus now, when it is something focus can go back
    to — not the page itself. */
function focused(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const el = document.activeElement;
  return el instanceof HTMLElement && el !== document.body ? el : null;
}

function giveFocusBack(win: Win | undefined) {
  const to = win?.from;
  if (to?.isConnected) to.focus({ preventScroll: true });
}

/** The app's record host, in the dashboard layout: it follows the address,
    and a window belongs to the screen it was opened over. */
export function RecordsProvider({ children }: { children: ReactNode }) {
  return (
    <RecordsCore pathname={usePathname()} syncUrl>
      {children}
    </RecordsCore>
  );
}

/** A host drawn inside one page of its own (Home's, outside the frame, or a
    test): it neither reads nor writes the address. */
export function PageRecordsProvider({ children }: { children: ReactNode }) {
  return (
    <RecordsCore pathname="" syncUrl={false}>
      {children}
    </RecordsCore>
  );
}

function RecordsCore({
  children,
  pathname,
  syncUrl,
}: {
  children: ReactNode;
  /** The screen the host sits over; windows are drawn only over their own. */
  pathname: string;
  /** Write the open record into the address and read it back on load. */
  syncUrl: boolean;
}) {
  const [windows, setWindows] = useState<Win[]>([]);
  const { toasts, toast, dismiss: dismissToast } = useBoardToasts();
  /* THE LAST ASK WINS. A record asked for by id waits on the mirror; a
     second ask, or a close, while it waits makes that answer stale, and a
     stale answer must not open a card over whatever came after it. */
  const asked = useRef(0);
  /* The windows as last drawn, for the handlers that run outside render
     (Back, a close's focus return). */
  const live = useRef<Win[]>([]);
  useEffect(() => {
    live.current = windows;
  }, [windows]);
  /* GOING SOMEWHERE ELSE CLOSES IT for good: a window left over the screen
     you went from must not be waiting there when you come back to it by
     another road. Put right while rendering, not in an effect, so the
     screen you come back to never draws it even once. */
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    setWindows((ws) => ws.filter((w) => w.path === pathname));
  }
  /* And only the windows opened over THIS screen are drawn — a record
     brought back by Back is asked for before the router has caught up with
     the address. */
  const shown = useMemo(() => windows.filter((w) => w.path === pathname), [windows, pathname]);

  const pushAddress = useCallback(
    (ref: RecordRef) => {
      if (!syncUrl) return;
      const here = window.location.href;
      const named = openParamOf(here);
      if (named && recordKey(named) === recordKey(ref)) return;
      window.history.pushState({ [MARK]: encodeRecord(ref) }, "", withOpenParam(here, ref));
    },
    [syncUrl],
  );

  const openRef = useCallback(
    (ref: RecordRef, opts: OpenRecordOptions = {}, address = true) => {
      const n = ++asked.current;
      /* The screen it is asked over, off the address when the host follows
         it: on Back the address has moved before the router has. */
      const path = syncUrl ? window.location.pathname : pathname;
      const from = opts.from !== undefined ? opts.from : focused();
      const door = opts.bookIn || opts.clear ? { bookIn: !!opts.bookIn, clear: opts.clear ?? null, n } : null;
      const land = (row: AllJobRow) => {
        /* You went somewhere else while it was asked for. */
        if (syncUrl && window.location.pathname !== path) return;
        const win: Win = {
          key: recordKey(ref),
          path,
          ref,
          row,
          state: opts.state ?? null,
          tab: door ? "visits" : opts.tab,
          from,
          door,
        };
        /* ONE CARD. A second door replaces the first rather than opening
           another beside it. */
        setWindows([win]);
        if (address) pushAddress(ref);
      };
      if (opts.row) {
        land(opts.row);
        return;
      }
      void openMirrorJob(ref.id).then(
        (row) => {
          if (n !== asked.current) return;
          if (row) land(row);
          else toast("That job isn't in ServiceM8's copy any more.");
        },
        () => {
          if (n === asked.current) toast("Could not open that job");
        },
      );
    },
    [pathname, syncUrl, pushAddress, toast],
  );

  const close = useCallback(
    (key: string) => {
      asked.current += 1;
      const win = live.current.find((w) => w.key === key);
      setWindows((ws) => ws.filter((w) => w.key !== key));
      giveFocusBack(win);
      if (!syncUrl) return;
      const named = openParamOf(window.location.href);
      if (!named || recordKey(named) !== key) return;
      /* Ours to take back when we pushed it; otherwise (a refresh, a link
         from elsewhere) the address just drops the record. */
      if ((window.history.state as Record<string, unknown> | null)?.[MARK] === key) window.history.back();
      else window.history.replaceState(null, "", withOpenParam(window.location.href, null));
    },
    [syncUrl],
  );

  const dismiss = useCallback(() => {
    asked.current += 1;
    setWindows([]);
  }, []);

  /* A REFRESH, OR A COPIED LINK, brings the record back over the screen.
     Once, on the way in: from then on the doors write the address. The ask
     is async (the mirror read), so nothing is set in this effect's body. */
  const restored = useRef(false);
  useEffect(() => {
    if (!syncUrl || restored.current) return;
    restored.current = true;
    const named = openParamOf(window.location.href);
    if (named) openRef(named, {}, false);
  }, [syncUrl, openRef]);

  /* BACK AND FORWARD. Back past the entry a door pushed closes its record;
     forward onto one opens it again. */
  useEffect(() => {
    if (!syncUrl) return;
    const onPop = () => {
      const named = openParamOf(window.location.href);
      const top = live.current[live.current.length - 1];
      if (top && (!named || recordKey(named) !== top.key)) {
        asked.current += 1;
        setWindows([]);
        giveFocusBack(top);
      }
      if (named && (!top || recordKey(named) !== top.key)) openRef(named, {}, false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [syncUrl, openRef]);

  const api = useMemo<RecordsApi>(() => ({ hosted: true, open: (ref, opts) => openRef(ref, opts) }), [openRef]);
  const windowsApi = useMemo<WindowsApi>(
    () => ({ windows: shown, close, dismiss, toast: (m: string) => toast(m) }),
    [shown, close, dismiss, toast],
  );

  return (
    <RecordsContext.Provider value={api}>
      <WindowsContext.Provider value={windowsApi}>
        {children}
        <ToastHost toasts={toasts} onDismiss={dismissToast} />
      </WindowsContext.Provider>
    </RecordsContext.Provider>
  );
}

/* THE CARD'S CODE LOADS WHEN A RECORD OPENS, not with the frame. This slot
   rides every screen, and the job card is a large component nobody should
   pay for until they open one — the palette's photo viewer is loaded the
   same way. */
const LazyRecordWindows = dynamic(() => import("./record-windows").then((m) => m.RecordWindows), {
  ssr: false,
});

/** The open records, drawn — only once there is one. The card's grants come
    from the shell's capability read, which streams in behind its own
    boundary (`ShellRecords`); until it lands nothing is drawn, and the
    record waits in the host. */
export function RecordWindowsSlot({ manage, moneyVisible }: { manage: boolean; moneyVisible: boolean }) {
  const host = useContext(WindowsContext);
  if (!host || host.windows.length === 0) return null;
  return <LazyRecordWindows manage={manage} moneyVisible={moneyVisible} />;
}
