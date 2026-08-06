"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { urgentRows } from "@/lib/workboard/urgent-rules";
import { projectUrgentRows } from "@/lib/workboard/project-rules";
import type { WorkboardData } from "@/lib/workboard/page-data";
import { NoteToken } from "@/components/notes/note-token";
import { NoteScopeProvider } from "@/components/notes/note-context";
import { MaintenanceBoard } from "./board/maintenance-board";
import { ProjectsBoard } from "./board/projects-board";

/* The Workboard — a command centre, not a menu.

   THE BRIEF, IN ONE LINE: someone running a crew opens this at 6am and needs
   three answers before their first coffee — what's on fire, what's about to
   be, and how heavy is the run ahead. Everything on this screen serves one of
   those; anything that served none of them was cut.

   THE SHELL IS THE HANDOFF'S: title left, the side switcher dead centre with
   each side's needs-you-today count on it, Display mode right, and nothing
   else on the page but the board card — the schedule lives in the Calendar
   tab, not in a second card below. The switcher's active side carries the
   side's own colour (maintenance green, projects cyan), which is identity,
   not state — row tones still come only from the status law.

   Both sides of the switcher are the SAME architecture — one persistent
   card, tabs that swap information rather than surface, every colour derived
   from the one status law. Maintenance runs five tabs, projects four; flags
   route to the board whose work they point at, so nothing appears twice.

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

   Standalone-first: with no ServiceM8 connection the board says exactly that
   and keeps working — the SM8-derived strips are absent, not broken. */

const REFRESH_MS = 60_000;

/* Projects first, maintenance second — the handoff's order. The board still
   OPENS on maintenance, the side that carries the daily noise. */
const SIDES = [
  { key: "projects", label: "Projects" },
  { key: "maintenance", label: "Maintenance" },
] as const;
type SideKey = (typeof SIDES)[number]["key"];

export function OverviewScreen({ data }: { data: WorkboardData }) {
  const router = useRouter();
  const [display, setDisplay] = useState(false);
  const [tab, setTab] = useState<SideKey>("maintenance");
  /** What the capture pill attaches to — a visit while its sheet is open. */
  const [capture, setCapture] = useState<{ visitId: string; label: string } | null>(null);

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
  const badges: Record<SideKey, { n: number; tone: string }> = {
    maintenance: sideBadge(maintUrgent),
    projects: sideBadge(projUrgent),
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
  }, [tab, badges.maintenance.n, badges.projects.n]);

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

  /* ONE token, owned by the page, rendered inside whichever board is up —
     at the tab row's right end, where the handoff docks it (D15). Display
     mode keeps it: the whole point of the mode is that you can work off it.

     It takes no target and no job list any more. Both come from the scope
     below, which is what lets a sheet opening over the board re-aim the same
     token at the visit it just opened without anything being passed down. */
  const pill = <NoteToken as="capsule" label="a note" />;

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
    <NoteScopeProvider
      voiceEnabled={data.voiceEnabled}
      target={capture ? { kind: "visit", id: capture.visitId } : { kind: "none" }}
      targetLabel={capture?.label}
      jobs={attachOptions}
      staffFirstNames={staffFirstNames}
    >
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
                    onClick={() => setTab(s.key)}
                  >
                    {s.label}
                    <i className={b.tone} title={`${b.n} ${b.n === 1 ? "needs" : "need"} attention`}>
                      {b.n}
                    </i>
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
            {tab === "maintenance" ? (
              <MaintenanceBoard
                data={data.board}
                flags={maintFlags}
                today={data.today}
                manage={data.manage}
                connected={connected}
                aiEnabled={data.aiEnabled}
                sm8={sm8}
                onCaptureTarget={setCapture}
                tools={pill}
              />
            ) : (
              <ProjectsBoard
                data={data.projectsBoard}
                flags={projectFlags}
                today={data.today}
                manage={data.manage}
                connected={connected}
                sm8={sm8}
                onCaptureTarget={setCapture}
                tools={pill}
              />
            )}

            {/* One line, not a card: standalone is a fact about the board, not
                a thing to read every morning. */}
            {data.connection === "none" && (
              <p className="wb-stamp">
                Running standalone — projects and maintenance are tracked here without any
                integration.
                {data.manage && (
                  <>
                    {" "}
                    <Link href="/dashboard/admin/integrations/servicem8" className="ro-link">
                      Connect ServiceM8
                    </Link>{" "}
                    to fill it with live jobs, clients and bookings.
                  </>
                )}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
    </NoteScopeProvider>
  );
}
