"use client";

import { Activity, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { frontOverlay } from "@/components/overlay/use-overlay";
import { JobSheet } from "@/components/workboard/board/job-sheet";
import { toneOf } from "@/components/workboard/board/derive";
import { jobHref, projectHref } from "@/lib/shell/links";
import { RecordsContext, WindowsContext, titleOf, type Win } from "./records-context";
import { isPinned, pin, pinsServerSnapshot, pinsSnapshot, subscribePins, unpin } from "@/components/shell/pins-store";

/* A visit's sheet and an agreement's load when one opens: most cards opened
   where you are are jobs, and these carry the maintenance board's actions
   with them. */
const VisitSheet = dynamic(() => import("@/components/workboard/board/visit-sheet").then((m) => m.VisitSheet), {
  ssr: false,
});
const AgreementSheet = dynamic(
  () => import("@/components/workboard/board/agreement-sheet").then((m) => m.AgreementSheet),
  { ssr: false },
);

/** The open records, drawn: the board's own sheet for each, wherever it was
    opened — a job's card, a maintenance visit's, a service agreement's.
    Drawn by the shell through `RecordWindowsSlot` (loaded when a record
    opens), or directly by a page that hosts its own records.

    A card set aside stays drawn, hidden, so it comes back as it was left;
    each card is kept in the place it was first opened in, so moving it
    between the dock and the front never remounts it. */
export function RecordWindows({ manage, moneyVisible }: { manage: boolean; moneyVisible: boolean }) {
  const host = useContext(WindowsContext);
  const records = useContext(RecordsContext);
  const router = useRouter();
  if (!host) return null;
  const { windows, close, dismiss, reload, toast } = host;
  return (
    <>
      {windows.map((w) => (
        <Activity key={w.key} mode={w.aside ? "hidden" : "visible"}>
          {/* Each sheet portals itself to <body>. */}
          {w.body.kind === "job" ? (
            /* Keyed by the job and the door, so a door that came to book
               opens a fresh card. */
            <JobSheet
              key={w.body.door ? `${w.body.row.id}:${w.body.door.n}` : w.body.row.id}
              row={w.body.row}
              manage={manage}
              moneyVisible={moneyVisible}
              scheduleState={w.body.state}
              initialTab={w.body.tab}
              {...(w.body.door?.bookIn ? { openBookIn: true as const } : {})}
              {...(w.body.door?.clear ? { openClear: w.body.door.clear } : {})}
              windowControls={<WindowControls win={w} />}
              onClose={() => close(w.key)}
              /* The new-agreement modal lives on the board, so the agreement
                 door lands there with the job open. */
              onCreateAgreement={(row) => {
                dismiss();
                router.push(jobHref(row.id));
              }}
              /* The chip opens the record it names: a visit over the screen
                 you are on, in this card's place; a project on its own
                 page. */
              onOpenTracked={(t) => {
                if (t.kind === "visit" && records) {
                  records.open({ kind: "visit", id: t.id });
                  return;
                }
                dismiss();
                router.push(projectHref(t.id));
              }}
              onToast={toast}
            />
          ) : w.body.kind === "visit" ? (
            <VisitSheet
              visit={w.body.card.visit}
              tone={toneOf(w.body.card.visit, w.body.card.today)}
              today={w.body.card.today}
              staff={w.body.card.staff}
              tagPool={w.body.card.tagPool}
              manage={manage}
              connected={w.body.card.connected}
              history={w.body.card.history}
              lastDone={w.body.card.lastDone}
              siteAddress={w.body.card.siteAddress}
              siteRequirements={w.body.card.siteRequirements}
              equipment={w.body.card.equipment}
              windowControls={<WindowControls win={w} />}
              /* The band's chip and a History row are doors to records of
                 their own: each opens in this card's place. */
              onOpenAgreement={(id) => records?.open({ kind: "agreement", id })}
              onOpenVisit={(id) => records?.open({ kind: "visit", id })}
              onToast={toast}
              onChanged={() => reload(w.key)}
              onClose={() => close(w.key)}
            />
          ) : (
            <AgreementSheet
              agreement={w.body.card.agreement}
              categories={w.body.card.categories}
              tagPool={w.body.card.tagPool}
              today={w.body.card.today}
              manage={manage}
              windowControls={<WindowControls win={w} />}
              onToast={toast}
              onChanged={() => reload(w.key)}
              onClose={() => close(w.key)}
            />
          )}
        </Activity>
      ))}
    </>
  );
}

/* THE WINDOW'S OWN CONTROLS, in the card's band beside its menu: what a
   card opened where you are can do that a card on the board cannot. Each
   carries its word (law 25).

     NEXT JOB, when the door that opened a job handed over a list and there
     is a job after this one in it. J and K walk the list too, while this
     card is the dialog in front and the key is not being typed into a field.

     SET ASIDE, into the dock, where the frame has one. */
function WindowControls({ win }: { win: Win }) {
  const host = useContext(WindowsContext);
  const ref = useRef<HTMLSpanElement>(null);
  const next = host?.stepOf(win.key, 1) ?? null;
  const prev = host?.stepOf(win.key, -1) ?? null;
  const walks = !!(next || prev);

  useEffect(() => {
    if (!host || !walks) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const by = e.key === "j" ? 1 : e.key === "k" ? -1 : 0;
      if (!by) return;
      const t = e.target;
      if (t instanceof Element && t.closest("input, textarea, select, [contenteditable='true']")) return;
      const card = ref.current?.closest<HTMLElement>('[role="dialog"]');
      if (!card || frontOverlay() !== card) return;
      if (!host.stepOf(win.key, by)) return;
      e.preventDefault();
      host.step(win.key, by);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [host, walks, win.key]);

  const pins = useSyncExternalStore(subscribePins, pinsSnapshot, pinsServerSnapshot);
  const pinned = isPinned(pins, win.ref);

  if (!host) return null;
  return (
    <span ref={ref} className="wb2-jcwin">
      {/* PIN (v2, rules 6 and 53): keeps this record in the sidebar's Pinned */}
      <button
        type="button"
        className="pbtn ghost sm"
        aria-pressed={pinned}
        onClick={async () => {
          const ok = pinned ? await unpin(win.ref) : await pin({ ref: win.ref, ...titleOf(win.body) });
          if (!ok) host.toast(pinned ? "That didn't unpin. Try it again." : "That didn't pin. Try it again.");
        }}
      >
        {pinned ? "Unpin" : "Pin"}
      </button>
      {next && (
        <button type="button" className="pbtn ghost sm" aria-keyshortcuts="J" onClick={() => host.step(win.key, 1)}>
          Next job
        </button>
      )}
      {host.docked && (
        <button type="button" className="pbtn ghost sm" onClick={() => host.setAside(win.key)}>
          Set aside
        </button>
      )}
    </span>
  );
}
