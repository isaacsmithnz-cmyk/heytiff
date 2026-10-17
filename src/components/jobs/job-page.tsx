"use client";

import { useContext, useEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { MenuItem } from "@/components/parts/menu";
import { JobSheet } from "@/components/workboard/board/job-sheet";
import { ToastHost, useBoardToasts } from "@/components/workboard/board/toasts";
import { WindowsContext, useRecords } from "@/components/records/records-context";
import { isPinned, pin, pinsServerSnapshot, pinsSnapshot, subscribePins, unpin } from "@/components/shell/pins-store";
import { namePage } from "@/components/shell/page-names";
import { jobTabLabel, SECTION_FACES, type JobSection } from "@/lib/jobs/job-sections";
import { jobHref, jobPageHref, projectHref } from "@/lib/shell/links";
import { recordKey, type RecordRef } from "@/lib/records/ref";
import { jobHue } from "@/lib/workboard/job-hue";
import type { AllJobRow } from "@/lib/workboard/all-jobs";

/* ONE JOB AS A PAGE (v2, step 5, "Jobs and a job"), inside the dashboard
   frame at /dashboard/jobs/<its ServiceM8 uuid>.

   The page is the job card's own faces in the card's page mode
   (job-sheet.tsx), so the card over the board and the page are one piece of
   code and can't drift. What the page adds is the page's: which section is
   open, kept in the address as `?tab=` (replaced, not pushed, the way a
   browser's own tabs don't stack); Pin and Copy the link under Actions; the
   name its open tab wears ("3209 Richards", page-names.ts); and a row in
   the sidebar's Recents. */

export function JobPage({
  row,
  section: first,
  manage,
  moneyVisible,
}: {
  row: AllJobRow;
  section: JobSection;
  manage: boolean;
  moneyVisible: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const records = useRecords();
  const remember = useContext(WindowsContext)?.remember;
  const [section, setSection] = useState<JobSection>(first);
  const { toasts, toast, dismiss } = useBoardToasts();

  const ref: RecordRef = { kind: "job", id: row.id };
  const title = row.number ? `Job ${row.number}` : "Job";
  const sub = row.clientName ?? null;
  const label = jobTabLabel(row.number, row.clientName);
  const hue = jobHue(row.categoryColour, (row.statusLabel ?? "").trim().toLowerCase() === "unsuccessful");

  /* the open tab's name, and the sidebar's Recents */
  useEffect(() => {
    namePage(pathname, { label, hue });
  }, [pathname, label, hue]);
  useEffect(() => {
    remember?.({ key: recordKey({ kind: "job", id: row.id }), ref: { kind: "job", id: row.id }, title, sub });
  }, [remember, row.id, title, sub]);

  const pins = useSyncExternalStore(subscribePins, pinsSnapshot, pinsServerSnapshot);
  const pinned = isPinned(pins, ref);

  const goSection = (next: JobSection) => {
    setSection(next);
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };

  /* what the page does to the job (rule 53), after its stage */
  const actions: MenuItem[] = [
    { key: "pin", label: pinned ? "Unpin the job" : "Pin the job" },
    { key: "link", label: "Copy the link" },
  ];
  const onAction = async (key: string) => {
    if (key === "pin") {
      const ok = pinned ? await unpin(ref) : await pin({ ref, title, sub });
      if (!ok) toast(pinned ? "That didn't unpin. Try it again." : "That didn't pin. Try it again.");
    } else if (key === "link") {
      const link = `${window.location.origin}${jobPageHref(row.id)}`;
      await (navigator.clipboard?.writeText(link) ?? Promise.reject(new Error("no clipboard"))).then(
        () => toast("Link copied."),
        () => toast("Could not copy the link"),
      );
    }
  };

  return (
    <div className="page in">
      <div className="wrap jp">
        <JobSheet
          key={row.id}
          row={row}
          manage={manage}
          moneyVisible={moneyVisible}
          initialTab={SECTION_FACES[first][0]}
          page={{ section, onSection: goSection, actions, onAction: (key) => void onAction(key) }}
          /* a page has nothing to close */
          onClose={() => undefined}
          /* the new-agreement modal lives on the board, so the agreement
             door lands there with the job open, as the card's does */
          onCreateAgreement={(r) => router.push(jobHref(r.id))}
          /* a visit opens over the page; a project on its own page */
          onOpenTracked={(t) => {
            if (t.kind === "visit") records.open({ kind: "visit", id: t.id });
            else router.push(projectHref(t.id));
          }}
          onToast={(m) => toast(m)}
        />
      </div>
      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
