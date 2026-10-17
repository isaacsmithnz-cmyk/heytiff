"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { readJobFiles, readJobRecord, type readMirrorJob } from "@/app/actions/workboard";
import { cacheJobFiles } from "@/app/actions/workboard-media";
import { Button } from "@/components/parts/button";
import { Fade } from "@/components/parts/fade";
import { Dot } from "@/components/parts/state";
import { SectionTabs, type TabItem } from "@/components/parts/tabs";
import { jobPageHref } from "@/lib/shell/links";
import { SECTION_LABEL, sectionsFor } from "@/lib/jobs/job-sections";
import { Waiting } from "@/components/ui/orb";
import { jobHue } from "@/lib/workboard/job-hue";
import { proposalTitle } from "@/lib/quotes/proposal";
import type { FamilyMoney } from "@/lib/workboard/job-family";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import type { JobMediaGroupsRead } from "@/lib/workboard/job-media-query";
import { JobMediaViewer } from "../board/job-media-viewer";
import { JobQuoteSend } from "../board/job-quote-send";
import { useQuotePrice } from "./quote-parts";
import { QuoteLinesFace, type QuoteStage } from "./quote-lines-face";
import { ToastHost, useBoardToasts } from "../board/toasts";
import { sm8QuoteOf } from "./sm8-quote-of";

/* THE QUOTE PAGE — one job's quote, full screen inside the Workboard (Isaac,
   2026-10-05: "it should have opened up the proper quote screen not a
   section below"), in v2's layout C (his pick, 18 October 2026): above the
   conversation only the job's name, one grey line under it (its kind, its
   number, its address and the quote's state word) and the job's seven
   section tabs, Quote the one you're on. No breadcrumb (the open tab and
   Jobs in the sidebar say where you are), and the job's stages line is
   Overview's. Under them the quote (quote-lines-face.tsx): the conversation
   with Tiff, or the line items, filling the left, and the rail on the right
   with the quote's progress, its card and its buttons, what goes to
   ServiceM8 and ServiceM8's own quote, its price read afresh whenever the
   quote changes.

   Each other tab goes to the job's own page on that section (v2, step 5);
   Billing is there only for whoever sees the money, as on the job's page.

   EVERY QUOTE IS BUILT ON ITS LINES (retiring the old builder, Isaac,
   2026-10-12): one still on the old builder is switched to them as it's
   opened, and Tiff reads what its old draft said (job-sources-server.ts).

   It reads the job as the card does (the same actions; the page hands the
   job itself in, read on the server), so the two never tell different
   stories about it. */

/** Enough rounds for any job's quote PDFs; a stop for one that never finishes. */
const MAX_QUOTE_ROUNDS = 4;

type Detail = NonNullable<Awaited<ReturnType<typeof readMirrorJob>>["detail"]>;

/** "Work Order" as a sentence says it: "Work order". */
const kindWords = (status: string | null | undefined) => {
  const s = (status ?? "").trim().toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
};

