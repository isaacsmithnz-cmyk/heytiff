"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { readJobFiles, readJobRecord, type readMirrorJob } from "@/app/actions/workboard";
import { cacheJobFiles } from "@/app/actions/workboard-media";
import { Icon } from "@/components/shell/icon";
import { ScreenBand, ScreenPanel } from "@/components/shell/screen-band";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { proposalTitle } from "@/lib/quotes/proposal";
import type { FamilyMoney } from "@/lib/workboard/job-family";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import type { JobMediaGroupsRead } from "@/lib/workboard/job-media-query";
import { Split } from "../board/inspector";
import { DocRow } from "../board/job-documents-face";
import { JobMediaViewer } from "../board/job-media-viewer";
import { JobQuoteFace } from "../board/job-quote-face";
import { JobQuoteLabour } from "../board/job-quote-labour";
import { JobQuotePrice } from "../board/job-quote-price";
import { JobQuoteSend } from "../board/job-quote-send";
import { ToastHost, useBoardToasts } from "../board/toasts";
import { sm8QuoteOf } from "./sm8-quote-of";

/* THE QUOTE PAGE — one job's quote, full screen inside the Workboard (Isaac,
   2026-10-05: "it should have opened up the proper quote screen not a
   section below").

   The builder on the left, open from the start: the box that drafts one
   (seeded with ServiceM8's quote when it holds one), then the questions, the
   proposal, its labour. Beside it, what the quote is read against and what
   it comes to: ServiceM8's own quote, the price of each option, and what
   goes to ServiceM8 once an option is accepted — each read afresh whenever
   the quote changes. The way back is the job card.

   It reads the job as the card does (the same actions; the page hands the
   job itself in, read on the server), so the two never tell different
   stories about it. */

/** Enough rounds for any job's quote PDFs; a stop for one that never finishes. */
const MAX_QUOTE_ROUNDS = 4;

type Detail = NonNullable<Awaited<ReturnType<typeof readMirrorJob>>["detail"]>;

export function QuoteScreen({
  job,
  detail,
  moneyVisible,
  financials,
}: {
  job: string;
  detail: Detail;
  moneyVisible: boolean;
  financials: boolean;
}) {
  const router = useRouter();
  const [media, setMedia] = useState<JobMediaGroupsRead | null>(null);
  const [family, setFamily] = useState<FamilyMoney | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [paper, setPaper] = useState<JobMediaItem | null>(null);

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

  /* back to the card, on its Quote face */
  const back = `/dashboard/workboard?job=${encodeURIComponent(job)}&face=quote`;
  const address = detail.address ?? detail.geoLine;
  const sm8 = sm8QuoteOf({
    documents: media?.documents ?? null,
    sentOn: detail.quoteSentOn ?? null,
    moneyVisible,
    family,
    rowValueCents: moneyVisible ? (detail.money?.valueCents ?? null) : null,
  });
  const sm8Quoted = sm8.papers.length > 0 || !!sm8.sentOn;
  /* the column beside the builder holds only what there is to read: no
     column at all on a job ServiceM8 never quoted, until there's a price */
  const priced = financials && !!version;

  const aside =
    sm8Quoted || priced ? (
      <aside className="wb2-insp" aria-label={financials ? "ServiceM8's quote and the price" : "ServiceM8's quote"}>
        <div className="wb2-inspb">
          {sm8Quoted && (
            <section className="wb2-jcsec" aria-label="Quote from ServiceM8">
              <div className="wb2-jcdhead">
                <b>Quote from ServiceM8</b>
                <em>{[sm8.sentOn ? `Sent ${fmtAuWeekdayDayMonth(sm8.sentOn)}` : "Not sent yet", sm8.value].filter(Boolean).join(", ")}</em>
              </div>
              {sm8.papers.map((p) => (
                <DocRow key={p.remoteId} item={p} onOpen={(item) => setPaper(item)} />
              ))}
            </section>
          )}
          {priced && (
            <>
              <JobQuotePrice job={job} visible version={version} />
              <JobQuoteSend job={job} visible version={version} />
            </>
          )}
        </div>
      </aside>
    ) : null;

  return (
    <div className="page in full">
      <div className="wrap">
        <div className="stg">
          <ScreenBand
            crumb={
              <Link href={back} className="int-back">
                <Icon name="chevL" size={14} />
                {detail.jobNumber ? `Job ${detail.jobNumber}` : "Job card"}
              </Link>
            }
            title={proposalTitle(address)}
          />
          <ScreenPanel pad={false}>
            <div className="wb2 wb2-qpage">
              <Split aside={aside}>
                <div className="wb2-panel pad">
                  <div className="wb2-jcface">
                    <JobQuoteFace
                      mode="page"
                      job={job}
                      address={address}
                      visible
                      onToast={(m) => toast(m)}
                      sm8={sm8}
                      onVersion={setVersion}
                      onCancel={() => router.push(back)}
                    >
                      <JobQuoteLabour job={job} visible />
                    </JobQuoteFace>
                  </div>
                </div>
              </Split>
            </div>
          </ScreenPanel>
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
