"use client";

import { useContext, useEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { MenuItem } from "@/components/parts/menu";
import { JobSheet, type JobCardFirst } from "@/components/workboard/board/job-sheet";
import { AgreementForm, jobOfRow } from "@/components/workboard/board/agreement-form";
import { ToastHost, useBoardToasts } from "@/components/workboard/board/toasts";
import { WindowsContext, useRecords } from "@/components/records/records-context";
import { isPinned, pin, pinsServerSnapshot, pinsSnapshot, subscribePins, unpin } from "@/components/shell/pins-store";
import { namePage } from "@/components/shell/page-names";
import { jobTabLabel, SECTION_FACES, type JobSection } from "@/lib/jobs/job-sections";
import { jobPageHref, projectHref } from "@/lib/shell/links";
import { recordKey, type RecordRef } from "@/lib/records/ref";
import { jobHue } from "@/lib/workboard/job-hue";
import { noteJobOpened } from "@/lib/jobs/opened-jobs";
import type { PriceAsk } from "@/lib/jobs/job-prices";
import type { AllJobRow } from "@/lib/workboard/all-jobs";
import { starJob } from "@/app/actions/job-stars";

/** What a job's page opens as a document in a tab of its own: the quote
    (/dashboard/jobs/<id>/quote). */
export type JobDoc = "quote" | "invoice";

/* ONE JOB AS A PAGE (v2, step 5, "Jobs and a job"), inside the dashboard
   frame at /dashboard/jobs/<its ServiceM8 uuid>.

   The page is the job card's own faces in the card's page mode
   (job-sheet.tsx), so the card over the board and the page are one piece of
   code and can't drift. What the page adds is the page's: which section is
   open, kept in the address as `?tab=` (replaced, not pushed, the way a
   browser's own tabs don't stack); Pin and Copy the link under Actions; the
   name its open tab wears ("3209 Rowland", page-names.ts); and a row in
   the sidebar's Recents. */

export function JobPage({
  row,
  section: firstSection,
  manage,
  moneyVisible,
  financials = false,
  studio = false,
  add = null,
  price = null,
  first,
  doc = null,
  starred: firstStarred = false,
}: {
  row: AllJobRow;
  /** You starred it (lib/jobs/job-stars): Actions offers Unstar */
  starred?: boolean;
  section: JobSection;
  manage: boolean;
  moneyVisible: boolean;
  /** `financials`: the quote's own money on Price */
  financials?: boolean;
  /** Holds the Studio: the job has a Design section. */
  studio?: boolean;
  /** `?add=`: Documents' Make a document asked for a SWMS or a certificate */
  add?: "swms" | "certificate" | null;
  /** What Price was asked to open on: the quote's old page's `?start=`,
      `?option=` and `?update=`, a claim's own number's `?invoice=` */
  price?: Omit<PriceAsk, "n"> | null;
  /** What the page read on the server for the card (JobCardFirst). */
  first?: JobCardFirst;
  /** The quote open in a tab of its own: the job's head and sections give
      way to the quote's (job-doc-head.tsx). */
  doc?: JobDoc | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const records = useRecords();
  const remember = useContext(WindowsContext)?.remember;
  const [section, setSection] = useState<JobSection>(firstSection);
  /* A LINK TO THIS JOB FROM THIS JOB (a variation's Open, a Since the quote
     in Tiff's window) comes back as new props, not a new page: the section
     and Price's ask follow them */
  const [priceAsk, setPriceAsk] = useState<PriceAsk | null>(() => (price ? { ...price, n: 1 } : null));
  const [propsSeen, setPropsSeen] = useState({ firstSection, price });
  if (propsSeen.firstSection !== firstSection || propsSeen.price !== price) {
    setPropsSeen({ firstSection, price });
    setSection(firstSection);
    if (price) setPriceAsk((was) => ({ ...price, n: (was?.n ?? 0) + 1 }));
  }
  const { toasts, toast, dismiss } = useBoardToasts();
  const [agreementFrom, setAgreementFrom] = useState<AllJobRow | null>(null);

  const ref: RecordRef = { kind: "job", id: row.id };
  const title = row.number ? `Job ${row.number}` : "Job";
  const sub = row.clientName ?? null;
  /* the quote's tab says it's the quote ("Quote 3423"), an invoice's its own
     number once it's read ("Invoice #2845A"), in the job's colour */
  const [docLabel, setDocLabel] = useState<string | null>(null);
  const label =
    doc === "quote" ? (row.number ? `Quote ${row.number}` : "Quote") : doc === "invoice" ? (docLabel ?? "Invoice") : jobTabLabel(row.number, row.clientName);
  const hue = jobHue(row.categoryColour, row.statusLabel);

  /* the open tab's name, and the sidebar's Recents */
  useEffect(() => {
    namePage(pathname, { label, hue });
  }, [pathname, label, hue]);
  useEffect(() => {
    remember?.({ key: recordKey({ kind: "job", id: row.id }), ref: { kind: "job", id: row.id }, title, sub });
  }, [remember, row.id, title, sub]);
  /* and the jobs last opened here, which New design offers first (lib/jobs/opened-jobs) */
  const sm8Id = row.kind === "sm8" ? row.id : null;
  useEffect(() => {
    noteJobOpened(sm8Id);
  }, [sm8Id]);

  /* `?add=`, and Price's `?start=`, `?option=`, `?update=` and `?invoice=`,
     are asked once: the address drops them, so a reload or a copied link
     opens the job, not the wizard or a new quote again */
  useEffect(() => {
    const url = new URL(window.location.href);
    const once = ["add", "start", "option", "update", "invoice"].filter((k) => url.searchParams.has(k));
    if (once.length === 0) return;
    for (const k of once) url.searchParams.delete(k);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [priceAsk?.n]);

  const pins = useSyncExternalStore(subscribePins, pinsSnapshot, pinsServerSnapshot);
  const pinned = isPinned(pins, ref);

  const goSection = (next: JobSection) => {
    setSection(next);
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };

  /* your star on it (Isaac, 24 November 2026, the Star a job mock): shown
     at once, written behind, put back if the write fails */
  const [starred, setStarred] = useState(firstStarred);

  /* what the page does to the job (rule 53), after its stage */
  const actions: MenuItem[] = [
    { key: "pin", label: pinned ? "Unpin the job" : "Pin the job" },
    ...(row.kind === "sm8" ? [{ key: "star", label: starred ? "Unstar the job" : "Star the job" }] : []),
    { key: "link", label: "Copy the link" },
  ];
  const onAction = async (key: string) => {
    if (key === "star") {
      const on = !starred;
      setStarred(on);
      const r = await starJob(row.id, on).catch(() => ({ ok: false as const, error: on ? "That didn't star. Try it again." : "That didn't unstar. Try it again." }));
      if (!r.ok) {
        setStarred(!on);
        toast(r.error);
      } else toast(on ? "Added to Starred" : "Removed from Starred");
    } else if (key === "pin") {
      const ok = pinned ? await unpin(ref) : await pin({ ref, title, sub });
      if (!ok) toast(pinned ? "That didn't unpin. Try it again." : "That didn't pin. Try it again.");
    } else if (key === "link") {
      const link = `${window.location.origin}${doc ? window.location.pathname : jobPageHref(row.id)}`;
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
          financials={financials}
          studio={studio}
          initialTab={SECTION_FACES[firstSection][0]}
          first={first}
          page={{ section, onSection: goSection, actions, onAction: (key) => void onAction(key), add, price: priceAsk, doc, onDocLabel: setDocLabel }}
          /* New agreement opens over the page (rule 51), the job filled in */
          onCreateAgreement={(r) => setAgreementFrom(r)}
          /* a visit opens over the page; a project on its own page */
          onOpenTracked={(t) => {
            if (t.kind === "visit") records.open({ kind: "visit", id: t.id });
            else router.push(projectHref(t.id));
          }}
          onToast={(m, undo) => toast(m, undo)}
        />
      </div>
      {agreementFrom && (
        <AgreementForm
          initialJob={jobOfRow(agreementFrom)}
          onOpenAgreement={(id) => records.open({ kind: "agreement", id })}
          onToast={(m, undo) => toast(m, undo)}
          onClose={() => setAgreementFrom(null)}
        />
      )}
      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
