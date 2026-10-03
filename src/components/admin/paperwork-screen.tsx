"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import { ViewTabs } from "@/components/shell/view-tabs";
import { TemplateSteps } from "@/components/swms/template-steps";
import { ApproveTemplate } from "@/components/swms/approve-template";
import { ApproveWording } from "@/components/certs/approve-wording";
import { addFanModel, removeFanModel, updateFanModel } from "@/app/actions/certificates";
import { CLAUSE_NAME, SHOWN, WORDING_GROUPS, shownParts, type ClauseKey } from "@/lib/certs/mechanical";
import type { FanModel } from "@/lib/certs/query";
import { PAPERWORK_TABS, paperworkTabFromParam, type PaperworkTabKey } from "./paperwork-tabs";
import "@/components/swms/swms.css";
import "./paperwork.css";

/* PAPERWORK — what the business's own documents are written from, in one
   place, laid out as the Organisation card is: an overview that says what
   needs doing, then a tab for each thing.

   It replaces two pages that each sat at their own address with a back link
   to Home: the SWMS template and the certificate wording. Both are read by
   anyone and approved by the owner; what changed since the last approval is
   marked, so a new version is read in seconds rather than from the top. The
   fan list lives here too: the rated airflow every certificate prints, which
   until now could only be added from inside a certificate. */

export type PaperApproval = { by: string; on: string } | null;

export type PaperworkProps = {
  initialSec?: string;
  isOwner: boolean;
  ownerName: string | null;
  canEditFans: boolean;
  swms: PaperApproval;
  wording: {
    approved: PaperApproval;
    /** Statements changed since the last approval, when this version isn't
        approved yet and that approval kept its wording. */
    changed: { clause: ClauseKey; isNew: boolean }[] | null;
    /** When the last approval was, for "since you approved it on …". */
    lastApprovedOn: string | null;
    earlier: { by: string; on: string }[];
  };
  fans: FanModel[];
};

/* plain functions, outside the components: React Compiler 1.0 can't lower a
   computed key */
const withValue = (d: Record<string, string>, id: string, v: string) => ({ ...d, [id]: v });
const without = (d: Record<string, string>, id: string) => {
  const next = { ...d };
  delete next[id];
  return next;
};

const waiting = (owner: string | null) => `Waiting for ${owner ?? "the owner"} to approve it`;

/** One shown line: the words, what is typed in brackets, and what depends on
    the job in the quiet colour. */
function Line({ line }: { line: string }) {
  return (
    <p className="sw-text">
      {shownParts(line).map((p, i) =>
        p.kind === "text" ? (
          <span key={i}>{p.text}</span>
        ) : p.kind === "typed" ? (
          <span key={i} className="pw-typed">{`[${p.text}]`}</span>
        ) : (
          <span key={i} className="pw-choice">
            {p.options.filter(Boolean).join(" / ")}
          </span>
        )
      )}
    </p>
  );
}

function Wording({ wording, isOwner, ownerName }: { wording: PaperworkProps["wording"]; isOwner: boolean; ownerName: string | null }) {
  const changed = new Map((wording.changed ?? []).map((c) => [c.clause, c.isNew]));
  const [onlyChanged, setOnlyChanged] = useState(changed.size > 0);
  const shows = (k: ClauseKey) => !onlyChanged || changed.has(k);
  const lede = wording.approved
    ? `Approved by ${wording.approved.by} on ${wording.approved.on}. Every certificate is written from these statements.`
    : !isOwner
      ? `${waiting(ownerName)}. No certificate can be issued until then.`
      : changed.size > 0 && wording.lastApprovedOn
        ? `${changed.size} ${changed.size === 1 ? "statement has" : "statements have"} changed since you approved the wording on ${wording.lastApprovedOn}. Read them, then approve.`
        : "Read the statements, then approve them. No certificate can be issued until you do.";
  return (
    <div className="sws">
      <p className="sws-lede">{lede}</p>
      {changed.size > 0 && !wording.approved && (
        <label className="pw-only">
          <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
          Show only what changed
        </label>
      )}
      {WORDING_GROUPS.map((g) => {
        const items = g.clauses.filter((c) => shows(c.clause));
        if (items.length === 0) return null;
        return (
          <div key={g.title} className="sws-grp">
            <div className="sw-gh">
              <b>{g.title}</b>
            </div>
            {items.map((c) => (
              <div key={c.clause} className="pw-st" aria-label={CLAUSE_NAME[c.clause]}>
                {(c.note || changed.has(c.clause)) && (
                  <span className="pw-when">
                    {changed.has(c.clause) && <span className="sw-state warn">{changed.get(c.clause) ? "New" : "Changed"}</span>}
                    {c.note}
                  </span>
                )}
                {SHOWN[c.clause].map((line) => (
                  <Line key={line} line={line} />
                ))}
              </div>
            ))}
          </div>
        );
      })}
      {!wording.approved && isOwner && (
        <div className="sws-actions">
          <ApproveWording />
        </div>
      )}
      {wording.earlier.length > 0 && (
        <p className="sw-note">{`Approved before: ${wording.earlier.map((e) => `${e.on} by ${e.by}`).join("; ")}.`}</p>
      )}
    </div>
  );
}

