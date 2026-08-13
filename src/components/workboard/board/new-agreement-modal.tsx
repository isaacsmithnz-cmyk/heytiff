"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { NoteToken } from "@/components/notes/note-token";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { isWeekendISO, rollToBusinessDay } from "@/lib/workboard/board-status";
import { searchJobs } from "@/app/actions/workboard";
import { analyseSm8JobForAgreement, type AgreementProposal } from "@/app/actions/workboard-ai";
import { addPackingItem, createAgreement, createCategory } from "@/app/actions/workboard-maintenance";
import type { JobSearchHit } from "@/lib/workboard/projects-query";
import type { BoardAgreement, BoardCategory } from "@/lib/workboard/board-query";
import { crewLabel } from "./derive";
import { DateField } from "@/components/ui/date-field";

/* New agreement (D7): read a ServiceM8 job, or type it yourself.

   The philosophy holds throughout: the mirror is read-only, Tiff only ever
   PROPOSES, and this form is the review — nothing writes until Create. The
   duplicate guard fires on the client's name before anything is made
   (importing Halston Freight twice created two identical agreements
   silently in the prototype — never again). Standalone-first: with no
   ServiceM8 connection the source toggle doesn't even render (the board is
   not allowed to look broken without an integration).

   K3: no fabricated history — a brand-new agreement's story starts at its
   first due date. K4: a weekend anchor is said out loud, with the rolled
   Monday one press away; keeping the weekend stays allowed (B9). */

const INTERVALS: [number, string][] = [
  [1, "Monthly"],
  [2, "Every 2 months"],
  [3, "Quarterly"],
  [4, "Every 4 months"],
  [6, "6-monthly"],
  [12, "Annual"],
  [24, "Every 2 years"],
];

