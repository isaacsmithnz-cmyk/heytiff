"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { allJobsRows, type AllJobRow, type AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import type { AllJobsData } from "@/lib/workboard/all-jobs-query";
import type { BoardVisit, BoardAgreement, BoardCategory } from "@/lib/workboard/board-query";
import type { BoardProject, ProjectBoardVisit } from "@/lib/workboard/projects-board-query";
import { WorkOrdersTab, QuotesTab, CompletedJobsTab } from "./all-jobs-tab";
import { ScheduleTab, type ScheduleJobState, type ScheduleShelfItem } from "./schedule-tab";
import { CapacityView } from "./capacity-view";
import type { SchedulePayload } from "@/lib/workboard/schedule-query";
import type { CapacityPayload } from "@/lib/workboard/capacity-query";
import { JobSheet } from "./job-sheet";
import { NewAgreementModal } from "./new-agreement-modal";
import { ToastHost, useBoardToasts } from "./toasts";
import { Sm8Chip, type Sm8Health } from "./sm8-chip";

/* THE THIRD SIDE: the whole book of work.

   Maintenance and Projects are derived boards — they show what has been
   PROMOTED into an agreement or a project. This one shows everything,
   organised the way ServiceM8 organises it, because that is the shape the
   people using it already carry in their heads: quotes waiting on an answer,
   work orders on the go, jobs finished. The tabs ARE ServiceM8's statuses, so
   the counts here and the counts there can be compared without translation.

   The board is the projects board's twin, not its fork: one persistent card,
   the E7 switch (information swaps, the surface stays), the same measured
   thumb, the same mirror-health chip in the tab row. What differs is that
   nothing on this side is urgent — there is no queue and no badge, because
   "everything" is a reference, not a to-do list. */

const TAB_KEYS = ["schedule", "work", "quotes", "completed", "capacity"] as const;
export type AllJobsTabKey = (typeof TAB_KEYS)[number];

/* Schedule sits FIRST — today's diary is the question this side gets asked
   every morning; the book of work follows in ServiceM8's own order. It is
   called Schedule, not Calendar: the maintenance board already owns a
   Calendar tab, and ServiceM8's own label for the object behind this one
   (job_activities) is Schedule.

   CAPACITY IS LAST, AND IT IS A TAB. It spent its first life as a second face
   of Schedule behind a Day/Capacity switcher inside the header — which put a
   second, competing set of controls in a header whose job was already to hold
   one set still. It is a different question anyway (how full are the coming
   weeks, not who is on what today), asked at a different grain, and the tab
   row already has the sliding thumb the switcher was imitating. */
const TAB_LABEL: Record<AllJobsTabKey, string> = {
  schedule: "Schedule",
  work: "Work orders",
  quotes: "Quotes",
  completed: "Completed",
  capacity: "Capacity",
};

