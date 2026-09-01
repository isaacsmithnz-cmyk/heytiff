"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
import { SEARCH_MIN, searchWorkboard, type WorkHit } from "@/lib/workboard/work-search";
import { searchAllJobs } from "@/app/actions/workboard";
import { useNoteScopeScreen } from "@/components/notes/note-context";
import { createPortal } from "react-dom";
import { searchPhotos, type PhotoHit } from "@/app/actions/photo-search";
import { setJobPhotoFavourite } from "@/app/actions/job-photo-favourites";
import { PHOTO_SEARCH_MIN } from "@/lib/workboard/photo-search";
import { MaintenanceBoard } from "./board/maintenance-board";
import { ProjectsBoard } from "./board/projects-board";
import { AllJobsBoard } from "./board/all-jobs-board";
import { JobMediaViewer } from "./board/job-media-viewer";
import { showcaseMediaItem } from "./board/showcase-view";
import { WorkSearchField, WorkSearchPanel, type PhotoSearchState } from "./board/work-search";

/* The Workboard — a command centre, not a menu.

   THE BRIEF, IN ONE LINE: someone running a crew opens this at 6am and needs
   three answers before their first coffee — what's on fire, what's about to
   be, and how heavy is the run ahead. Everything on this screen serves one of
   those; anything that served none of them was cut.

   THE SHELL IS THE HANDOFF'S: title left, the side switcher dead centre with
   each side's needs-you-today count on it, Display mode right, and nothing
   else on the page but the board card — the schedule lives in the Calendar
   tab, not in a second card below. The switcher's active side carries the
   side's own colour (maintenance green, projects cyan, all jobs ink), which
   is identity, not state — row tones still come only from the status law.

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
   is a summons you can see from any side (the switcher carries both counts
   at all times), while the day's run is only legible from the side that
   holds it.

   Nothing here is position-keyed, because the thumb measures off
   `[data-side]` and every side's colour hangs off `[data-on]` — which is
   also why only a test would notice this order changing. */
const SIDES = [
  { key: "jobs", label: "All jobs" },
  { key: "projects", label: "Projects" },
  { key: "maintenance", label: "Maintenance" },
] as const;
type SideKey = (typeof SIDES)[number]["key"];

