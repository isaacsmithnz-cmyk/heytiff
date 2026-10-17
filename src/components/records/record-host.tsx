"use client";

import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { openMirrorJob } from "@/app/actions/workboard";
import { openMaintenanceCard } from "@/app/actions/workboard-records";
import { ToastHost, useBoardToasts } from "@/components/workboard/board/toasts";
import type { AllJobRow } from "@/lib/workboard/all-jobs";
import { encodeRecord, openParamOf, recordKey, withOpenParam, type RecordRef } from "@/lib/records/ref";
import {
  DOCK_MAX,
  RECENT_MAX,
  RecordsContext,
  WindowsContext,
  type OpenRecordOptions,
  type RecordsApi,
  type RecentRecord,
  type Win,
  type WinBody,
  type WindowsApi,
  titleOf,
} from "./records-context";

export { DOCK_MAX, WindowsContext, useRecords } from "./records-context";
export type { OpenRecordOptions, RecentRecord, RecordsApi, Win, WindowsApi } from "./records-context";

/* THE RECORD HOST — one place, app-wide, where a record opens.

   Before this, a job opened from ⌘K, Tiff, the bell, Action required or
   Analytics by SENDING YOU to the Workboard: the outlet is keyed on the
   pathname, so the screen you were on was thrown away, the Workboard loaded
   all three boards, and then took the job back out of the address. Only
   Home opened a job in place, through a host of its own.

   This is Home's host, lifted into the dashboard layout beside Tiff's: it
   sits above the outlet, so opening a record changes no route and the
   screen underneath stays exactly as it was. Every door calls `open()`.

   THE ADDRESS CARRIES THE CARD IN FRONT (`?open=job.<uuid>`), pushed when a
   door opens it, so Back closes it, a refresh brings it back over the same
   screen, and the address can be copied. Closing it from the card takes the
   entry back off. The other screens' own `?job=`-style links keep working.

   ONE CARD IN FRONT. A second door replaces the card in front rather than
   opening another beside it.

   SET ASIDE, A CARD WAITS IN THE DOCK (record-dock) on every screen, up to
   three at a time; the oldest goes when a fourth is set aside. It stays
   mounted, hidden (React's Activity), so it comes back exactly as it was
   left: the face it was on, a note half written. The address lets it go
   while it waits. Only the frame's host has a dock; a host drawn inside a
   page offers no Set aside.

   GOING SOMEWHERE ELSE CLOSES THE CARD IN FRONT. A card's own doors (its
   project, its quote, Create agreement) lead to another screen, and a card
   left open on top of the screen it sent you to would hide what you went to
   see. Back to the screen it was open over brings it back, since the
   address there still names it. A card set aside is on no screen, so it
   goes with you.

   NEXT JOB. A door that opened the job from a list (⌘K's jobs, a list of
   job links) hands the list over, and the card steps through it in place.

   The card is the board's own `JobSheet`; this host only decides where it
   opens. Its permissions come from the shell's capability read, through
   the `ShellRecords` slot, so the card offers here exactly what it offers
   on the board. */

/** Marks the history entry this host pushed, so closing knows whether Back
    is ours to take. Next keeps its own state beside it. */
const MARK = "heytiffOpen";


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

/** Where a list puts a job: the one after, or before, or none. */
function stepIn(win: Win | undefined, by: 1 | -1): string | null {
  if (!win?.list) return null;
  const at = win.list.indexOf(win.ref.id);
  return at < 0 ? null : (win.list[at + by] ?? null);
}

/** What each kind is called in what the host says about it. */
const NOUN: Record<RecordRef["kind"], string> = { job: "job", visit: "visit", agreement: "agreement" };
const GONE: Record<RecordRef["kind"], string> = {
  job: "That job isn't in ServiceM8's copy any more.",
  visit: "That visit isn't on the board any more.",
  agreement: "That agreement isn't on the board any more.",
};

/** A record's card, read by its id: a job's row off the mirror, a visit's
    or an agreement's off the maintenance board. Null when it is not there. */
function loadBody(ref: RecordRef, jobBody: (row: AllJobRow) => WinBody): Promise<WinBody | null> {
  if (ref.kind === "job") return openMirrorJob(ref.id).then((row) => (row ? jobBody(row) : null));
  return openMaintenanceCard(ref.kind, ref.id).then((read) => {
    if (!read) return null;
    return read.kind === "visit" ? { kind: "visit", card: read.card } : { kind: "agreement", card: read.card };
  });
}

