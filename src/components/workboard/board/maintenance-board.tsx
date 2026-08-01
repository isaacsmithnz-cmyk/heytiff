"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { urgentRows } from "@/lib/workboard/urgent-rules";
import { toConfirmCount } from "@/lib/workboard/board-status";
import type { MaintenanceBoardData } from "@/lib/workboard/board-query";
import type { BoardFlag } from "@/lib/workboard/notes-query";
import { gatesOf, toneOf } from "./derive";
import { UpcomingTab } from "./upcoming-tab";
import { UrgentTab } from "./urgent-tab";
import { CalendarTab } from "./calendar-tab";
import { CompletedTab } from "./completed-tab";
import { AgreementsTab } from "./agreements-tab";
import { VisitSheet } from "./visit-sheet";

/* The redesigned maintenance board — five tabs on ONE persistent card.

   THE SURFACE RULE (E7, directed): switching tabs swaps the information,
   never the surface. The white card holds `view-transition-name: wbcard`;
   a switch runs inside document.startViewTransition so the box morphs while
   the outgoing content drifts up (fgPageOut's curve) and the incoming rises
   (fgPageIn's). No View Transitions support → the panel re-keys with the
   same vertical entrance. Nothing moves sideways; HeyTiff has no horizontal
   motion anywhere.

   Tab order is the order of the day (C5): what's on fire, what's near,
   the month, what closed, and the agreements ledger last.

   Every row's colour and every badge derives from the ONE status law in
   lib/workboard — this component never invents a tone. */

const TAB_KEYS = ["urgent", "upcoming", "calendar", "completed", "agreements"] as const;
export type BoardTab = (typeof TAB_KEYS)[number];

const TAB_LABEL: Record<BoardTab, string> = {
  urgent: "Urgent",
  upcoming: "Upcoming",
  calendar: "Calendar",
  completed: "Completed",
  agreements: "Service agreements",
};

export function MaintenanceBoard({
  data,
  flags,
  today,
  manage,
  connected,
}: {
  data: MaintenanceBoardData;
  flags: BoardFlag[];
  today: string;
  manage: boolean;
  connected: boolean;
}) {
  const [tab, setTab] = useState<BoardTab>("urgent");
  const [sheetId, setSheetId] = useState<string | null>(null);

  const openVisits = useMemo(
    () => data.visits.filter((v) => v.status === "upcoming" || v.status === "booked"),
    [data.visits]
  );

  const urgent = useMemo(
    () =>
      urgentRows({
        today,
        visits: openVisits.map((v) => ({
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
        flags: flags.map((f) => ({
          flagId: f.id,
          message: f.message,
          severity: f.severity === "urgent" ? "danger" : "warn",
          createdAt: f.createdAt,
          targetKind: f.targetKind ?? "none",
          targetId: f.targetId ?? null,
        })),
        tasks: data.tasks.map((t) => ({
          taskId: t.id,
          title: t.title,
          dueDate: t.dueDate,
          assigneeName: t.assigneeName,
        })),
      }),
    [today, openVisits, flags, data.tasks]
  );

  const confirmSummary = useMemo(
    () =>
      toConfirmCount(
        openVisits.map((v) => ({
          status: v.status,
          dueDate: v.dueDate,
          gates: gatesOf(v),
          mirrorStatus: v.mirrorStatus,
        })),
        today
      ),
    [openVisits, today]
  );

  const doneCount = useMemo(
    () => data.visits.filter((v) => v.status === "done").length,
    [data.visits]
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
  const showTab = (next: BoardTab) => {
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

  const sheetVisit = sheetId ? data.visits.find((v) => v.id === sheetId) ?? null : null;

  const badge = (t: BoardTab): { n: number; tone: "" | "dan" | "warn" } | null => {
    if (t === "urgent") {
      if (urgent.length === 0) return null;
      return { n: urgent.length, tone: urgent.some((r) => r.severity === "danger") ? "dan" : "warn" };
    }
    if (t === "upcoming" && confirmSummary.gaps > 0) return { n: confirmSummary.gaps, tone: "warn" };
    return null;
  };

  return (
    <div className="wb2">
      <div className="wb2-vtabs" ref={rowRef} role="tablist" aria-label="Maintenance board">
        {thumb && (
          <span
            className={"wb2-vslide" + (tab === TAB_KEYS[0] ? " first" : "")}
            style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }}
            aria-hidden="true"
          />
        )}
        {TAB_KEYS.map((t) => {
          const b = badge(t);
          return (
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
              {/* severity keeps its colour even on the active tab (E6) */}
              {b && <i className={"wb2-vtn" + (b.tone ? ` ${b.tone}` : "")}>{b.n}</i>}
            </button>
          );
        })}
      </div>

      <div className="wb2-card">
        <div key={`${tab}-${fallbackSwap}`} className={fallbackSwap ? "wb2-swap" : undefined}>
          {tab === "urgent" && (
            <UrgentTab rows={urgent} onOpenVisit={(id) => setSheetId(id)} manage={manage} />
          )}
          {tab === "upcoming" && (
            <UpcomingTab
              visits={openVisits}
              today={today}
              confirm={confirmSummary}
              onOpen={(id) => setSheetId(id)}
            />
          )}
          {tab === "calendar" && <CalendarTab visits={data.visits} today={today} />}
          {tab === "completed" && (
            <CompletedTab visits={data.visits} count={doneCount} onOpen={(id) => setSheetId(id)} />
          )}
          {tab === "agreements" && <AgreementsTab agreements={data.agreements} today={today} />}
        </div>
      </div>

      {sheetVisit && (
        <VisitSheet
          // keyed by the visit: opening a different one remounts the sheet,
          // so every draft (day, close-out, tag input) starts clean
          key={sheetVisit.id}
          visit={sheetVisit}
          tone={toneOf(sheetVisit, today)}
          today={today}
          staff={data.staff}
          tagPool={data.tagPool}
          manage={manage}
          connected={connected}
          onClose={() => setSheetId(null)}
        />
      )}
    </div>
  );
}