export function QuoteScreen({
  job,
  detail,
  moneyVisible,
  financials,
  start = false,
}: {
  job: string;
  detail: Detail;
  moneyVisible: boolean;
  financials: boolean;
  /** from the job card's Create a quote (?start=1): straight into the reply box */
  start?: boolean;
}) {
  const [media, setMedia] = useState<JobMediaGroupsRead | null>(null);
  const [family, setFamily] = useState<FamilyMoney | null>(null);
  const [paper, setPaper] = useState<JobMediaItem | null>(null);
  /* the quote's state word, for the line under the name, once its lines are read */
  const [stage, setStage] = useState<QuoteStage | null>(null);

  /* the quote's PDFs, and the family's value where the job bills in claims */
  useEffect(() => {
    let live = true;
    void readJobFiles(job)
      .then(async (m) => {
        if (!live) return;
        setMedia(m);
        /* ServiceM8's quote PDFs with no bytes yet are brought across — those
           files by name, not the newest of the job's photos ahead of them */
        const missing = (m?.documents ?? []).filter((d) => d.origin === "Quote" && !d.url).map((d) => d.remoteId);
        /* a batch at a time, while each brings some across */
        for (let round = 0; missing.length > 0 && round < MAX_QUOTE_ROUNDS && live; round++) {
          const res = await cacheJobFiles(job, missing).catch(() => null);
          if (live && res?.media) setMedia(res.media);
          if (!res?.ok || res.cached === 0 || res.remaining === 0) break;
        }
      })
      .catch(() => undefined);
    if (moneyVisible) {
      void readJobRecord(job)
        .then((r) => live && setFamily(r?.family ?? null))
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
  }, [job, moneyVisible]);

  /* the paper viewer leaves Escape to whoever opened it; nothing behind it
     should hear the key that closed it */
  useEffect(() => {
    if (!paper) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setPaper(null);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [paper]);

  const { toasts, toast, dismiss } = useBoardToasts();

  const address = detail.address ?? detail.geoLine;
  /* the job's name, as its card names it */
  const name = detail.clientName?.trim() || proposalTitle(address);
  const facts = [kindWords(detail.status), detail.jobNumber ? `Job ${detail.jobNumber}` : "", (address ?? "").split(/\s*\n\s*/).filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(", ");
  const tabs: TabItem[] = sectionsFor(moneyVisible).map((key) => ({
    key,
    label: SECTION_LABEL[key],
    count: key === "photos" ? media?.photos.length : key === "documents" ? media?.documents.length : undefined,
    ...(key === "quote" ? {} : { href: jobPageHref(job, key) }),
  }));
  const sm8 = sm8QuoteOf({
    documents: media?.documents ?? null,
    sentOn: detail.quoteSentOn ?? null,
    moneyVisible,
    family,
    rowValueCents: moneyVisible ? (detail.money?.valueCents ?? null) : null,
  });
  /* on its lines: undefined while a quote on the old builder is switched,
     false when that failed */
  const [onLines, setOnLines] = useState<boolean | undefined>(undefined);
  const [tries, setTries] = useState(0);
  const [linesRev, setLinesRev] = useState(0);
  useEffect(() => {
    let live = true;
    const post = (body: Record<string, unknown>) =>
      fetch("/api/workboard/quote-lines", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(
        (r) => r.json() as Promise<{ ok: boolean }>
      );
    Promise.resolve()
      .then(() => fetch(`/api/workboard/quote-lines?job=${encodeURIComponent(job)}`))
      .then((r) => r.json() as Promise<{ ok: boolean; engine?: "old" | "lines" }>)
      .then((a) => (a?.ok && a.engine !== "lines" ? post({ job, op: "switch", engine: "lines" }) : a))
      .then((a) => live && setOnLines(!!a?.ok))
      .catch(() => live && setOnLines(false));
    return () => {
      live = false;
    };
  }, [job, tries]);

  /* the price, to the money grant only; read for each version of the quote */
  const price = useQuotePrice(job, financials, onLines ? `lines-${linesRev}` : null);

  return (
    <div className="page in full">
      <div className="wrap">
        <div className="stg hd-page wb2 wb2-qpage qp">
          <header className="qp-head">
            <h1 className="qp-name">
              <Fade>{name}</Fade>
            </h1>
            <p className="qp-line">
              <Dot hue={jobHue(detail.categoryColour, detail.status === "Unsuccessful")} />
              <Fade className="qp-facts">{facts ? `${facts}.` : ""}</Fade>
              {stage && <span className={stage.settle ? "qp-stage settle" : "qp-stage"}>{stage.word}</span>}
            </p>
            <SectionTabs
              items={tabs}
              current="quote"
              ariaLabel="The job"
            />
          </header>
          {onLines ? (
            <QuoteLinesFace
              job={job}
              meta={{ title: proposalTitle(address), client: detail.clientName ?? null, site: address ?? null, jobNumber: detail.jobNumber ?? null }}
              price={price}
              onStage={setStage}
              onPriced={() => setLinesRev((n) => n + 1)}
              onToast={(m) => toast(m)}
              send={<JobQuoteSend job={job} visible version={`lines-${linesRev}`} />}
              sendQuote={(onSent) => <JobQuoteSend job={job} visible as="quote" version={`lines-${linesRev}`} onSent={onSent} />}
              sm8={sm8}
              onOpenPaper={(item) => setPaper(item)}
              money={financials}
              start={start}
            />
          ) : onLines === false ? (
            <div className="qp-wait">
              <p className="wb2-sherr">The quote couldn&rsquo;t be opened.</p>
              <Button
                onClick={() => {
                  setOnLines(undefined);
                  setTries((n) => n + 1);
                }}
              >
                Try again
              </Button>
            </div>
          ) : (
            <div className="qp-wait">
              <Waiting note="Opening the quote" />
            </div>
          )}
        </div>
      </div>
      <ToastHost toasts={toasts} onDismiss={dismiss} />
      {/* portalled: the page's own stacking context would trap a fixed layer
          under the shell's side rail */}
      {paper &&
        createPortal(
          <JobMediaViewer items={[paper]} index={0} onNav={() => undefined} onClose={() => setPaper(null)} />,
          document.body
        )}
    </div>
  );
}