export function OverviewScreen({ data }: { data: WorkboardData }) {
  const router = useRouter();
  const [display, setDisplay] = useState(false);
  const [tab, setTab] = useState<SideKey>("jobs");
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
  const [handoff, setHandoff] = useState<Handoff | null>(null);
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

  const connected = data.connection === "connected";

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
  const [viewStars, setViewStars] = useState<ReadonlySet<string>>(new Set());
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

  const PHOTO_DEBOUNCE_MS = 250;

  const runQuery = (q: string) => {
    setQuery(q);
    // One character is not a search — it's a keystroke on the way to one, and
    // asking the mirror on every one of them is a query per letter.
    if (q.trim().length < SEARCH_MIN) {
      setRemote([]);
    } else {
      startSearch(async () => setRemote(await searchAllJobs(q)));
    }

    const wanted = q.trim();
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
        })
        .catch(() => {
          if (!alive.current || mine !== photoSeq.current) return;
          setPhotoState({ hits: [], banked: 0, capped: false, searching: false });
        });
    }, PHOTO_DEBOUNCE_MS);
  };
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

  /* Opening a hit freezes the list and seeds the stars from what each hit
     already knows. The star in the viewer's bar toggles the real favourite —
     which is how a search that just found the right photo is also the moment
     it can be kept. */
  const openPhotoHit = (index: number) => {
    const items = photoState.hits ?? [];
    if (!items[index]) return;
    setViewStars(new Set(items.filter((h) => h.starred).map((h) => h.remoteId)));
    setPhotoView({ items, index });
  };

  const toggleHitStar = (remoteId: string) => {
    const hit = photoView?.items.find((h) => h.remoteId === remoteId);
    if (!hit) return;
    const on = !viewStars.has(remoteId);
    const paint = (next: boolean) =>
      setViewStars((cur) => {
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
      onOpen={openHit}
      onOpenPhoto={openPhotoHit}
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

  const sideBadge = (rows: { severity: string }[]) => ({
    n: rows.length,
    tone: rows.some((r) => r.severity === "danger") ? "dan" : rows.length ? "wrn" : "clr",
  });
  /* A side with no badge is a side with no queue — see the header. `null`
     rather than a zero, because a zero badge would say "nothing needs you"
     about a list that was never asking. */
  const badges: Record<SideKey, { n: number; tone: string } | null> = {
    maintenance: sideBadge(maintUrgent),
    projects: sideBadge(projUrgent),
    jobs: null,
  };

  /* ── the switcher's sliding fill — measured, because the sides differ in
     width; the fill colour is the side's identity (green / cyan) ── */
  const segRef = useRef<HTMLElement>(null);
  const [segThumb, setSegThumb] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const seg = segRef.current;
      const on = seg?.querySelector<HTMLButtonElement>(`[data-side="${tab}"]`);
      if (!seg || !on) return;
      setSegThumb({ x: on.offsetLeft, w: on.offsetWidth });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // A count changing changes a button's WIDTH, so the thumb must re-measure.
  }, [tab, badges.maintenance?.n, badges.projects?.n]);

  /* THE JOB CARDS a general note can be pinned to on review. Speaking a
     client's name from the board header is the normal case — "Luke needs to
     organise some filters for Kingsford Medical Centre" — and the note had no
     way to point at them, so its bring-list was silently thrown away on save.

     OPEN VISITS AND TRIPS FIRST, because they're the thing that carries a job
     number, and a job number is what makes "is this the right one?" a glance
     instead of a guess. Agreements follow for work with no visit raised yet;
     projects last. An agreement is offered once even if it has three open
     visits — the visits are the specific answer and the agreement is the
     fallback, so listing both keeps the general case reachable. */
  const attachOptions = useMemo(() => {
    const openOf = (s: string) => s === "upcoming" || s === "booked";
    return [
      ...data.board.visits
        .filter((v) => openOf(v.status))
        .map((v) => ({
          kind: "visit" as const,
          id: v.id,
          clientName: v.clientName,
          label: v.label,
          siteLabel: v.siteLabel,
          jobNumber: v.jobNumber,
        })),
      ...data.projectsBoard.visits
        .filter((v) => openOf(v.status))
        .map((v) => ({
          kind: "visit" as const,
          id: v.id,
          clientName: v.clientName ?? v.projectName,
          label: `${v.projectName} · ${v.label}`,
          siteLabel: v.siteLabel,
          jobNumber: v.jobNumber,
        })),
      ...data.board.agreements.map((a) => ({
        kind: "agreement" as const,
        id: a.id,
        clientName: a.clientName,
        label: a.label,
        siteLabel: a.siteLabel,
        jobNumber: null,
      })),
      ...data.projectsBoard.projects.map((p) => ({
        kind: "project" as const,
        id: p.id,
        clientName: p.clientName ?? p.name,
        label: p.name,
        siteLabel: p.siteLabel,
        jobNumber: null,
      })),
    ];
  }, [
    data.board.visits,
    data.board.agreements,
    data.projectsBoard.visits,
    data.projectsBoard.projects,
  ]);

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
     job a note lands on, which jobs it may be pinned to, and the roster the
     local sieve reads names from — reported upward rather than passed down,
     because the button is above this screen in the tree.

     Display mode keeps working for free: the frame is what display mode
     hides, and the button hides with it. */
  useNoteScopeScreen({
    /* The board itself is not "about" any one job — a sheet opening over it
       says what it is about, through the scope's `focus` slot. This used to
       mirror the open sheet into page state via an `onCaptureTarget` callback
       threaded down through both boards; the sheets report themselves now. */
    target: { kind: "none" },
    jobs: attachOptions,
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
  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg">
          <header className="wb2-head">
            <h1>Workboard</h1>
            <nav
              className="wb2-seg"
              role="tablist"
              aria-label="Which work"
              data-on={tab}
              ref={segRef}
            >
              {segThumb && (
                <span
                  className="wb2-segsl"
                  style={{ transform: `translateX(${segThumb.x}px)`, width: segThumb.w }}
                  aria-hidden="true"
                />
              )}
              {SIDES.map((s) => {
                const b = badges[s.key];
                return (
                  <button
                    key={s.key}
                    type="button"
                    role="tab"
                    aria-selected={tab === s.key}
                    data-side={s.key}
                    className={"wb2-segb" + (tab === s.key ? " on" : "")}
                    onClick={() => pickSide(s.key)}
                  >
                    {s.label}
                    {b && (
                      <i
                        className={b.tone}
                        title={`${b.n} ${b.n === 1 ? "needs" : "need"} attention`}
                      >
                        {b.n}
                      </i>
                    )}
                  </button>
                );
              })}
            </nav>
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
          </header>

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
                tools={searchField}
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
                tools={searchField}
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
                tools={searchField}
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
            favourites={viewStars}
            onNav={(index) => setPhotoView((cur) => (cur ? { ...cur, index } : cur))}
            onStar={toggleHitStar}
            onClose={() => setPhotoView(null)}
          />,
          document.body
        )}
    </div>
  );
}
