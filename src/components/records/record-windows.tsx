"use client";

import { useContext } from "react";
import { useRouter } from "next/navigation";
import { JobSheet } from "@/components/workboard/board/job-sheet";
import { jobHref, projectHref, visitHref } from "@/lib/shell/links";
import { WindowsContext } from "./record-host";

/** The open records, drawn: the board's own job card, wherever it was
    opened. Drawn by the shell through `RecordWindowsSlot` (loaded when a
    record opens), or directly by a page that hosts its own records. */
export function RecordWindows({ manage, moneyVisible }: { manage: boolean; moneyVisible: boolean }) {
  const host = useContext(WindowsContext);
  const router = useRouter();
  if (!host) return null;
  const { windows, close, dismiss, toast } = host;
  return (
    <>
      {windows.map((w) => (
        /* Portalled to <body> by the sheet itself. Keyed by the job, so a
           second job is a new card rather than the old one refilling. */
        <JobSheet
          key={w.door ? `${w.row.id}:${w.door.n}` : w.row.id}
          row={w.row}
          manage={manage}
          moneyVisible={moneyVisible}
          scheduleState={w.state}
          initialTab={w.tab}
          {...(w.door?.bookIn ? { openBookIn: true as const } : {})}
          {...(w.door?.clear ? { openClear: w.door.clear } : {})}
          onClose={() => close(w.key)}
          /* The new-agreement modal lives on the board, so the agreement door
             lands there with the job open. */
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
      ))}
    </>
  );
}