export function NewAgreementModal({
  connected,
  voiceless,
  agreements,
  categories,
  initialJob,
  onOpenAgreement,
  onToast,
  onClose,
}: {
  connected: boolean;
  /** ANTHROPIC key absent — the Analyse button hides, prefill stays direct. */
  voiceless: boolean;
  agreements: BoardAgreement[];
  categories: BoardCategory[];
  /* Opened FROM a job (the All jobs side): the ServiceM8 leg is pre-answered
     rather than searched for. Everything downstream — the prefill, the
     duplicate guard, Tiff's analyse offer — is the same code the search leg
     runs; only the picking is skipped. */
  initialJob?: JobSearchHit | null;
  onOpenAgreement: (agreementId: string) => void;
  onToast: (message: string, undo?: () => void | Promise<void>) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [source, setSource] = useState<"manual" | "sm8">("manual");
  const closeRef = useRef<HTMLButtonElement>(null);

  // sm8 leg
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<JobSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<JobSearchHit | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [analysed, setAnalysed] = useState<string | null>(null);

  // the form — one review surface for both legs
  const [label, setLabel] = useState("");
  const [clientName, setClientName] = useState("");
  const [siteLabel, setSiteLabel] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [interval, setInterval_] = useState(3);
  const [anchor, setAnchor] = useState("");
  const [hoursText, setHoursText] = useState("");
  const [techsNeeded, setTechsNeeded] = useState(1);
  const [billingContact, setBillingContact] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [newCategoryText, setNewCategoryText] = useState("");
  const [accessNotes, setAccessNotes] = useState("");
  const [bringItems, setBringItems] = useState<string[]>([]);
  const [weInstalled, setWeInstalled] = useState(false);
  const [createAnyway, setCreateAnyway] = useState(false);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const pickedInitial = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** The duplicate guard: same client already holding agreements. Case falls
      away; the person decides — open one of theirs, or create deliberately. */
  const duplicates = useMemo(() => {
    const name = clientName.trim().toLowerCase();
    if (!name) return [];
    return agreements.filter((a) => a.clientName.trim().toLowerCase() === name);
  }, [agreements, clientName]);

  const search = (text: string) => {
    setQ(text);
    setPicked(null);
    if (text.trim().length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    start(async () => {
      const found = await searchJobs(text);
      setHits(found);
      setSearching(false);
    });
  };

  const pick = (hit: JobSearchHit) => {
    setPicked(hit);
    setHits([]);
    setQ(hit.jobNumber ? `#${hit.jobNumber}` : hit.clientName ?? "");
    if (hit.clientName) setClientName(hit.clientName);
    if (hit.suburb) setSiteLabel(hit.suburb);
    setAnalysed(null);
  };

  /* Arriving FROM a job (the All jobs side): run the picker's own `pick`
     once, so the prefill is identical whether the job was searched for or
     handed over. An effect rather than initial state, deliberately — `pick`
     is where the client-name and site rules live, and copying them into a
     useState initialiser is exactly how the two legs would drift apart. */
  useEffect(() => {
    if (!initialJob || pickedInitial.current) return;
    pickedInitial.current = true;
    setSource("sm8");
    pick(initialJob);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJob?.remoteId]);

  const applyProposal = (p: AgreementProposal) => {
    if (p.label) setLabel(p.label);
    if (p.intervalMonths) setInterval_(p.intervalMonths);
    if (p.hoursEstimate) setHoursText(String(p.hoursEstimate));
    if (p.techsNeeded) setTechsNeeded(p.techsNeeded);
    if (p.accessNotes) setAccessNotes(p.accessNotes);
    setBringItems(p.bringItems);
  };

  const analyse = () => {
    if (!picked) return;
    setAnalysing(true);
    setErr(null);
    start(async () => {
      const res = await analyseSm8JobForAgreement(picked.remoteId);
      setAnalysing(false);
      if (!res.ok) {
        setAnalysed(null);
        setErr(res.reason === "no-key" ? "Tiff is offline — fill the rest in yourself." : res.reason);
        return;
      }
      applyProposal(res.proposal);
      setAnalysed("Tiff read the job — every field below is editable before anything is created.");
    });
  };

  const create = () => {
    setErr(null);
    start(async () => {
      let catId: string | null = categoryId || null;
      if (newCategoryText.trim()) {
        const made = await createCategory(newCategoryText.trim());
        if (!made.ok || !made.id) {
          setErr(made.ok ? "Couldn't create the category." : made.error);
          return;
        }
        catId = made.id;
      }
      const res = await createAgreement({
        label,
        clientName,
        siteLabel: siteLabel || undefined,
        siteAddress: siteAddress || undefined,
        intervalMonths: interval,
        anchorDate: anchor,
        accessNotes: accessNotes || undefined,
        billingContact: billingContact || undefined,
        techsNeeded,
        hoursEstimate: hoursText.trim() === "" ? undefined : Number(hoursText),
        categoryId: catId,
        weInstalled,
        clientRemoteId: picked?.companyId ?? undefined,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      // the packing list rides the proposal (D5) — items land on the fresh agreement
      if (res.id) {
        for (const item of bringItems) {
          await addPackingItem(res.id, item);
        }
      }
      onToast(`Agreement created — ${clientName}`);
      router.refresh();
      onClose();
    });
  };

  const weekendAnchor = anchor && isWeekendISO(anchor);
  const canCreate = label.trim() && clientName.trim() && anchor && (!duplicates.length || createAnyway);

  return createPortal(
    <>
      <div className="wb2-scrim" onClick={onClose} />
      <div className="wb2-daymodal wb2-newmodal" role="dialog" aria-modal="true" aria-label="New service agreement">
        <div className="wb2-dmhd">
          <div className="wb2-dmtop">
            <span className="wb2-sect">New service agreement</span>
            <button ref={closeRef} className="wb2-ico" onClick={onClose} title="Close" aria-label="Close">
              <Icon name="x" size={14} />
            </button>
          </div>
          <h2>Set up the standing work</h2>
          {connected && (
            <div className="wb2-dmchips" role="tablist" aria-label="Where from">
              <button
                role="tab"
                aria-selected={source === "manual"}
                className={"wb2-filter" + (source === "manual" ? " on" : "")}
                onClick={() => setSource("manual")}
              >
                Enter it myself
              </button>
              <button
                role="tab"
                aria-selected={source === "sm8"}
                className={"wb2-filter" + (source === "sm8" ? " on" : "")}
                onClick={() => setSource("sm8")}
              >
                From a ServiceM8 job
              </button>
            </div>
          )}
        </div>

        <div className="wb2-dmbody">
          {err && <p className="wb2-sherr" style={{ margin: 0 }}>{err}</p>}

          {connected && source === "sm8" && (
            <div className="wb2-dmgrp" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
              <span className="wb2-sect">Find the job it grew out of</span>
              <input
                className="wb2-fi"
                placeholder="Job number or client name…"
                value={q}
                onChange={(e) => search(e.target.value)}
              />
              {searching && <p className="wb2-hint">Searching the mirror…</p>}
              {hits.map((h) => (
                <button key={h.remoteId} className="wb2-lpr as-btn" onClick={() => pick(h)}>
                  <span className={"wb2-chip" + (h.status === "Completed" ? " ok" : "")}>
                    {h.status ?? "Job"}
                  </span>
                  <div className="wb2-trt">
                    <b>{h.clientName ?? "Unnamed client"}</b>
                    <em>
                      {h.jobNumber ? `#${h.jobNumber}` : "no number"}
                      {h.suburb ? ` · ${h.suburb}` : ""}
                    </em>
                  </div>
                  <span className="wb2-chip">Use this job</span>
                </button>
              ))}
              {picked && (
                <div className="wb2-corow">
                  <span className="wb2-chip ok">
                    Reading {picked.jobNumber ? `#${picked.jobNumber}` : picked.clientName}
                  </span>
                  {!voiceless && (
                    <button className="pbtn ghost" disabled={busy || analysing} onClick={analyse}>
                      {analysing ? "Reading the job…" : "Let Tiff read the job"}
                    </button>
                  )}
                </div>
              )}
              {analysed && <p className="wb2-hint">{analysed}</p>}
            </div>
          )}

          <div className="wb2-formgrid">
            <label className="wb2-fl">
              Service label
              <input className="wb2-fi" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Rooftop package units" />
            </label>
            <label className="wb2-fl">
              Client
              <input className="wb2-fi" value={clientName} onChange={(e) => { setClientName(e.target.value); setCreateAnyway(false); }} />
            </label>
            <label className="wb2-fl">
              Site label
              <input className="wb2-fi" value={siteLabel} onChange={(e) => setSiteLabel(e.target.value)} />
            </label>
            <label className="wb2-fl">
              Site address
              <input className="wb2-fi" value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} />
            </label>
            <label className="wb2-fl">
              How often
              <select className="wb2-sel" value={interval} onChange={(e) => setInterval_(Number(e.target.value))}>
                {INTERVALS.map(([n, word]) => (
                  <option key={n} value={n}>
                    {word}
                  </option>
                ))}
              </select>
            </label>
            <label className="wb2-fl">
              First service due
              <DateField className="wb2-fi" aria-label="Agreement anchor date" value={anchor || null} onChange={(iso) => setAnchor(iso ?? "")} />
            </label>
            {/* The two estimates the job card shows by these names — how long
                one visit takes and how many people it takes. They're written
                here, once, and every visit of the agreement inherits them. */}
            <label className="wb2-fl">
              Estimated service time
              <input type="number" min={0.5} max={24} step={0.5} className="wb2-fi" value={hoursText} onChange={(e) => setHoursText(e.target.value)} placeholder="hours on site" />
            </label>
            <label className="wb2-fl">
              Estimated crew size
              <select className="wb2-sel" value={techsNeeded} onChange={(e) => setTechsNeeded(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {crewLabel(n)}
                  </option>
                ))}
              </select>
            </label>
            <label className="wb2-fl">
              Billing contact
              <input className="wb2-fi" value={billingContact} onChange={(e) => setBillingContact(e.target.value)} />
            </label>
            <label className="wb2-fl">
              Category
              <select className="wb2-sel" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Uncategorised</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="wb2-fl">
              …or a new category
              <input className="wb2-fi" value={newCategoryText} onChange={(e) => setNewCategoryText(e.target.value)} placeholder="created with the agreement" />
            </label>
            <label className="wb2-flcheck">
              <input type="checkbox" checked={weInstalled} onChange={(e) => setWeInstalled(e.target.checked)} />
              We installed this system
            </label>
            <label className="wb2-fl wide">
              Access notes
              <NoteToken as="field" label="access notes" value={accessNotes} onChange={setAccessNotes} rows={2} />
            </label>
          </div>

          {bringItems.length > 0 && (
            <div className="wb2-dmgrp">
              <span className="wb2-sect">Packing list to create with it</span>
              <div className="wb2-tags">
                {bringItems.map((item) => (
                  <span className="wb2-tag on t-slate" key={item}>
                    {item}
                    <button
                      title="Drop it"
                      aria-label={`Drop ${item}`}
                      onClick={() => setBringItems(bringItems.filter((x) => x !== item))}
                    >
                      <Icon name="x" size={10} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {weekendAnchor && (
            <div className="wb2-sherr" style={{ margin: 0, background: "rgba(255,138,0,.08)", borderColor: "rgba(255,138,0,.3)", color: "#7c3d00" }}>
              {`${fmtAuWeekdayDayMonth(anchor)} is a ${new Date(`${anchor}T12:00:00Z`).getUTCDay() === 6 ? "Saturday" : "Sunday"} — every visit will fall due on a weekend. `}
              <button
                className="pbtn ghost"
                style={{ marginLeft: 8 }}
                onClick={() => setAnchor(rollToBusinessDay(anchor))}
              >
                Anchor on {fmtAuWeekdayDayMonth(rollToBusinessDay(anchor))} instead
              </button>
            </div>
          )}

          {duplicates.length > 0 && (
            <div className="wb2-dmgrp">
              <span className="wb2-sect">
                {clientName.trim()} already has {duplicates.length === 1 ? "an agreement" : "agreements"} here
              </span>
              {duplicates.map((d) => (
                <div className="wb2-lpr" key={d.id}>
                  <span className="wb2-chip">{d.status === "paused" ? "Paused" : "Active"}</span>
                  <div className="wb2-trt">
                    <b>{d.label}</b>
                    <em>{d.siteLabel ?? "no site label"}</em>
                  </div>
                  <button
                    className="pbtn ghost"
                    onClick={() => {
                      onClose();
                      onOpenAgreement(d.id);
                    }}
                  >
                    Open it instead
                  </button>
                </div>
              ))}
              <label className="wb2-flcheck">
                <input type="checkbox" checked={createAnyway} onChange={(e) => setCreateAnyway(e.target.checked)} />
                This is genuinely a separate agreement — create it anyway
              </label>
            </div>
          )}
        </div>

        <div className="wb2-dmft">
          <button className="pbtn" disabled={busy || !canCreate} onClick={create}>
            <Icon name="plus" size={15} />
            Create the agreement
          </button>
          <span className="wb2-hint" style={{ margin: 0, marginLeft: "auto" }}>
            Visits generate the moment it exists — no last-done is ever invented.
          </span>
        </div>
      </div>
    </>,
    document.body
  );
}
