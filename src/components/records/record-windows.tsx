"use client";

import { Activity, useContext, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { frontOverlay } from "@/components/overlay/use-overlay";
import { JobSheet } from "@/components/workboard/board/job-sheet";
import { jobHref, projectHref, visitHref } from "@/lib/shell/links";
import { WindowsContext, type Win } from "./records-context";

/** The open records, drawn: the board's own job card, wherever it was
    opened. Drawn by the shell through `RecordWindowsSlot` (loaded when a
    record opens), or directly by a page that hosts its own records.

    A card set aside stays drawn, hidden, so it comes back as it was left;
    each card is kept in the place it was first opened in, so moving it
    between the dock and the front never remounts it. */
export function RecordWindows({ manage, moneyVisible }: { manage: boolean; moneyVisible: boolean }) {
  const host = useContext(WindowsContext);
  const router = useRouter();
  if (!host) return null;
  const { windows, close, dismiss, toast } = host;
  return (
    <>
      {windows.map((w) => (
        <Activity key={w.key} mode={w.aside ? "hidden" : "visible"}>
          {/* Portalled to <body> by the sheet itself. Keyed by the job and
              the door, so a door that came to book opens a fresh card. */}
          <JobSheet
            key={w.door ? `${w.row.id}:${w.door.n}` : w.row.id}
            row={w.row}
            manage={manage}
            moneyVisible={moneyVisible}
            scheduleState={w.state}
            initialTab={w.tab}
            {...(w.door?.bookIn ? { openBookIn: true as const } : {})}
            {...(w.door?.clear ? { openClear: w.door.clear } : {})}
            windowControls={<WindowControls win={w} />}
            onClose={() => close(w.key)}
            /* The new-agreement modal lives on the board, so the agreement
               door lands there with the job open. */
            onCreateAgreement={(row) => {
              dismiss();
              router.push(jobHref(row.id));
            }}
            /* The chip lands on the record it names: the project's page, or
               the board with that visit's sheet up. */
            onOpenTracked={(t) => {
              dismiss();
              router.push(t.kind === "project" ? projectHref(t.id) : visitHref(t.id));
            }}
            onToast={toast}
          />
        </Activity>
      ))}
    </>
  );
}

/* THE WINDOW'S OWN CONTROLS, in the card's band beside its menu: what a
   card opened where you are can do that a card on the board cannot. Each
   carries its word (law 25).

     NEXT JOB, when the door that opened it handed over a list and there is
     a job after this one in it. J and K walk the list too, while this card
     is the dialog in front and the key is not being typed into a field.

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

  if (!host || (!next && !host.docked)) return null;
  return (
    <span ref={ref} className="wb2-jcwin">
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
