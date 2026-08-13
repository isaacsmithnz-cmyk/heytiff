"use client";

import { useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { allJobsRows, type AllJobRow, type AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import type { AllJobsData } from "@/lib/workboard/all-jobs-query";
import type { BoardVisit, BoardAgreement, BoardCategory } from "@/lib/workboard/board-query";
import type { BoardProject, ProjectBoardVisit } from "@/lib/workboard/projects-board-query";
import { searchAllJobs } from "@/app/actions/workboard";
import { WorkOrdersTab, QuotesTab, CompletedJobsTab } from "./all-jobs-tab";
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

const TAB_KEYS = ["work", "quotes", "completed"] as const;
export type AllJobsTabKey = (typeof TAB_KEYS)[number];

const TAB_LABEL: Record<AllJobsTabKey, string> = {
  work: "Work orders",
  quotes: "Quotes",
  completed: "Completed",
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
  aiEnabled = false,
  sm8,
  onOpenTracked,
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
  aiEnabled?: boolean;
  sm8?: Sm8Health | null;
  /* Hands a row back to the page, which flips to the side that owns it and
     opens the right sheet. The KIND matters: a visit, an agreement and a
     project are three different destinations with three different ids. */
  onOpenTracked: (target: { kind: "visit" | "agreement" | "project"; id: string }) => void;
}) {
  const [tab, setTab] = useState<AllJobsTabKey>("work");
  const [query, setQuery] = useState("");
  const [sheetRow, setSheetRow] = useState<AllJobRow | null>(null);
  const [agreementFrom, setAgreementFrom] = useState<AllJobRow | null>(null);
  const [remote, setRemote] = useState<AllJobsMirrorJob[]>([]);
  const [searching, startSearch] = useTransition();
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

  /* The loaded window is the recent past and the open present. Anything older
     lives in the mirror and is reached by ASKING — which is why typing runs a
     server search alongside the local filter rather than instead of it. */
  const runQuery = (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) {
      setRemote([]);
      return;
    }
    startSearch(async () => setRemote(await searchAllJobs(q)));
  };

  /** Server hits, minus anything already on screen — a row found twice is a
      row that looks like two jobs. */
  const extra = useMemo(() => {
    if (remote.length === 0) return [];
    const onScreen = new Set(
      [
        ...view.work.booked,
        ...view.work.unbooked,
        ...view.quotes,
        ...view.completed,
        ...view.unsuccessful,
      ].map((r) => r.key)
    );
    const found = allJobsRows({ jobs: remote, visits: [], projects: [], today });
    return [
      ...found.work.booked,
      ...found.work.unbooked,
      ...found.quotes,
      ...found.completed,
      ...found.unsuccessful,
    ].filter((r) => !onScreen.has(r.key));
  }, [remote, view, today]);

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
    query,
    onQuery: runQuery,
    onOpen: (row: AllJobRow) => {
      // Only ServiceM8 rows have a sheet to open. A native row already has a
      // home on another board, so it goes there instead of into a second
      // viewer that would only say less.
      if (row.kind === "sm8") setSheetRow(row);
      else onOpenTracked({ kind: row.kind === "visit" ? "visit" : "project", id: row.id });
    },
    extra,
    searching,
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
      </div>

      <div className="wb2-card">
        <div
          key={`${tab}-${fallbackSwap}`}
          className={"wb2-panel" + (fallbackSwap ? " wb2-swap" : "")}
        >
          {tab === "work" && <WorkOrdersTab {...panelProps} />}
          {tab === "quotes" && <QuotesTab {...panelProps} />}
          {tab === "completed" && <CompletedJobsTab {...panelProps} />}
        </div>
      </div>

      {sheetRow && (
        <JobSheet
          key={sheetRow.id}
          row={sheetRow}
          manage={manage}
          moneyVisible={moneyVisible}
          onClose={() => setSheetRow(null)}
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
