"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { urgentRows } from "@/lib/workboard/urgent-rules";
import { projectUrgentRows } from "@/lib/workboard/project-rules";
import type { WorkboardData } from "@/lib/workboard/page-data";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import {
  SEARCH_MIN,
  jobSearchTerm,
  searchWorkboard,
  type WorkHit,
} from "@/lib/workboard/work-search";
import { searchAllJobs } from "@/app/actions/workboard";
import { useNoteScopeScreen } from "@/components/notes/note-context";
import { createPortal } from "react-dom";
import { searchPhotos, type PhotoHit } from "@/app/actions/photo-search";
import { setJobPhotoFavourite } from "@/app/actions/job-photo-favourites";
import { PHOTO_SEARCH_MIN } from "@/lib/workboard/photo-search";
import { SideSwitcher, type SideBadge } from "./side-switcher";
import { MaintenanceBoard } from "./board/maintenance-board";
import { ProjectsBoard } from "./board/projects-board";
import { AllJobsBoard } from "./board/all-jobs-board";
import { JobMediaViewer } from "./board/job-media-viewer";
import { showcaseMediaItem } from "./board/showcase-view";
import { WorkSearchField, WorkSearchPanel, type PhotoSearchState } from "./board/work-search";

/** How long the photo bank waits for the typing to pause before it is asked. */
const PHOTO_DEBOUNCE_MS = 250;

/* The Workboard — a command centre, not a menu.

   THE BRIEF, IN ONE LINE: someone running a crew opens this at 6am and needs
   three answers before their first coffee — what's on fire, what's about to
   be, and how heavy is the run ahead. Everything on this screen serves one of
   those; anything that served none of them was cut.

   THE SHELL IS THE HANDOFF'S: the title left — and the title IS the side
   switcher (./side-switcher), so it says which half of the book you are
   reading and opens a menu to change it — then the tabs, the search, and
   Display mode right. Nothing else is on the page but the board card; the
   schedule lives in the Schedule tab, not in a second card below.

   THREE SIDES, TWO OF THEM DERIVED AND ONE FLAT. Maintenance and Projects
   show work that has been PROMOTED — into an agreement, into a project — and
   each carries a count of what needs somebody today. All jobs is the whole
   book ServiceM8 keeps: every service call, install and quote, including the
   ones nobody has promoted anywhere. It carries NO count, deliberately. The
   badge means "this many need you"; a total means nothing of the kind, and a
   number that looks like the others but answers a different question is
   worse than no number.

   All three are the SAME architecture — one persistent card, tabs that swap
   information rather than surface, every colour derived from the one status
   law. Maintenance runs five tabs, projects four, all jobs four. Flags route
   to the board whose work they point at, so nothing appears twice; All jobs
   raises none, because a reference list has no queue.

   Desktop-first, big-screen ready: DISPLAY MODE is this SAME page with the app
   frame taken away — sidebar, topbar and the well's inset gone, the width cap
   off, everything else exactly where it was. The side switcher, the tabs, the
   sheets and the capture pill all stay live, because this is the screen you
   WORK off on a big monitor, not a poster of it. It fullscreens the DOCUMENT
   (not the board element) for two reasons: the shell is what has to disappear,
   and every sheet/modal/toast portals to <body>, so fullscreening anything
   deeper would render them invisible. Closes on the header's own button or on
   Esc; refreshes every minute while it's up. No new route, no token — the
   person at the TV signed in like anyone else.

   Standalone-first: with no ServiceM8 connection the board keeps working —
   the SM8-derived strips are absent, not broken. WHERE it says so is the
   empty list, not this page: see board/sm8-gap. */

const REFRESH_MS = 60_000;

