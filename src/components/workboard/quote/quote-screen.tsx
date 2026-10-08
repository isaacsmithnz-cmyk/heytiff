"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useState } from "react";
import { createPortal } from "react-dom";
import { readJobFiles, readJobRecord, type readMirrorJob } from "@/app/actions/workboard";
import { cacheJobFiles } from "@/app/actions/workboard-media";
import { Icon } from "@/components/shell/icon";
import { proposalTitle } from "@/lib/quotes/proposal";
import type { FamilyMoney } from "@/lib/workboard/job-family";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import type { JobMediaGroupsRead } from "@/lib/workboard/job-media-query";
import { JobMediaViewer } from "../board/job-media-viewer";
import { JobQuoteFace } from "../board/job-quote-face";
import { JobQuoteSend } from "../board/job-quote-send";
import { useQuotePrice } from "./quote-parts";
import { QuoteLinesFace } from "./quote-lines-face";
import { ToastHost, useBoardToasts } from "../board/toasts";
import { sm8QuoteOf } from "./sm8-quote-of";

/* THE QUOTE PAGE — one job's quote, full screen inside the Workboard (Isaac,
   2026-10-05: "it should have opened up the proper quote screen not a
   section below"), in Home's frame (2026-10-06, the mock-up he called "much
   cleaner"): the way back to the job card, the title with the quote's next
   step in its corner, then the builder (job-quote-face, page mode) — the
   progress line, Build-up and Proposal, and the list on the right with
   ServiceM8's own quote, the price of each option, and what goes to
   ServiceM8 once an option is accepted, each read afresh whenever the
   quote changes.

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
  /* the band's corner, where the builder puts the quote's next step */
  const [actionsEl, setActionsEl] = useState<HTMLDivElement | null>(null);

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
  /* which engine prices it: a quote switched to the rebuild is built by hand
     on its own kept lines (quote-lines-face.tsx). Every quote opens as it
     always has; one switched shows its lines once the switch is read. */
  const [engine, setEngine] = useState<"old" | "lines">("old");
  const [linesRev, setLinesRev] = useState(0);
  /* a quote Tiff's builder priced, brought across to its kept lines as it's
     priced today, to change by hand (lines-adopt.ts) */
  const adopt = async () => {
    const r = await fetch("/api/workboard/quote-lines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job, op: "adopt" }),
    }).catch(() => null);
    const a = r ? ((await r.json().catch(() => null)) as { ok: boolean; reason?: string } | null) : null;
    if (a?.ok) {
      setEngine("lines");
      setLinesRev((n) => n + 1);
    } else toast(a?.reason ?? "The lines couldn't be brought across. Try again.");
  };
  const switchTo = async (to: "old" | "lines") => {
    const r = await fetch("/api/workboard/quote-lines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job, op: "switch", engine: to }),
    }).catch(() => null);
    const a = r ? ((await r.json().catch(() => null)) as { ok: boolean } | null) : null;
    if (a?.ok) {
      setEngine(to);
      setLinesRev((n) => n + 1);
    } else toast("The quote couldn't be switched. Try again.");
  };

  /* Create a quote, from the job card: starts Tiff on the quote's lines
     when she's on for the business and nothing is drafted (slice 4.4) */
  const starting = useSearchParams()?.get("start") === "1";
  const startTiff = useEffectEvent(() => void switchTo("lines"));
  useEffect(() => {
    if (!financials) return;
    let live = true;
    fetch(`/api/workboard/quote-lines?job=${encodeURIComponent(job)}`)
      .then((r) => r.json() as Promise<{ ok: boolean; engine?: "old" | "lines"; tiff?: boolean; drafted?: boolean; lines?: unknown[] }>)
      .then((a) => {
        if (!live || !a.ok) return;
        if (a.engine === "lines") setEngine("lines");
        else if (starting && a.tiff && !a.drafted && (a.lines ?? []).length === 0) startTiff();
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [job, financials, starting]);

  /* the price, to the money grant only; read for each version of the quote */
  const price = useQuotePrice(job, financials, engine === "lines" ? `lines-${linesRev}` : version);

  return (
    <div className="page in full">
      <div className="wrap">
        <div className="stg hd-page wb2 wb2-qpage qp">
          <div className="wb2-crumbline">
            <Link href={back} className="int-back">
              <Icon name="chevL" size={14} />
              {detail.jobNumber ? `Job ${detail.jobNumber}` : "Job card"}
            </Link>
          </div>
          <div className="wb2-vtabs">
            <h1 className="wb2-h1">{proposalTitle(address)}</h1>
            {engine === "old" && price?.ok && price.options.some((o) => o.rows > 0) && (
              <div className="qp-acts">
                <button type="button" className="pbtn ghost" onClick={() => void adopt()}>
                  Edit the lines by hand
                </button>
              </div>
            )}
            <div className="qp-acts" ref={setActionsEl} />
          </div>
          {engine === "lines" ? (
            <QuoteLinesFace
              job={job}
              price={price}
              actionsEl={actionsEl}
              onPriced={() => setLinesRev((n) => n + 1)}
              onSwitchBack={() => void switchTo("old")}
              onToast={(m) => toast(m)}
              send={<JobQuoteSend job={job} visible version={`lines-${linesRev}`} />}
            />
          ) : (
            <JobQuoteFace
            mode="page"
            job={job}
            address={address}
            visible
            onToast={(m) => toast(m)}
            sm8={sm8}
            onOpenPaper={(item) => setPaper(item)}
            onVersion={setVersion}
            onCancel={() => router.push(back)}
            price={price}
            actionsEl={actionsEl}
            send={financials ? <JobQuoteSend job={job} visible version={version} /> : null}
            onByHand={financials ? () => void switchTo("lines") : undefined}
          />
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