function Fans({ initial, canEdit }: { initial: FanModel[]; canEdit: boolean }) {
  const [fans, setFans] = useState(initial);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [model, setModel] = useState("");
  const [lps, setLps] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const fail = (error: string) => ({ ok: false as const, error });

  const save = async (f: FanModel) => {
    const res = await updateFanModel(f.id, Number(draft[f.id])).catch(() => fail("Couldn't save that fan."));
    if (!res.ok) return setNote(res.error);
    setFans((cur) => cur.map((x) => (x.id === f.id ? res.fan : x)));
    setDraft((d) => without(d, f.id));
    setNote(null);
  };
  const remove = async (f: FanModel) => {
    const res = await removeFanModel(f.id).catch(() => fail("Couldn't remove that fan."));
    if (!res.ok) return setNote(res.error);
    setFans((cur) => cur.filter((x) => x.id !== f.id));
    setNote(null);
  };
  const add = async () => {
    const res = await addFanModel(model, Number(lps)).catch(() => fail("Couldn't save that fan."));
    if (!res.ok) return setNote(res.error);
    setFans((cur) => [...cur.filter((x) => x.id !== res.fan.id), res.fan].sort((a, b) => a.model.localeCompare(b.model)));
    setModel("");
    setLps("");
    setNote(null);
  };

  return (
    <div className="sws">
      <p className="sws-lede">
        {fans.length === 0
          ? "No fans yet. A fan added here, or saved from a certificate, brings its rated airflow to every certificate after."
          : "The rated airflow from each fan's spec sheet. A certificate already issued keeps the figure it printed."}
      </p>
      {fans.length > 0 && (
        <div className="sws-people">
          {fans.map((f) => {
            const typed = draft[f.id];
            return (
              <div key={f.id} className="sws-person">
                <span>
                  <b>{f.model}</b>
                  {!canEdit && <em>{`${f.ratedLps} L/s rated`}</em>}
                </span>
                {canEdit && (
                  <span className="pw-fan">
                    <label>
                      <span>L/s</span>
                      <input
                        className="wb2-fi"
                        inputMode="decimal"
                        aria-label={`${f.model} rated L/s`}
                        value={typed ?? String(f.ratedLps)}
                        onChange={(e) => setDraft((d) => withValue(d, f.id, e.target.value))}
                      />
                    </label>
                    {typed !== undefined && typed !== String(f.ratedLps) && (
                      <button type="button" className="pbtn sm" onClick={() => void save(f)}>
                        Save
                      </button>
                    )}
                    <button type="button" className="pbtn ghost sm" onClick={() => void remove(f)}>
                      {`Remove ${f.model}`}
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {canEdit && (
        <div className="pw-add">
          <label>
            <span>Model</span>
            <input className="wb2-fi" value={model} onChange={(e) => setModel(e.target.value)} />
          </label>
          <label>
            <span>Rated L/s</span>
            <input className="wb2-fi" inputMode="decimal" value={lps} onChange={(e) => setLps(e.target.value)} />
          </label>
          <button type="button" className="pbtn ghost sm" disabled={!model.trim() || !lps.trim()} onClick={() => void add()}>
            Add the fan
          </button>
        </div>
      )}
      {note && <p className="sw-state bad">{note}</p>}
    </div>
  );
}

export function PaperworkScreen({ initialSec, isOwner, ownerName, canEditFans, swms, wording, fans }: PaperworkProps) {
  const [tab, setTab] = useState<PaperworkTabKey>(() => paperworkTabFromParam(initialSec) ?? "overview");

  const go = (key: PaperworkTabKey) => {
    setTab(key);
    /* which tab you're on, not a navigation: the server render stays put */
    const url = new URL(window.location.href);
    url.searchParams.set("sec", key);
    window.history.replaceState(null, "", url.toString());
    document.querySelector(".outlet")?.scrollTo({ top: 0 });
  };

  const wordingStatus = wording.approved
    ? `Approved by ${wording.approved.by} on ${wording.approved.on}`
    : wording.changed && wording.changed.length > 0
      ? `${wording.changed.length} changed since ${wording.lastApprovedOn ?? "the last approval"}. ${isOwner ? "Waiting for your approval" : waiting(ownerName)}`
      : isOwner
        ? "Waiting for your approval"
        : waiting(ownerName);
  const rows: { key: PaperworkTabKey; title: string; status: string; due: boolean }[] = [
    {
      key: "swms",
      title: "SWMS template",
      status: swms ? `Approved by ${swms.by} on ${swms.on}` : isOwner ? "Waiting for your approval" : waiting(ownerName),
      due: !swms,
    },
    { key: "wording", title: "Certificate wording", status: wordingStatus, due: !wording.approved },
    { key: "fans", title: "Fan list", status: fans.length === 1 ? "1 fan" : `${fans.length} fans`, due: false },
  ];

  return (
    <div className="page in full">
      <div className="wrap">
        <div className="stg">
          <div className="orgcard2">
            <div className="wb2-crumbline">
              <Link href="/dashboard/admin" className="int-back">
                <Icon name="chevL" size={15} />
                Admin
              </Link>
            </div>
            <ViewTabs
              lead={<h1 className="wb2-h1">Paperwork</h1>}
              ariaLabel="Paperwork sections"
              idPrefix="pwtab"
              panelPrefix="pwsec"
              active={tab}
              onGo={(k) => go(k as PaperworkTabKey)}
              items={PAPERWORK_TABS.map((t) => ({ key: t.key, label: t.label }))}
            />
            <div className="wb2-card">
              <div className="wb2-panel">
                <div className="ppanel2">
                  <section id={`pwsec-${tab}`} role="tabpanel" aria-labelledby={`pwtab-${tab}`} tabIndex={-1} className="psec2" data-sec={tab}>
                    {tab === "overview" && (
                      <div className="sws">
                        <div className="sws-people">
                          {rows.map((r) => (
                            <div key={r.key} className="sws-person">
                              <span>
                                <b>{r.title}</b>
                                <em className={r.due ? "sw-state warn" : undefined}>{r.status}</em>
                              </span>
                              <button type="button" className="pbtn ghost sm" onClick={() => go(r.key)}>
                                {`Open ${r.title.toLowerCase()}`}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {tab === "swms" && (
                      <div className="sws">
                        <p className="sws-lede">
                          {swms
                            ? `Approved by ${swms.by} on ${swms.on}. Every SWMS is written from these steps.`
                            : isOwner
                              ? "Read the steps and controls, then approve them at the end. No SWMS can be issued until you do."
                              : `${waiting(ownerName)}. No SWMS can be issued until then.`}
                        </p>
                        <div className="sws-grp">
                          <TemplateSteps />
                        </div>
                        {!swms && isOwner && (
                          <div className="sws-actions">
                            <ApproveTemplate />
                          </div>
                        )}
                      </div>
                    )}
                    {tab === "wording" && <Wording wording={wording} isOwner={isOwner} ownerName={ownerName} />}
                    {tab === "fans" && <Fans initial={fans} canEdit={canEditFans} />}
                  </section>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