/* ALL JOBS FIRST, then projects and maintenance. It used to run the other
   way — the two curated sides first and the book of work last, on the
   reasoning that you only reach for "everything" when the curated sides
   don't have what you want. That reasoning aged: All jobs is the only side
   with an account's whole day on it, and since the Schedule tab landed it
   answers "who is on what right now" — the question this board is asked
   first, every morning.

   The board OPENS on it too — first side, first tab, which lands you on
   today's diary. It used to open on maintenance for its badges, but a badge
   is a summons you can see from any side (the title's arrow wears a dot
   while another side is waiting, and its menu says which), while the day's
   run is only legible from the side that holds it.

   This order is the menu's order, and nothing else keys off it. */
const SIDES = [
  { key: "jobs", label: "All jobs" },
  { key: "projects", label: "Projects" },
  { key: "maintenance", label: "Maintenance" },
] as const;
type SideKey = (typeof SIDES)[number]["key"];

export function OverviewScreen({
  data,
  openJob = null,
  openSearch = null,
  openVisit = null,
}: {
  data: WorkboardData;
  /** A job named in the URL — the page resolved it; this screen lands on it. */
  openJob?: AllJobsMirrorJob | null;
  /** Words named in the URL (`?q=`) — the board lands searching for them. */
  openSearch?: { text: string } | null;
  /** A visit named in the URL (`?visit=`), one the maintenance board holds.
      A job named too wins. */
  openVisit?: { id: string } | null;
}) {
  const router = useRouter();
  const [display, setDisplay] = useState(false);
  const [tab, setTab] = useState<SideKey>(!openJob && openVisit ? "maintenance" : "jobs");
  /* THE HANDOFF. Following a tracked job off the All jobs side, or choosing
     anything the universal search found: the switcher changes side AND the
     destination board opens the right sheet. Held here because the boards are
     siblings — neither can reach into the other.

     A ServiceM8 job travels as the JOB, not as an id: search reaches past the
     board's loaded window, so the destination may have nothing to look an id
     up in.

     A FRESH OBJECT PER HANDOFF is the contract: the boards take a target by
     identity, so the same visit named twice opens twice while a re-render
     opens nothing. It is dropped when you move the switcher yourself — which
     is the moment "I'm done with that" is unambiguous, and what stops coming
     back to a side reopening a sheet you already closed. */
  type Handoff =
    | { side: "maintenance"; kind: "visit" | "agreement"; id: string }
    | { side: "projects"; kind: "trip"; id: string }
    | { side: "jobs"; kind: "job"; job: AllJobsMirrorJob };
  const [handoff, setHandoff] = useState<Handoff | null>(
    /* A job named in the URL arrives the way a search hit does: the jobs
       side, its sheet open on that job. A visit arrives on the Maintenance
       side, its sheet open. */
    openJob
      ? { side: "jobs", kind: "job", job: openJob }
      : openVisit
        ? { side: "maintenance", kind: "visit", id: openVisit.id }
        : null
  );
  /* ...and a job named AGAIN arrives the same way. Seeding alone was not
     enough: the outlet is keyed on the PATHNAME, so a link here from the
     Workboard itself — the palette, opened while standing on this board —
     changes only the query and never remounts this screen. Taken by identity
     while rendering, like the boards take a handoff: each navigation hands a
     fresh object, a re-render hands the same one. */
  const [takenJob, setTakenJob] = useState(openJob);
  if (openJob !== takenJob) {
    setTakenJob(openJob);
    if (openJob) {
      setHandoff({ side: "jobs", kind: "job", job: openJob });
      setTab("jobs");
    }
  }
  /* A visit named again, the same way: Home's list followed while this board
     is already open (the pathname never changes). A fresh handoff, so the
     same visit named twice opens its sheet twice. */
  const [takenVisit, setTakenVisit] = useState(openVisit);
  if (openVisit !== takenVisit) {
    setTakenVisit(openVisit);
    if (openVisit && !openJob) {
      setHandoff({ side: "maintenance", kind: "visit", id: openVisit.id });
      setTab("maintenance");
    }
  }
  /* The link has done its job once the sheet is open — or the search is
     running — so it leaves the address. Left there, every refresh would hand the same job over again —
     a save on the sheet revalidates this page, and the sheet you were
     writing in would reopen under you — and naming the same job twice would
     change nothing a router could see. `?`-only, so the outlet keeps its key. */
  useEffect(() => {
    if (!openJob && !openSearch && !openVisit) return;
    const url = new URL(window.location.href);
    const named = ["job", "q", "visit"].filter((k) => url.searchParams.has(k));
    if (!named.length) return;
    for (const k of named) url.searchParams.delete(k);
    window.history.replaceState(null, "", url.toString());
  }, [openJob, openSearch, openVisit]);
  const pickSide = (side: SideKey) => {
    setHandoff(null);
    setTab(side);
  };

  const followTracked = (target: { kind: "visit" | "agreement" | "project"; id: string }) => {
    if (target.kind === "project") {
      router.push(`/dashboard/workboard/projects/${target.id}`);
      return;
    }
    setHandoff({ side: "maintenance", kind: target.kind, id: target.id });
    setTab("maintenance");
  };

  // Leaving fullscreen leaves display mode — Esc is the browser's own exit and
  // must land you back in the app, not on a chromeless page in a window.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setDisplay(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  /* The shell is hidden by an attribute on <html>, not by unmounting it: the
     board must not remount when you enter or leave, or an open sheet and every
     draft in it would go with it. Cleanup runs on navigation away too, so a
     link out of display mode can't strand you fullscreen with no chrome. */
  useEffect(() => {
    if (!display) return;
    const root = document.documentElement;
    root.setAttribute("data-wb-display", "on");
    return () => {
      root.removeAttribute("data-wb-display");
      if (document.fullscreenElement) void document.exitFullscreen?.()?.catch(() => {});
    };
  }, [display]);

  // A screen left up on a wall must not drift stale.
  useEffect(() => {
    if (!display) return;
    const t = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(t);
  }, [display, router]);

  const toDisplay = () => {
    setDisplay(true);
    /* A REJECTED request backs the mode out — being chromeless in a window is
       not what was asked for. A MISSING API doesn't: hiding the shell still
       buys the room, and the close button is right there either way. */
    void document.documentElement.requestFullscreen?.()?.catch(() => setDisplay(false));
  };

  /* "Connected" HERE MEANS "there is a mirror to read", which is the question
     every empty list is really asking — a grant that needs signing in again
     still has the whole book behind it (see lib/workboard/page-data). The
     chip is where its health is said. */
  const connected = data.connection !== "none";

  /* ── THE UNIVERSAL SEARCH ──

     One box, owned by the page rather than by any board, for two reasons.
     The boards unmount each other when you switch sides, so a search living
     inside one would empty itself the moment you crossed to the side holding
     the answer. And only this level can see all three datasets at once, which
     is the whole point of the box: not to filter the tab you're on, but to
     find the work without first having to know which side owns it.

     It replaced two — one in the agreements ledger's header, one repeated
     across the three All jobs lists — both of which sat INSIDE the card and
     so could only be reached from the tab that drew them. Five tabs had no
     search at all.

     THE LOCAL HALF answers on the keystroke, off data already on this page.
     THE MIRROR'S OLDER HALF is a round trip: the same server search the All
     jobs side used to run for itself, kept because a job finished last year
     is findable no other way. Both feed one panel. */
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<AllJobsMirrorJob[]>([]);
  const [searching, startSearch] = useTransition();

  /* THE PHOTO BANK'S HALF. The gallery tab used to carry its own box for
     this, one hand's width under this field — two searches with the same
     face and different reach. This is the box now, so the bank answers here,
     from any side and any tab.

     DEBOUNCED, AND THE LAST ANSWER WINS — the same discipline the box had on
     the gallery, kept for the same reasons: reading a photograph's worth of
     rows per keystroke is a query per letter, and without the sequence guard
     a slow answer for "duct" can land after a fast one for "ductwork" and
     paint the wrong photos under the right word. The debounce hangs off the
     change handler, where the typing is, not off an effect. */
  const [photoState, setPhotoState] = useState<PhotoSearchState>({
    hits: null,
    banked: 0,
    capped: false,
    searching: false,
  });
  /* The viewer over a photo hit. A SNAPSHOT of the hits at open, so clearing
     or retyping the search behind the scrim never reshuffles the roll under
     the reader's feet — the gallery's own rule. */
  const [photoView, setPhotoView] = useState<{ items: PhotoHit[]; index: number } | null>(
    null
  );
  /* WHICH HITS ARE ALREADY IN THE GALLERY — one set for the results panel and
     the viewer over it, because they are two views of the same photograph and
     a star that reads differently depending on which one you are looking at
     is a bug with two right answers. Seeded from what each hit reports, then
     owned here so a toggle survives closing the viewer. */
  const [photoStars, setPhotoStars] = useState<ReadonlySet<string>>(new Set());
  const photoSeq = useRef(0);
  const photoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (photoTimer.current) clearTimeout(photoTimer.current);
    };
  }, []);

  /* Memoised because the landing search below runs it from an effect. It reads
     no state — every setter, ref and the transition it touches is stable. */
  const runQuery = useCallback((q: string) => {
    setQuery(q);
    /* Every half asks for the same thing, and "job 288" asks for 288 — the
       box shows what was typed, the mirror and the bank hear the number. */
    const wanted = jobSearchTerm(q);
    // One character is not a search — it's a keystroke on the way to one, and
    // asking the mirror on every one of them is a query per letter.
    if (wanted.length < SEARCH_MIN) {
      setRemote([]);
    } else {
      startSearch(async () => setRemote(await searchAllJobs(wanted)));
    }

    if (photoTimer.current) clearTimeout(photoTimer.current);
    /* A too-short term schedules nothing and clears everything: it bumps the
       sequence so an answer still in flight is discarded rather than painted
       under a box that no longer asks for it. */
    const mine = ++photoSeq.current;
    if (wanted.length < PHOTO_SEARCH_MIN) {
      setPhotoState({ hits: null, banked: 0, capped: false, searching: false });
      return;
    }
    setPhotoState((cur) => ({ ...cur, searching: true }));
    photoTimer.current = setTimeout(() => {
      void searchPhotos(wanted)
        .then((res) => {
          if (!alive.current || mine !== photoSeq.current) return;
          setPhotoState({
            hits: res.hits,
            banked: res.banked,
            capped: res.capped,
            searching: false,
          });
          /* The server's truth about each hit replaces whatever this set was
             holding: these are a new set of photographs, and the answer for
             them comes back with them. */
          setPhotoStars(new Set(res.hits.filter((h) => h.starred).map((h) => h.remoteId)));
        })
        .catch(() => {
          if (!alive.current || mine !== photoSeq.current) return;
          setPhotoState({ hits: [], banked: 0, capped: false, searching: false });
        });
    }, PHOTO_DEBOUNCE_MS);
  }, []);
  const clearQuery = useCallback(() => {
    setQuery("");
    setRemote([]);
    if (photoTimer.current) clearTimeout(photoTimer.current);
    photoSeq.current += 1;
    setPhotoState({ hits: null, banked: 0, capped: false, searching: false });
    /* Leaving the search closes a viewer it opened — the panel under it is
       gone, so a photo floating over a tab it did not come from would be a
       layer with no ground. */
    setPhotoView(null);
  }, []);

  /* A SEARCH NAMED IN THE URL — ⌘K handing over a client. Taken the way a
     named job is, by identity while rendering, so a second client picked
     while standing on the board is taken too. The box shows the words at
     once; the asking it starts cannot happen inside a render, so it waits
     for the effect below, which runs it after the commit rather than during
     it (bell.tsx keeps the same distance). */
  const [takenSearch, setTakenSearch] = useState<{ text: string } | null>(null);
  const [landing, setLanding] = useState<{ text: string } | null>(null);
  if (openSearch !== takenSearch) {
    setTakenSearch(openSearch);
    if (openSearch) {
      setQuery(openSearch.text);
      setLanding(openSearch);
    }
  }
  useEffect(() => {
    if (!landing) return;
    void Promise.resolve().then(() => {
      setLanding(null);
      runQuery(landing.text);
    });
  }, [landing, runQuery]);

  /* Opening a hit FREEZES the list — the viewer walks a snapshot, so a
     result set changing underneath (a keystroke, a slow answer landing)
     cannot reshuffle the roll somebody is standing on. */
  const openPhotoHit = (index: number) => {
    const items = photoState.hits ?? [];
    if (!items[index]) return;
    setPhotoView({ items, index });
  };

  /* Starring a search result — from the card in the panel or from the bar in
     the viewer over it, which is the same act on the same photograph and so
     is the same handler. A search that just found the right photo is also
     the moment it can be kept. The hit is looked up in the SNAPSHOT as well
     as the live hits: the viewer outlives a query that has moved on. */
  const toggleHitStar = (remoteId: string) => {
    const hit =
      (photoState.hits ?? []).find((h) => h.remoteId === remoteId) ??
      photoView?.items.find((h) => h.remoteId === remoteId);
    if (!hit) return;
    const on = !photoStars.has(remoteId);
    const paint = (next: boolean) =>
      setPhotoStars((cur) => {
        const set = new Set(cur);
        if (next) set.add(remoteId);
        else set.delete(remoteId);
        return set;
      });
    paint(on);
    void setJobPhotoFavourite(hit.jobUuid, remoteId, on)
      .then((res) => {
        if (alive.current && !res.ok) paint(res.starred);
      })
      .catch(() => {
        if (alive.current) paint(!on);
      });
  };

  /* Escape closes the viewer FIRST — captured before the field's own Esc
     handler can clear the whole search out from under it. Innermost first,
     the same order the job sheet keeps. */
  const photoViewOpen = photoView !== null;
  useEffect(() => {
    if (!photoViewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setPhotoView(null);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [photoViewOpen]);

  const results = useMemo(
    () =>
      searchWorkboard(
        {
          today: data.today,
          jobs: data.allJobs.jobs,
          visits: data.board.visits,
          agreements: data.board.agreements,
          projects: data.projectsBoard.projects,
          trips: data.projectsBoard.visits,
          projectLinks: data.allJobs.projectLinks,
          elsewhere: remote,
        },
        query
      ),
    [data, remote, query]
  );

  /** The mirror job behind a job hit, from either half of the search — the
      All jobs board is handed the ROW's job, not its id, because a hit from
      past the loaded window has nothing on that board to be looked up in. */
  const jobByRemoteId = useMemo(() => {
    const map = new Map<string, AllJobsMirrorJob>();
    for (const j of data.allJobs.jobs) map.set(j.remoteId, j);
    for (const j of remote) if (!map.has(j.remoteId)) map.set(j.remoteId, j);
    return map;
  }, [data.allJobs.jobs, remote]);

  /* Choosing an answer lands you ON the work: the side switches and the sheet
     opens. A project is the one hit that isn't a sheet — it has a page of its
     own — so it routes instead. The search closes either way; leaving it open
     behind a sheet would put you back in results on close, having already
     gone where you asked. */
  const openHit = (hit: WorkHit) => {
    const go = hit.go;
    if (go.kind === "project") {
      clearQuery();
      router.push(`/dashboard/workboard/projects/${go.id}`);
      return;
    }
    if (go.kind === "job") {
      const job = jobByRemoteId.get(go.remoteId);
      if (!job) return;
      setHandoff({ side: "jobs", kind: "job", job });
    } else if (go.kind === "trip") {
      setHandoff({ side: "projects", kind: "trip", id: go.id });
    } else {
      setHandoff({ side: "maintenance", kind: go.kind, id: go.id });
    }
    setTab(go.side);
    clearQuery();
  };

  const searchField = (
    <WorkSearchField query={query} onQuery={runQuery} onClear={clearQuery} />
  );
  /* Present from the first character, not from the second: told nothing while
     a single letter sits in the box, you can't tell a search that hasn't
     started from one that found nothing. */
  const searchPanel = query.trim() ? (
    <WorkSearchPanel
      query={query}
      result={results}
      searching={searching}
      connected={connected}
      photos={photoState}
      starred={photoStars}
      onOpen={openHit}
      onOpenPhoto={openPhotoHit}
      onStarPhoto={toggleHitStar}
      onClear={clearQuery}
    />
  ) : null;

  /* Flags route to the board whose work they point at (the one rule: nothing
     appears twice). A flag on a project or a project's trip belongs to the
     projects queue; everything else — visits, agreements, general — stays
     with maintenance, which has always carried the general noise. */
  const projectVisitIds = useMemo(
    () => new Set(data.projectsBoard.visits.map((v) => v.id)),
    [data.projectsBoard.visits]
  );
  const { maintFlags, projectFlags } = useMemo(() => {
    const project = data.flags.filter(
      (f) =>
        f.targetKind === "project" ||
        (f.targetKind === "visit" && f.targetId !== null && projectVisitIds.has(f.targetId))
    );
    const projectIds = new Set(project.map((f) => f.id));
    return {
      projectFlags: project,
      maintFlags: data.flags.filter((f) => !projectIds.has(f.id)),
    };
  }, [data.flags, projectVisitIds]);

  /* Each side's count on the switcher = that side's Urgent queue, derived by
     the SAME rules the tab uses — the number you'd see if you switched. */
  const maintUrgent = useMemo(() => {
    const open = data.board.visits.filter(
      (v) => v.status === "upcoming" || v.status === "booked"
    );
    return urgentRows({
      today: data.today,
      visits: open.map((v) => ({
        visitId: v.id,
        agreementId: v.agreementId,
        label: v.label,
        clientName: v.clientName,
        siteLabel: v.siteLabel,
        status: v.status,
        dueDate: v.dueDate,
        bookedDate: v.bookedDate,
        readiness: v.readiness,
        techCount: v.techs.length,
        mirrorStatus: v.mirrorStatus,
      })),
      flags: maintFlags.map((f) => ({
        flagId: f.id,
        message: f.message,
        severity: f.severity === "urgent" ? "danger" : "warn",
        createdAt: f.createdAt,
        targetKind: f.targetKind ?? "none",
        targetId: f.targetId ?? null,
      })),
      tasks: data.board.tasks.map((t) => ({
        taskId: t.id,
        title: t.title,
        dueDate: t.dueDate,
        assigneeName: t.assigneeName,
      })),
    });
  }, [data.board.visits, data.board.tasks, data.today, maintFlags]);

  const projUrgent = useMemo(() => {
    const open = data.projectsBoard.visits.filter(
      (v) => v.status === "upcoming" || v.status === "booked"
    );
    return projectUrgentRows({
      today: data.today,
      projects: data.projectsBoard.projects.map((p) => ({
        id: p.id,
        name: p.name,
        clientName: p.clientName,
        siteLabel: p.siteLabel,
        status: p.status,
        stage: p.stage,
        blockedReason: p.blockedReason,
        blockedOn: p.blockedOn,
        blockedAt: p.blockedAt,
        promisedFinish: p.promisedFinish,
        updatedAt: p.updatedAt,
        hoursBudget: p.hoursBudget,
        hoursLogged: p.hoursLogged,
      })),
      visits: open.map((v) => ({
        visitId: v.id,
        projectId: v.projectId,
        projectName: v.projectName,
        clientName: v.clientName,
        siteLabel: v.siteLabel,
        label: v.label,
        status: v.status,
        dueDate: v.dueDate,
        bookedDate: v.bookedDate,
        readiness: v.readiness,
        techCount: v.techs.length,
      })),
      flags: projectFlags.map((f) => ({
        flagId: f.id,
        message: f.message,
        severity: f.severity === "urgent" ? "danger" : "warn",
        createdAt: f.createdAt,
      })),
    });
  }, [data.projectsBoard.visits, data.projectsBoard.projects, data.today, projectFlags]);

  const sideBadge = (rows: { severity: string }[]): SideBadge => ({
    n: rows.length,
    tone: rows.some((r) => r.severity === "danger") ? "dan" : rows.length ? "wrn" : "clr",
  });
  /* A side with no badge is a side with no queue — see the header. `null`
     rather than a zero, because a zero badge would say "nothing needs you"
     about a list that was never asking. */
  const badges: Record<SideKey, SideBadge> = {
    maintenance: sideBadge(maintUrgent),
    projects: sideBadge(projUrgent),
    jobs: null,
  };

  /* WHO THE NOTE MIGHT NAME. The field mics' sieve decides whether a
     dictated sentence is worth an Opus call, and a named person is its
     strongest single signal — but it can't recognise one without a roster.

     Taken off the CREWS ON THE BOARD rather than the whole org, because
     there is no org-wide roster in this payload and adding a query for one
     would be paying on every board load for a heuristic. It's also the right
     set: the people scheduled this week are the people a note says "tell
     ___" about. A miss costs one signal, never an error. */
  const staffFirstNames = useMemo(() => {
    const names = new Set<string>();
    for (const v of [...data.board.visits, ...data.projectsBoard.visits]) {
      for (const t of v.techs ?? []) {
        const first = t.name.trim().split(/\s+/)[0];
        if (first.length >= 2) names.add(first);
      }
    }
    return [...names];
  }, [data.board.visits, data.projectsBoard.visits]);

  /* THE TOKEN IS NOT ON THIS PAGE ANY MORE. It was a capsule docked at the
     tab row's right end; it is now the Tiff button in the frame, on every
     screen instead of two. What this page still owes it is CONTEXT — which
     job a note lands on, and the roster the local sieve reads names from —
     reported upward rather than passed down, because the button is above
     this screen in the tree.

     Display mode keeps working for free: the frame is what display mode
     hides, and the button hides with it. */
  useNoteScopeScreen({
    /* The board itself is not "about" any one job — a sheet opening over it
       says what it is about, through the scope's `focus` slot. This used to
       mirror the open sheet into page state via an `onCaptureTarget` callback
       threaded down through both boards; the sheets report themselves now. */
    target: { kind: "none" },
    staffFirstNames,
  });

  /* Mirror health rides in BOTH tab rows (D8) — it's a fact about the data
     on screen, not about maintenance. Absent when standalone. The account's
     clock hangs off it as a title rather than taking a line of its own. */
  const sm8 =
    data.connection === "none"
      ? null
      : {
          attention: data.connection === "attention",
          syncedAt: data.synced?.finishedAt ?? null,
          running: data.synced?.running ?? false,
          timezone: data.timezone,
        };

  /* The scope wraps the whole page, so every posture inside either board
     knows where it's standing without a single prop being threaded. The
     token's target follows whichever sheet is open (see `useNoteScopeTarget`)
     and falls back to the board itself, which is the "universal note taker"
     half of the widget. */
  /* ── THE HEADER IS THE TAB BAND ──────────────────────────────────────
     The title row and the tab row said the same thing one under the other:
     "Workboard", then six tabs naming what the Workboard holds, and the rail
     one column to the left already naming the screen a third time. Measured
     at 1600x900 the pair stood 128px tall before the board began.

     So the screen's h1 and its tools ride IN the tab row, which already had a
     right-hand slot for the search and the mirror chip, and the boards take
     them as `lead` and `tools`. `role="tablist"` sits on the inner row, since
     a tablist may only own tabs.

     AND THE H1 IS THE SWITCHER (Isaac, 2026-09-20: "go with 1, the title
     switcher"). The three sides had a line of their own above the band for a
     release, which cost 48px of board on every tab and named the screen a
     second time under a rail that already names it. The title says which side
     you are reading and opens the menu to change it; see ./side-switcher. */
  const boardLead = (
    <SideSwitcher
      sides={SIDES.map((s) => ({ key: s.key, label: s.label, badge: badges[s.key] }))}
      value={tab}
      onPick={pickSide}
    />
  );
  const boardTools = (
    <>
      {searchField}
      <div className="wb2-headtools">
        {display ? (
          <button
            className="pbtn ghost"
            onClick={() => setDisplay(false)}
            title="Back to the app — Esc does the same"
          >
            <Icon name="x" size={16} />
            Close display mode
          </button>
        ) : (
          <button
            className="pbtn ghost"
            onClick={toDisplay}
            title="Fill the screen — same board, no app frame"
          >
            <Icon name="maximize" size={16} />
            Display mode
          </button>
        )}
      </div>
    </>
  );

  return (
    /* `full` is the board asking for the whole well: paper to the dark
       rail and the dark bar, no grey margin, no width cap, no radius. The
       rules are in shell.css under "THE BOARD IS THE WELL" and reach the
       frame's own `.main` and `.outlet` with `:has()`, because a route cannot
       reach up. It is a class rather than an effect-set attribute so the first
       paint is already right. */
    <div className="page in full">
      <div className="wrap">
        <div className="stg">
          <div className="wb-board">
            {tab === "maintenance" && (
              <MaintenanceBoard
                data={data.board}
                flags={maintFlags}
                today={data.today}
                manage={data.manage}
                connected={connected}
                aiEnabled={data.aiEnabled}
                sm8={sm8}
                lead={boardLead}
                tools={boardTools}
                searchPanel={searchPanel}
                onExitSearch={clearQuery}
                openTarget={handoff?.side === "maintenance" ? handoff : null}
              />
            )}
            {tab === "projects" && (
              <ProjectsBoard
                data={data.projectsBoard}
                flags={projectFlags}
                today={data.today}
                manage={data.manage}
                connected={connected}
                sm8={sm8}
                lead={boardLead}
                tools={boardTools}
                searchPanel={searchPanel}
                onExitSearch={clearQuery}
                openTarget={handoff?.side === "projects" ? handoff : null}
              />
            )}
            {tab === "jobs" && (
              <AllJobsBoard
                data={data.allJobs}
                visits={data.board.visits}
                projectVisits={data.projectsBoard.visits}
                projects={data.projectsBoard.projects}
                agreements={data.board.agreements}
                categories={data.board.categories}
                today={data.today}
                manage={data.manage}
                moneyVisible={data.moneyVisible}
                connected={connected}
                backfilling={data.backfilling}
                aiEnabled={data.aiEnabled}
                sm8={sm8}
                onOpenTracked={followTracked}
                lead={boardLead}
                tools={boardTools}
                searchPanel={searchPanel}
                onExitSearch={clearQuery}
                openTarget={handoff?.side === "jobs" ? handoff : null}
              />
            )}

            {/* THE STANDALONE STAMP USED TO LIVE HERE. It ran under whichever
                board was open, which meant it was mostly read under a board
                that was working — a caption explaining an absence you weren't
                looking at, on every tab, every morning.

                The offer belongs where the absence actually shows: the empty
                list itself (board/sm8-gap). And because All jobs is the UNION
                of the mirror and the native rows, an empty All jobs is an
                empty everything — so the one empty state that matters is
                reached by anyone this message was ever for. */}
          </div>
        </div>
      </div>

      {/* The viewer a photo hit opens. PORTALLED TO BODY like every dashboard
          overlay — the page's own stacking context would trap a fixed layer
          under the shell. It outlives the panel that opened it on purpose:
          its list is a snapshot, so reading on while the search behind it
          changes is safe, and Escape peels the viewer first. */}
      {photoView &&
        createPortal(
          <JobMediaViewer
            items={photoView.items.map(showcaseMediaItem)}
            index={photoView.index}
            favourites={photoStars}
            onNav={(index) => setPhotoView((cur) => (cur ? { ...cur, index } : cur))}
            onStar={toggleHitStar}
            onClose={() => setPhotoView(null)}
          />,
          document.body
        )}
    </div>
  );
}
