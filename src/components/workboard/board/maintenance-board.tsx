"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { urgentRows } from "@/lib/workboard/urgent-rules";
import { toConfirmCount } from "@/lib/workboard/board-status";
import { clearVisitPlacement, placeVisit } from "@/app/actions/workboard-maintenance";
import type { MaintenanceBoardData } from "@/lib/workboard/board-query";
import type { BoardFlag } from "@/lib/workboard/notes-query";
import { calOfMaintenance, gatesOf, toneOf, type CalVisit } from "./derive";
import { UpcomingTab } from "./upcoming-tab";
import { UrgentTab } from "./urgent-tab";
import { CalendarTab } from "./calendar-tab";
import { CompletedTab } from "./completed-tab";
import { AgreementsTab } from "./agreements-tab";
import { VisitSheet } from "./visit-sheet";
import { DayModal } from "./day-modal";
import { AgreementSheet } from "./agreement-sheet";
import { NewAgreementModal } from "./new-agreement-modal";
import { ToastHost, useBoardToasts } from "./toasts";

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

function syncedAgo(iso: string | null): string {
  if (!iso) return "not yet";
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (Number.isNaN(mins) || mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return "over a day ago";
}

export function MaintenanceBoard({
  data,
  flags,
  today,
  manage,
  connected,
  aiEnabled = false,
  sm8,
  onCaptureTarget,
  calOthers,
}: {
  data: MaintenanceBoardData;
  flags: BoardFlag[];
  today: string;
  manage: boolean;
  connected: boolean;
  /** ANTHROPIC key present — the create flow offers Tiff's job read. */
  aiEnabled?: boolean;
  /** The mirror-health surface that survives from the old board (D8/D4). */
  sm8?: { attention: boolean; syncedAt: string | null; running: boolean } | null;
  /** The capture pill's attachment (D15): with a visit sheet open, notes
      spoken land against THAT visit — the page owns the pill, the board
      tells it what's in front of the person. */
  onCaptureTarget?: (t: { visitId: string; label: string } | null) => void;
  /** The projects board's trips, for the calendar's merged view (P3). */
  calOthers?: CalVisit[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<BoardTab>("urgent");
  const [sheet, setSheet] = useState<{ visitId: string; closeOut: boolean } | null>(null);
  const [dayISO, setDayISO] = useState<string | null>(null);
  const [agreementId, setAgreementId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { toasts, toast, dismiss } = useBoardToasts();

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

  const sheetVisit = sheet ? data.visits.find((v) => v.id === sheet.visitId) ?? null : null;
  const openSheet = (visitId: string, closeOut = false) => setSheet({ visitId, closeOut });

  // Tell the page what the pill should attach to — and always hand back
  // "nothing" when the sheet closes or the board unmounts.
  const sheetVisitId = sheetVisit?.id ?? null;
  const sheetVisitLabel = sheetVisit ? `${sheetVisit.clientName} · ${sheetVisit.label}` : null;
  useEffect(() => {
    if (!onCaptureTarget) return;
    onCaptureTarget(
      sheetVisitId && sheetVisitLabel ? { visitId: sheetVisitId, label: sheetVisitLabel } : null
    );
    return () => onCaptureTarget(null);
  }, [sheetVisitId, sheetVisitLabel, onCaptureTarget]);
  const sheetAgreement = agreementId
    ? data.agreements.find((a) => a.id === agreementId) ?? null
    : null;

  /** K8's lost feature: the whole category's NEXT visits onto one day, one
      pass — with one undo restoring every visit to wherever it was. */
  const bookCategory = (ids: string[], day: string, categoryName: string) => {
    const targets = ids
      .map((id) => {
        const open = data.visits
          .filter(
            (v) =>
              v.agreementId === id && (v.status === "upcoming" || v.status === "booked")
          )
          .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
        return open[0] ?? null;
      })
      .filter((v): v is NonNullable<typeof v> => v !== null && v.bookedDate !== day);
    if (targets.length === 0) {
      toast(`${categoryName}: nothing open to book`);
      return;
    }
    const restore = targets.map((v) => ({ id: v.id, from: v.bookedDate }));
    (async () => {
      for (const v of targets) await placeVisit(v.id, day);
      toast(
        `${categoryName}: ${targets.length} ${targets.length === 1 ? "visit" : "visits"} placed on ${fmtAuWeekdayDayMonth(day)}`,
        async () => {
          for (const r of restore) {
            if (r.from) await placeVisit(r.id, r.from);
            else await clearVisitPlacement(r.id);
          }
          router.refresh();
        }
      );
      router.refresh();
    })();
  };

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
        {/* the mirror-health chip that survives from the old board (D8):
            absent when standalone, quiet when fresh, loud when the
            connection itself needs attention */}
        {sm8 && (
          <span className={"wb2-sm8" + (sm8.attention ? " dan" : "")}>
            {sm8.attention
              ? "ServiceM8 needs attention"
              : sm8.running
                ? "ServiceM8 syncing…"
                : `ServiceM8 synced ${syncedAgo(sm8.syncedAt)}`}
          </span>
        )}
      </div>

      <div className="wb2-card">
        <div key={`${tab}-${fallbackSwap}`} className={fallbackSwap ? "wb2-swap" : undefined}>
          {tab === "urgent" && (
            <UrgentTab
              rows={urgent}
              staff={data.staff}
              manage={manage}
              onOpenVisit={(id) => openSheet(id)}
              onCloseOut={(id) => openSheet(id, true)}
              onToast={toast}
            />
          )}
          {tab === "upcoming" && (
            <UpcomingTab
              visits={openVisits}
              today={today}
              confirm={confirmSummary}
              onOpen={(id) => openSheet(id)}
            />
          )}
          {tab === "calendar" && (
            <CalendarTab
              side="maintenance"
              visits={data.visits.map(calOfMaintenance)}
              others={calOthers ?? []}
              sideWord="Maintenance"
              otherWord="projects"
              today={today}
              onDay={(iso) => setDayISO(iso)}
            />
          )}
          {tab === "completed" && (
            <CompletedTab
              visits={data.visits}
              count={doneCount}
              manage={manage}
              onOpen={(id) => openSheet(id)}
              onToast={toast}
            />
          )}
          {tab === "agreements" && (
            <AgreementsTab
              agreements={data.agreements}
              today={today}
              manage={manage}
              onOpen={(id) => setAgreementId(id)}
              onNew={() => setCreating(true)}
              onBookCategory={bookCategory}
            />
          )}
        </div>
      </div>

      {dayISO && (
        <DayModal
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

      {sheetAgreement && (
        <AgreementSheet
          key={sheetAgreement.id}
          agreement={sheetAgreement}
          categories={data.categories}
          tagPool={data.tagPool}
          today={today}
          manage={manage}
          onToast={toast}
          onClose={() => setAgreementId(null)}
        />
      )}

      {creating && (
        <NewAgreementModal
          connected={connected}
          voiceless={!aiEnabled}
          agreements={data.agreements}
          categories={data.categories}
          onOpenAgreement={(id) => setAgreementId(id)}
          onToast={toast}
          onClose={() => setCreating(false)}
        />
      )}

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
          startClosing={sheet?.closeOut ?? false}
          onToast={toast}
          onClose={() => setSheet(null)}
        />
      )}

      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
