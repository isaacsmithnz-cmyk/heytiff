"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { urgentRows } from "@/lib/workboard/urgent-rules";
import { projectUrgentRows } from "@/lib/workboard/project-rules";
import type { WorkboardData } from "@/lib/workboard/page-data";
import { NoteCapture } from "./note-capture";
import { MaintenanceBoard } from "./board/maintenance-board";
import { ProjectsBoard } from "./board/projects-board";
import { MaintenanceWall } from "./board/wall";

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

   Desktop-first, big-screen ready: DISPLAY MODE fullscreens the board element
   itself and refreshes every minute while it's up. No new route, no token —
   the person at the TV signed in like anyone else, and closing is Esc.

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
  const boardRef = useRef<HTMLDivElement>(null);
  const [display, setDisplay] = useState(false);
  const [tab, setTab] = useState<SideKey>("maintenance");
  /** What the capture pill attaches to — a visit while its sheet is open. */
  const [capture, setCapture] = useState<{ visitId: string; label: string } | null>(null);

  // Fullscreen state follows the browser, not our button — Esc must work.
  useEffect(() => {
    const onChange = () => setDisplay(document.fullscreenElement === boardRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // A wall screen left alone must not drift stale.
  useEffect(() => {
    if (!display) return;
    const t = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(t);
  }, [display, router]);

  const toDisplay = () => {
    boardRef.current?.requestFullscreen?.().catch(() => {});
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

  /* ONE pill, owned by the page, rendered inside whichever board is up —
     at the tab row's right end, where the handoff docks it (D15). Display
     mode never gets it: nobody at the wall TV can dictate into it. */
  const pill = display ? undefined : (
    <NoteCapture
      target={capture ? { kind: "visit", id: capture.visitId } : { kind: "none" }}
      targetLabel={capture?.label}
      voiceEnabled={data.voiceEnabled}
    />
  );

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
                    onClick={() => setTab(s.key)}
                  >
                    {s.label}
                    <i className={b.tone} title={`${b.n} need you today`}>
                      {b.n}
                    </i>
                  </button>
                );
              })}
            </nav>
            <div className="wb2-headtools">
              <button className="pbtn ghost" onClick={toDisplay} title="Fullscreen for a wall screen">
                <Icon name="maximize" size={16} />
                Display mode
              </button>
            </div>
          </header>

          <div className="wb-board" ref={boardRef}>
            {tab === "maintenance" ? (
              display ? (
                /* The wall composition (A10): Urgent + four weeks, LIGHT,
                   zero interactivity — not "fullscreen the current tab". */
                <MaintenanceWall data={data.board} flags={maintFlags} today={data.today} />
              ) : (
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
              )
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
  );
}
