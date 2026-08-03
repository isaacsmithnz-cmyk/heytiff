"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { projectUrgentRows } from "@/lib/workboard/project-rules";
import type { ProjectsBoardData } from "@/lib/workboard/projects-board-query";
import type { BoardFlag } from "@/lib/workboard/notes-query";
import { calOfProject } from "./derive";
import { ProjectUrgentTab } from "./project-urgent-tab";
import { PipelineTab } from "./pipeline-tab";
import { ProjectCompletedTab } from "./project-completed-tab";
import { CalendarTab } from "./calendar-tab";
import { ProjectTripSheet } from "./project-trip-sheet";
import { ProjectDayModal } from "./project-day-modal";
import { ToastHost, useBoardToasts } from "./toasts";
import { Sm8Chip, type Sm8Health } from "./sm8-chip";

/* The redesigned projects board — four tabs on ONE persistent card, the
   maintenance board's twin (never its fork): same surface rule (E7 — tab
   switches swap the information, not the card), same vertical-only motion,
   same one-status-law discipline. Tab order is the settled four:
   Urgent, Pipeline, Completed, Calendar. */

const TAB_KEYS = ["urgent", "pipeline", "completed", "calendar"] as const;
export type ProjectsTab = (typeof TAB_KEYS)[number];

const TAB_LABEL: Record<ProjectsTab, string> = {
  urgent: "Urgent",
  pipeline: "Pipeline",
  completed: "Completed",
  calendar: "Calendar",
};

export function ProjectsBoard({
  data,
  flags,
  today,
  manage,
  connected,
  onCaptureTarget,
  tools,
  sm8,
}: {
  data: ProjectsBoardData;
  /** Already routed by the page: only flags targeting projects or their trips. */
  flags: BoardFlag[];
  today: string;
  manage: boolean;
  connected: boolean;
  /** The capture pill's attachment (D15) — a trip while its sheet is open. */
  onCaptureTarget?: (t: { visitId: string; label: string } | null) => void;
  /** The page-owned capture pill, docked at the tab row's right end. */
  tools?: ReactNode;
  /** Mirror health — the same chip the maintenance row carries (D8). */
  sm8?: Sm8Health | null;
}) {
  const [tab, setTab] = useState<ProjectsTab>("urgent");
  const [sheet, setSheet] = useState<{ visitId: string; closeOut: boolean } | null>(null);
  const [dayISO, setDayISO] = useState<string | null>(null);
  const { toasts, toast, dismiss } = useBoardToasts();

  const openVisits = useMemo(
    () => data.visits.filter((v) => v.status === "upcoming" || v.status === "booked"),
    [data.visits]
  );

  const urgent = useMemo(
    () =>
      projectUrgentRows({
        today,
        projects: data.projects.map((p) => ({
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
        visits: openVisits.map((v) => ({
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
        flags: flags.map((f) => ({
          flagId: f.id,
          message: f.message,
          severity: f.severity === "urgent" ? "danger" : "warn",
          createdAt: f.createdAt,
        })),
      }),
    [today, data.projects, openVisits, flags]
  );

  /* ── the sliding tab thumb ── */
  const rowRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const row = rowRef.current;
      const on = row?.querySelector<HTMLButtonElement>(`[data-vt="${tab}"]`);
      if (!row || !on) return;
      setThumb({ x: on.offsetLeft, w: on.offsetWidth });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [tab]);

  /* ── the E7 switch: information swaps, the surface stays ── */
  const [fallbackSwap, setFallbackSwap] = useState(0);
  const showTab = (next: ProjectsTab) => {
    if (next === tab) return;
    const doc = document as Document & { startViewTransition?: (cb: () => void) => void };
    if (typeof doc.startViewTransition === "function") {
      doc.startViewTransition(() => {
        flushSync(() => setTab(next));
      });
    } else {
      setTab(next);
      setFallbackSwap((n) => n + 1);
    }
  };

  const sheetVisit = sheet ? data.visits.find((v) => v.id === sheet.visitId) ?? null : null;
  const openSheet = (visitId: string, closeOut = false) => setSheet({ visitId, closeOut });

  // Tell the page what the pill should attach to — and always hand back
  // "nothing" when the sheet closes or the board unmounts.
  const sheetVisitId = sheetVisit?.id ?? null;
  const sheetVisitLabel = sheetVisit ? `${sheetVisit.projectName} · ${sheetVisit.label}` : null;
  useEffect(() => {
    if (!onCaptureTarget) return;
    onCaptureTarget(
      sheetVisitId && sheetVisitLabel ? { visitId: sheetVisitId, label: sheetVisitLabel } : null
    );
    return () => onCaptureTarget(null);
  }, [sheetVisitId, sheetVisitLabel, onCaptureTarget]);

  /** The carry target: the project's next open trip after the one on show. */
  const nextTripFor = (v: { id: string; projectId: string; dueDate: string }) => {
    const later = openVisits
      .filter((o) => o.projectId === v.projectId && o.id !== v.id && o.dueDate >= v.dueDate)
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    return later[0] ? { id: later[0].id, label: later[0].label } : null;
  };

  return (
    <div className="wb2">
      <div className="wb2-vtabs" ref={rowRef} role="tablist" aria-label="Projects board">
        {thumb && (
          <span
            className="wb2-vslide"
            style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }}
            aria-hidden="true"
          />
        )}
        {TAB_KEYS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            data-vt={t}
            aria-selected={tab === t}
            className={"wb2-vt" + (tab === t ? " on" : "")}
            onClick={() => showTab(t)}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
        <Sm8Chip sm8={sm8} />
        {tools && <div className="wb2-vtcap">{tools}</div>}
      </div>

      <div className="wb2-card">
        <div key={`${tab}-${fallbackSwap}`} className={"wb2-panel" + (fallbackSwap ? " wb2-swap" : "")}>
          {tab === "urgent" && (
            <ProjectUrgentTab
              rows={urgent}
              staff={data.staff}
              manage={manage}
              onOpenVisit={(id) => openSheet(id)}
              onCloseOut={(id) => openSheet(id, true)}
              onToast={toast}
            />
          )}
          {tab === "pipeline" && (
            <PipelineTab projects={data.projects} today={today} manage={manage} />
          )}
          {tab === "completed" && (
            <ProjectCompletedTab
              projects={data.projects}
              today={today}
              manage={manage}
              onToast={toast}
            />
          )}
          {tab === "calendar" && (
            <CalendarTab
              visits={data.visits.map(calOfProject)}
              today={today}
              onDay={(iso) => setDayISO(iso)}
            />
          )}
        </div>
      </div>

      {dayISO && (
        <ProjectDayModal
          key={dayISO}
          dayISO={dayISO}
          visits={data.visits}
          today={today}
          staff={data.staff}
          manage={manage}
          onOpenVisit={(id) => {
            setDayISO(null);
            openSheet(id);
          }}
          onToast={toast}
          onClose={() => setDayISO(null)}
        />
      )}

      {sheetVisit && (
        <ProjectTripSheet
          // keyed by the visit: opening a different one remounts the sheet,
          // so every draft (day, close-out, bring input) starts clean
          key={sheetVisit.id}
          visit={sheetVisit}
          today={today}
          staff={data.staff}
          manage={manage}
          connected={connected}
          nextTrip={nextTripFor(sheetVisit)}
          startClosing={sheet?.closeOut ?? false}
          onToast={toast}
          onClose={() => setSheet(null)}
        />
      )}

      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