export function AllJobsBoard({
  data,
  visits,
  projectVisits,
  projects,
  agreements,
  categories,
  today,
  manage,
  moneyVisible,
  connected,
  backfilling,
  aiEnabled = false,
  sm8,
  onOpenTracked,
  tools,
  searchPanel = null,
  onExitSearch,
  openTarget = null,
}: {
  data: AllJobsData;
  /** Maintenance visits — the native half of the union. */
  visits: BoardVisit[];
  /** Project trips, read ONLY to know whether a project has a booked day. */
  projectVisits: ProjectBoardVisit[];
  projects: BoardProject[];
  /** For the agreement modal's duplicate guard and its category picker. */
  agreements: BoardAgreement[];
  categories: BoardCategory[];
  today: string;
  manage: boolean;
  moneyVisible: boolean;
  connected: boolean;
  /* Which mirrors are still on their first walk — the difference between
     "nothing here" and "not here YET", which only this board can say. */
  backfilling: { jobs: boolean; schedule: boolean };
  aiEnabled?: boolean;
  sm8?: Sm8Health | null;
  /* Hands a row back to the page, which flips to the side that owns it and
     opens the right sheet. The KIND matters: a visit, an agreement and a
     project are three different destinations with three different ids. */
  onOpenTracked: (target: { kind: "visit" | "agreement" | "project"; id: string }) => void;
  /** The page-owned universal search, docked at the tab row's right end. */
  tools?: ReactNode;
  /** Its answers — see the maintenance board's note. */
  searchPanel?: ReactNode;
  /* Picking a tab leaves the search. The tab row stays lit behind the results
     panel so you can see where you'd land back — a control you can see and
     click has to actually take you there, and it can't while the panel is
     still covering the card. */
  onExitSearch?: () => void;
  /* A ServiceM8 job named from outside this board. It arrives as the JOB, not
     as an id: the row a search found may be older than this board's loaded
     window, so there would be nothing here to look the id up in. */
  openTarget?: { kind: "job"; job: AllJobsMirrorJob } | null;
}) {
  /* Lands on Schedule — the first tab is the landing tab on every board
     (Maintenance opens on Urgent the same way). The diary's fetch-on-open
     therefore fires when this SIDE opens, which is still nothing on the
     Workboard page load: the board only mounts when the side is chosen. */
  const [tab, setTab] = useState<AllJobsTabKey>("schedule");
  const [sheetRow, setSheetRow] = useState<AllJobRow | null>(null);
  /** The diary's reading of the sheet's job — set only when a schedule block
      opened it, cleared with the row. */
  const [sheetState, setSheetState] = useState<ScheduleJobState | null>(null);
  const [agreementFrom, setAgreementFrom] = useState<AllJobRow | null>(null);
  /* ── the diary's two tabs share their reads ──
     Schedule and Capacity ask the same server for the same days at two
     grains, and both unmount when you leave them. The caches and the window's
     anchor live HERE so moving between the two loses nothing: a day opened in
     Capacity is warm on the rail, the window you stepped to is still the
     window when you come back, and neither tab pays twice for a day the other
     already read. */
  const dayCache = useRef(new Map<string, SchedulePayload>());
  const capCache = useRef(new Map<string, CapacityPayload>());
  const [capAnchor, setCapAnchor] = useState(today);
  const { toasts, toast, dismiss } = useBoardToasts();

  /* THE UNION. Native rows are slimmed here rather than in the loader,
     because both boards' data is already on this page — asking the database
     again for what is three feet away would be paying twice. */
  const view = useMemo(() => {
    const byProject = new Map<string, string[]>();
    for (const l of data.projectLinks) {
      byProject.set(l.projectId, [...(byProject.get(l.projectId) ?? []), l.remoteId]);
    }
    const nextBookedByProject = new Map<string, string>();
    for (const t of projectVisits) {
      if (t.status !== "upcoming" && t.status !== "booked") continue;
      if (!t.bookedDate) continue;
      const cur = nextBookedByProject.get(t.projectId);
      if (!cur || t.bookedDate < cur) nextBookedByProject.set(t.projectId, t.bookedDate);
    }

    return allJobsRows({
      jobs: data.jobs,
      visits: visits.map((v) => ({
        id: v.id,
        jobNo: v.jobNo,
        remoteId: v.remoteId,
        clientName: v.clientName,
        label: v.label,
        siteLabel: v.siteLabel,
        categoryName: v.category?.name ?? null,
        dueDate: v.dueDate,
        bookedDate: v.bookedDate,
        status: v.status,
        completedAt: v.completedAt,
      })),
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        clientName: p.clientName,
        siteLabel: p.siteLabel,
        status: p.status,
        stage: p.stage,
        remoteIds: byProject.get(p.id) ?? [],
        nextBookedDate: nextBookedByProject.get(p.id) ?? null,
        updatedAt: p.updatedAt,
      })),
      today,
    });
  }, [data.jobs, data.projectLinks, visits, projectVisits, projects, today]);

  /* ── what the Schedule tab needs from data already on this page ── */

  /* OWNERSHIP, for the colour override: ServiceM8 job uuid → the board that
     owns it. Projects claim through the link table; maintenance through the
     visit's own remoteId. A job on both wears the project — the stronger
     promotion. */
  const trackedByJob = useMemo(() => {
    const map = new Map<string, { kind: "project" | "visit"; label: string; id: string }>();
    for (const v of visits) {
      if (v.remoteId) map.set(v.remoteId, { kind: "visit", label: v.clientName, id: v.id });
    }
    const projectName = new Map(projects.map((p) => [p.id, p.name]));
    for (const l of data.projectLinks) {
      map.set(l.remoteId, {
        kind: "project",
        label: projectName.get(l.projectId) ?? "Project",
        id: l.projectId,
      });
    }
    return map;
  }, [visits, projects, data.projectLinks]);

  /* NATIVE DAY-BOOKINGS for the shelf: a trip or a visit has a day, no clock
     and no ServiceM8 lane, so the schedule shows it above the rail instead of
     inventing a time for it. */
  const shelfItems = useMemo<ScheduleShelfItem[]>(() => {
    const out: ScheduleShelfItem[] = [];
    for (const v of visits) {
      if (!v.bookedDate || (v.status !== "upcoming" && v.status !== "booked")) continue;
      out.push({
        key: `v-${v.id}`,
        date: v.bookedDate,
        kind: "visit",
        id: v.id,
        label: `Maintenance — ${v.clientName}`,
        sub: v.label,
      });
    }
    for (const t of projectVisits) {
      if (!t.bookedDate || (t.status !== "upcoming" && t.status !== "booked")) continue;
      out.push({
        key: `p-${t.id}`,
        date: t.bookedDate,
        kind: "project",
        id: t.projectId,
        label: `Project — ${t.projectName}`,
        sub: t.label,
      });
    }
    return out;
  }, [visits, projectVisits]);

  /* A schedule block — or a search result — opens THE SAME SHEET the list rows
     open, on the same row shape: one job, one law. Both arrive already in the
     mirror shape, so the row builder that feeds the list feeds them too. */
  const openJob = (job: AllJobsMirrorJob, state: ScheduleJobState | null = null) => {
    const found = allJobsRows({ jobs: [job], visits: [], projects: [], today });
    const row = [
      ...found.work.booked,
      ...found.work.unbooked,
      ...found.quotes,
      ...found.completed,
      ...found.unsuccessful,
    ][0];
    if (!row) return;
    const t = trackedByJob.get(job.remoteId);
    setSheetState(state);
    setSheetRow(t ? { ...row, tracked: t } : row);
  };

  /* TAKEN DURING RENDER, never in an effect — see the maintenance board for
     why, and why IDENTITY rather than value is the signal.

     THE SERVER SEARCH LEFT THIS BOARD WITH THE BOX. It used to run its own
     half of the mirror query here and fold the hits in under the lists; one
     box above all three boards means one caller, and that is the page. */
  const [taken, setTaken] = useState<typeof openTarget>(null);
  if (openTarget && openTarget !== taken) {
    setTaken(openTarget);
    openJob(openTarget.job);
  }

  /* ── the sliding tab thumb — measured, like both boards ── */
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
  const showTab = (next: AllJobsTabKey) => {
    onExitSearch?.();
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

  const panelProps = {
    view,
    today,
    moneyVisible,
    truncated: data.truncated,
    connected,
    syncing: backfilling.jobs,
    manage,
    onOpen: (row: AllJobRow) => {
      // Only ServiceM8 rows have a sheet to open. A native row already has a
      // home on another board, so it goes there instead of into a second
      // viewer that would only say less.
      if (row.kind === "sm8") setSheetRow(row);
      else onOpenTracked({ kind: row.kind === "visit" ? "visit" : "project", id: row.id });
    },
  };

  return (
    <div className="wb2">
      <div className="wb2-vtabs" ref={rowRef} role="tablist" aria-label="All jobs board">
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
        {searchPanel ?? (
        <div
          key={`${tab}-${fallbackSwap}`}
          className={"wb2-panel" + (fallbackSwap ? " wb2-swap" : "")}
        >
          {tab === "work" && <WorkOrdersTab {...panelProps} />}
          {tab === "quotes" && <QuotesTab {...panelProps} />}
          {tab === "completed" && <CompletedJobsTab {...panelProps} />}
          {tab === "capacity" && (
            <CapacityView
              today={today}
              manage={manage}
              connected={connected}
              syncing={backfilling.schedule}
              anchor={capAnchor}
              onAnchor={setCapAnchor}
              capCache={capCache}
              dayCache={dayCache}
              tracked={trackedByJob}
              onOpenJob={openJob}
            />
          )}
          {tab === "schedule" && (
            <ScheduleTab
              today={today}
              connected={connected}
              syncing={backfilling.schedule}
              manage={manage}
              tracked={trackedByJob}
              dayCache={dayCache}
              shelfItems={shelfItems}
              waitingCount={view.work.unbooked.length}
              onOpenJob={openJob}
              onOpenTracked={onOpenTracked}
              onGoWork={() => showTab("work")}
            />
          )}
        </div>
        )}
      </div>

      {sheetRow && (
        <JobSheet
          key={sheetRow.id}
          row={sheetRow}
          manage={manage}
          moneyVisible={moneyVisible}
          sm8={sm8}
          scheduleState={sheetState}
          onClose={() => {
            setSheetRow(null);
            setSheetState(null);
          }}
          onCreateAgreement={(row) => {
            setSheetRow(null);
            setAgreementFrom(row);
          }}
          onOpenTracked={(tracked) => {
            setSheetRow(null);
            onOpenTracked(tracked);
          }}
          onToast={(m) => toast(m)}
        />
      )}

      {/* The SAME modal the agreements tab opens — prefilled from this job, so
          the ServiceM8 leg it already had is simply pre-answered, Tiff's
          analyse offer included. */}
      {agreementFrom && (
        <NewAgreementModal
          agreements={agreements}
          categories={categories}
          voiceless={!aiEnabled}
          connected={connected}
          initialJob={{
            remoteId: agreementFrom.id,
            jobNumber: agreementFrom.number,
            status: agreementFrom.statusLabel,
            clientName: agreementFrom.clientName,
            companyId: null,
            suburb: agreementFrom.suburb,
            /* The list row carries no street — only the suburb the board
               shows — so this stays null rather than inventing one. */
            address: null,
            description: agreementFrom.title,
            linkedTo: [],
          }}
          onOpenAgreement={(id) => {
            setAgreementFrom(null);
            onOpenTracked({ kind: "agreement", id });
          }}
          onToast={toast}
          onClose={() => setAgreementFrom(null)}
        />
      )}

      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