/** The app's record host, in the dashboard layout: it follows the address,
    a card in front belongs to the screen it was opened over, and cards set
    aside wait in the frame's dock. */
export function RecordsProvider({ children }: { children: ReactNode }) {
  return (
    <RecordsCore pathname={usePathname()} syncUrl>
      {children}
    </RecordsCore>
  );
}

/** A host drawn inside one page of its own (Home's, outside the frame, or a
    test): it neither reads nor writes the address, and has no dock. */
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
  /** The screen the host sits over; the card in front is drawn only over
      its own. */
  pathname: string;
  /** The frame's host: write the card in front into the address, read it
      back on load, and keep a dock. */
  syncUrl: boolean;
}) {
  const [windows, setWindows] = useState<Win[]>([]);
  const [recent, setRecent] = useState<RecentRecord[]>([]);
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
  /* GOING SOMEWHERE ELSE CLOSES THE CARD IN FRONT for good: a card left
     over the screen you went from must not be waiting there when you come
     back to it by another road. Put right while rendering, not in an
     effect, so the screen you come back to never draws it even once. The
     dock goes with you. */
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    setWindows((ws) => ws.filter((w) => w.aside || w.path === pathname));
  }
  /* And only a card opened over THIS screen is drawn in front — a record
     brought back by Back is asked for before the router has caught up with
     the address. */
  const shown = useMemo(() => windows.filter((w) => w.aside || w.path === pathname), [windows, pathname]);

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

  /** Take the record back out of the address: Back, when the entry is the
      one this host pushed for it; otherwise the address just drops it. */
  const dropAddress = useCallback(
    (key: string) => {
      if (!syncUrl) return;
      const named = openParamOf(window.location.href);
      if (!named || recordKey(named) !== key) return;
      if ((window.history.state as Record<string, unknown> | null)?.[MARK] === key) window.history.back();
      else window.history.replaceState(null, "", withOpenParam(window.location.href, null));
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
      const key = recordKey(ref);
      /* What a job's door came for. A booking door is a fresh card even on
         the job already open, so what it came for is what the card opens
         on. */
      const door =
        ref.kind === "job" && (opts.bookIn || opts.clear) ? { bookIn: !!opts.bookIn, clear: opts.clear ?? null, n } : null;
      const jobBody = (row: AllJobRow): WinBody => ({
        kind: "job",
        row,
        state: opts.state ?? null,
        tab: door ? "visits" : opts.tab,
        door,
      });
      /** In front, drawing `fresh` — or, with none, as it was left in the
          dock. */
      const land = (fresh: WinBody | null) => {
        /* You went somewhere else while it was asked for. */
        if (syncUrl && window.location.pathname !== path) return;
        const held = live.current.find((w) => w.key === key);
        const body = fresh ?? held?.body;
        if (!body) return;
        setWindows((ws) => {
          const was = ws.find((w) => w.key === key);
          const win: Win = {
            key,
            path,
            ref,
            from,
            list: opts.list ?? (fresh ? null : (was?.list ?? null)),
            aside: false,
            body: fresh ?? was?.body ?? body,
          };
          /* ONE CARD IN FRONT: the one there now goes. A card coming back
             from the dock keeps its place, so it keeps its state. */
          return was
            ? ws.filter((w) => w.aside || w.key === key).map((w) => (w.key === key ? win : w))
            : [...ws.filter((w) => w.aside), win];
        });
        if (address) pushAddress(ref);
        const { title, sub } = titleOf(body);
        setRecent((rs) => [{ key, ref, title, sub }, ...rs.filter((r) => r.key !== key)].slice(0, RECENT_MAX));
      };
      /* A card in the dock comes back as it was left, unless the door
         brought word of its own (the row, or what it came to book). */
      if (!opts.row && !door && live.current.some((w) => w.key === key && w.aside)) {
        land(null);
        return;
      }
      if (ref.kind === "job" && opts.row) {
        land(jobBody(opts.row));
        return;
      }
      const noun = NOUN[ref.kind];
      void loadBody(ref, jobBody).then(
        (body) => {
          if (n !== asked.current) return;
          if (body) land(body);
          else toast(GONE[ref.kind]);
        },
        () => {
          if (n === asked.current) toast(`Could not open that ${noun}`);
        },
      );
    },
    [pathname, syncUrl, pushAddress, toast],
  );

  /* A CARD READ AGAIN in its place, after a press on it changed what it
     was drawn from. A job's card reads its own; a visit's and an
     agreement's are drawn from what was read, so they are read again. */
  const reload = useCallback(
    (key: string) => {
      const win = live.current.find((w) => w.key === key);
      if (!win || win.body.kind === "job") return;
      void loadBody(win.ref, () => win.body)
        .then((body) => {
          if (!body) return;
          setWindows((ws) => ws.map((w) => (w.key === key ? { ...w, body } : w)));
        })
        .catch(() => {});
    },
    [],
  );

  const close = useCallback(
    (key: string) => {
      asked.current += 1;
      const win = live.current.find((w) => w.key === key);
      setWindows((ws) => ws.filter((w) => w.key !== key));
      /* Let go from the dock: nothing was in front, nothing to give back. */
      if (win?.aside) return;
      giveFocusBack(win);
      dropAddress(key);
    },
    [dropAddress],
  );

  const dismiss = useCallback(() => {
    asked.current += 1;
    setWindows((ws) => ws.filter((w) => w.aside));
  }, []);

  const setAside = useCallback(
    (key: string) => {
      const win = live.current.find((w) => w.key === key);
      if (!syncUrl || !win || win.aside) return;
      asked.current += 1;
      setWindows((ws) => {
        const next = ws.map((w) => (w.key === key ? { ...w, aside: true } : w));
        /* The oldest goes when a fourth is set aside. */
        const over = next.filter((w) => w.aside).slice(0, -DOCK_MAX);
        return over.length ? next.filter((w) => !over.includes(w)) : next;
      });
      giveFocusBack(win);
      dropAddress(key);
    },
    [syncUrl, dropAddress],
  );

  const restore = useCallback(
    (key: string) => {
      const win = live.current.find((w) => w.key === key);
      if (win) openRef(win.ref);
    },
    [openRef],
  );

  const stepOf = useCallback((key: string, by: 1 | -1) => stepIn(windows.find((w) => w.key === key), by), [windows]);

  const step = useCallback(
    (key: string, by: 1 | -1) => {
      const win = live.current.find((w) => w.key === key);
      const id = stepIn(win, by);
      if (!win || !id) return;
      const next: RecordRef = { kind: "job", id };
      /* The card steps in place: the address names the next job instead of
         stacking an entry per job, so Back still closes the card. */
      if (syncUrl) {
        const ours = (window.history.state as Record<string, unknown> | null)?.[MARK] === win.key;
        window.history.replaceState(
          ours ? { [MARK]: recordKey(next) } : window.history.state,
          "",
          withOpenParam(window.location.href, next),
        );
      }
      openRef(next, { list: win.list ?? undefined, from: win.from }, false);
    },
    [syncUrl, openRef],
  );

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

  /* BACK AND FORWARD. Back past the entry a door pushed closes the card in
     front; forward onto one opens it again. */
  useEffect(() => {
    if (!syncUrl) return;
    const onPop = () => {
      const named = openParamOf(window.location.href);
      const top = live.current.find((w) => !w.aside);
      if (top && (!named || recordKey(named) !== top.key)) {
        asked.current += 1;
        setWindows((ws) => ws.filter((w) => w.aside));
        giveFocusBack(top);
      }
      if (named && (!top || recordKey(named) !== top.key)) openRef(named, {}, false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [syncUrl, openRef]);

  const remember = useCallback((r: RecentRecord) => {
    setRecent((rs) => {
      const top = rs[0];
      if (top && top.key === r.key && top.title === r.title && top.sub === r.sub) return rs;
      return [r, ...rs.filter((x) => x.key !== r.key)].slice(0, RECENT_MAX);
    });
  }, []);

  const forget = useCallback(() => {
    asked.current += 1;
    setWindows([]);
    setRecent([]);
  }, []);

  const api = useMemo<RecordsApi>(
    () => ({ hosted: true, open: (ref, opts) => openRef(ref, opts), forget }),
    [openRef, forget],
  );
  const windowsApi = useMemo<WindowsApi>(
    () => ({
      windows: shown,
      docked: syncUrl,
      close,
      dismiss,
      setAside,
      restore,
      stepOf,
      step,
      reload,
      recent,
      remember,
      toast,
    }),
    [shown, syncUrl, close, dismiss, setAside, restore, stepOf, step, reload, recent, remember, toast],
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
