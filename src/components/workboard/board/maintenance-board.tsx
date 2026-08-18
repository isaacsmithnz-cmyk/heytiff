"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { urgentRows } from "@/lib/workboard/urgent-rules";
import { toConfirmCount } from "@/lib/workboard/board-status";
import type { MaintenanceBoardData } from "@/lib/workboard/board-query";
import type { BoardFlag } from "@/lib/workboard/notes-query";
import { calOfMaintenance, gatesOf, toneOf } from "./derive";
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
import { Sm8Chip, type Sm8Health } from "./sm8-chip";

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
  aiEnabled = false,
  sm8,
  tools,
  searchPanel = null,
  onExitSearch,
  openTarget = null,
}: {
  data: MaintenanceBoardData;
  flags: BoardFlag[];
  today: string;
  manage: boolean;
  connected: boolean;
  /** ANTHROPIC key present — the create flow offers Tiff's job read. */
  aiEnabled?: boolean;
  /** The mirror-health surface that survives from the old board (D8/D4). */
  sm8?: Sm8Health | null;
  /** The capture pill's attachment (D15): with a visit sheet open, notes
      spoken land against THAT visit — the page owns the pill, the board
      tells it what's in front of the person. */
  /** The page-owned capture pill, docked at the tab row's right end — the
      handoff's spot. Present in Display mode too: that mode mirrors this page
      rather than replacing it, so everything on it stays usable. */
  tools?: ReactNode;
  /* The universal search's answers, which replace this card's content while a
     query is live. Handed in rather than raised here because one box above
     three boards can only have one panel, and it must look the same from
     whichever side you typed on. */
  searchPanel?: ReactNode;
  /* Picking a tab leaves the search. The tab row stays lit behind the results
     panel so you can see where you'd land back — a control you can see and
     click has to actually take you there, and it can't while the panel is
     still covering the card. */
  onExitSearch?: () => void;
  /* Arriving from somewhere else with a job already in mind — following a
     tracked row off the All jobs side, picking a search result, or opening the
     agreement a duplicate guard pointed at. A visit and an agreement are
     DIFFERENT sheets and different ids; carrying the kind is what stops one
     being opened as the other. */
  openTarget?: { kind: "visit" | "agreement"; id: string } | null;
}) {
  const [tab, setTab] = useState<BoardTab>("urgent");
  const [sheet, setSheet] = useState<{ visitId: string; closeOut: boolean } | null>(null);
  const [dayISO, setDayISO] = useState<string | null>(null);
  const [agreementId, setAgreementId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { toasts, toast, dismiss } = useBoardToasts();

  /* TAKEN DURING RENDER, never in an effect. A prop consumed by an effect that
     setState's is a cascading render, and the compiler's own lint refuses it;
     React's answer for "a prop changed, adjust state" is to compare against
     the last one you saw, here.

     It used to be read ONCE, as this board's opening state, which worked only
     because arriving here always meant a side switch and so a fresh mount —
     and stopped being true the day search could name a visit while you were
     already standing on this side.

     IDENTITY is the signal, because the same visit may be asked for twice.
     The page hands over a FRESH object per pick, so choosing the same row
     again opens it again, while a plain re-render (display mode refreshes
     every minute) does nothing at all. The page drops the target when you
     move the switcher yourself, which is what stops a remount later reopening
     a sheet you already closed. */
  const [taken, setTaken] = useState<typeof openTarget>(null);
  if (openTarget && openTarget !== taken) {
    setTaken(openTarget);
    if (openTarget.kind === "visit") setSheet({ visitId: openTarget.id, closeOut: false });
    else setAgreementId(openTarget.id);
  }

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

  const sheetVisit = sheet ? data.visits.find((v) => v.id === sheet.visitId) ?? null : null;
  const openSheet = (visitId: string, closeOut = false) => setSheet({ visitId, closeOut });

  const sheetAgreement = agreementId
    ? data.agreements.find((a) => a.id === agreementId) ?? null
    : null;

  return (
    <div className="wb2">
      <div className="wb2-vtabs" ref={rowRef} role="tablist" aria-label="Maintenance board">
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
        <div key={`${tab}-${fallbackSwap}`} className={"wb2-panel" + (fallbackSwap ? " wb2-swap" : "")}>
          {tab === "urgent" && (
            <UrgentTab
              rows={urgent}
              staff={data.staff}
              manage={manage}
              onOpenVisit={(id) => openSheet(id)}
              onOpenAgreement={(id) => setAgreementId(id)}
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
              visits={data.visits.map(calOfMaintenance)}
              today={today}
              onDay={(iso) => setDayISO(iso)}
            />
          )}
          {tab === "completed" && (
            <CompletedTab
              visits={data.visits}
              count={doneCount}
              today={today}
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
            />
          )}
        </div>
        )}
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
