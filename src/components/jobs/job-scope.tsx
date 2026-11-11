"use client";

import { useState } from "react";
import { Button } from "@/components/parts/button";
import { StateWord } from "@/components/parts/state";
import { Tray } from "@/components/parts/tabs";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { pastQuote, quotedLine, sinceRows, versionFrom, type JobScopeRead, type ScopeSystem } from "@/lib/jobs/job-scope";
import type { SuppliedScope } from "@/lib/jobs/supplied-scope";
import { JobSection } from "./job-section";

/* THE SCOPE, AT THE TOP OF A JOB'S OVERVIEW (Isaac, 28 October 2026: "a
   common point where a quote can get built from"; layout B, the written
   brief, of https://claude.ai/artifact/SJBwjp8GmvKAFYuV6ufryT). It takes the
   Summary's place and colour, pink with a file: a line on what the job is
   and where its scope came from, a short paragraph per system with the
   sheets or notes it came from in grey after it, then Added, Not ours and
   the numbered questions still To clarify, each with who can answer it.

   LATEST UPDATES under it, purple: what came in lately and what it did to
   the scope, newest first, so nobody reads the whole feed to see what moved.
   While Tiff reads a new note the brief stays as it was and the top row says
   so. Only the newest change has Undo, and only while there's one to go back to.

   AFTER IT'S SENT (slice 4, Isaac, 4 November 2026, "yes" to the mock's
   page "After it's sent", DDfCy926GBnc6e7c7Fuqp5): Scope as quoted, with the
   day ServiceM8 sent it and which version, and under it SINCE THE QUOTE,
   orange, what's landed since and isn't in the price: each row with Leave
   out, and Update quote, which opens the quote's own Update quote with what's
   changing written in. While it waits it's out of Added. Taken into a
   version, it stays here in grey, "In version 2", without Leave out, until
   ServiceM8 sends that version; then it's in Added as "Version 2, from …".
   Taken into a variation, it's back in Added.

   Tiff keeps it (lib/workboard/job-scope-server.ts): written from
   everything on the job, rewritten when something new lands.

   TWO SCOPES (Isaac, 11 November 2026, on the builder's package mock
   https://claude.ai/artifact/6FP52g4ropVpfAqqzNLk2c: "supplied scope and
   quoted scope ... a toggle switcher ... side by side for comparisons").
   Once a job has been supplied with plans, a specification or the
   builder's emails, the card's head has a tray: Quoted, Supplied, Side by
   side. Quoted is the brief, each system that departs from what was
   supplied marked Differs in grey; Supplied is what they asked for, kept as
   read, with its fine print; Side by side lays the two out a row per area,
   across the page (the Overview moves the card above its columns). The
   Studio's column, 400 wide, has Quoted and Supplied only. */

export type ScopeView = "quoted" | "supplied" | "side";
const VIEWS: readonly { value: ScopeView; label: string }[] = [
  { value: "quoted", label: "Quoted" },
  { value: "supplied", label: "Supplied" },
  { value: "side", label: "Side by side" },
];

export function JobScope({
  scope,
  reading = false,
  onUndo,
  updateHref,
  onLeave,
  view: shown,
  onView,
  sideBySide = true,
  part = "all",
}: {
  scope: JobScopeRead;
  /** Which scope the card shows, when the job was supplied with something; the card keeps its own when not given. */
  view?: ScopeView;
  onView?: (view: ScopeView) => void;
  /** Side by side is offered (not in the Studio's 400-wide column). */
  sideBySide?: boolean;
  /** "scope" is the card alone, "rest" what follows it (Since the quote, Latest updates). */
  part?: "all" | "scope" | "rest";
  /** Tiff is reading something new on the job. */
  reading?: boolean;
  onUndo?: () => Promise<void>;
  /** The quote, opened on Update quote with what's changing written in. */
  updateHref?: string;
  /** Leave out: off Since the quote; it stays in the brief. */
  onLeave?: (text: string) => Promise<void>;
}) {
  const [undoing, setUndoing] = useState(false);
  const [own, setOwn] = useState<ScopeView>("quoted");
  const supplied = scope.supplied ?? null;
  const view: ScopeView = supplied ? (shown ?? own) : "quoted";
  const pick = (v: ScopeView) => (onView ? onView(v) : setOwn(v));
  const tray = supplied ? <Tray options={sideBySide ? VIEWS : VIEWS.slice(0, 2)} value={view === "side" && !sideBySide ? "quoted" : view} onChange={pick} ariaLabel="Which scope" /> : undefined;
  const quotedName = supplied ? "Quoted scope" : scope.quoted ? "Scope as quoted" : "Scope";
  const [leaving, setLeaving] = useState<string | null>(null);
  const rows = pastQuote(scope) ? sinceRows(scope) : { open: [], inVersion: [], sent: [] };
  const since = [...rows.open, ...rows.inVersion];
  const words = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
  const waiting = new Set(since.map((a) => words(a.text)));
  const sent = new Map(rows.sent.map((a) => [words(a.text), a]));
  /* the brief's own order: what's waiting is out, what went in a sent version says which */
  const added = scope.added.filter((a) => !waiting.has(words(a.text))).map((a) => {
    const went = sent.get(words(a.text));
    return went ? { ...a, from: versionFrom({ ...went, from: a.from || went.from }) } : a;
  });
  const leave = (text: string) => {
    if (!onLeave) return;
    setLeaving(text);
    void onLeave(text).finally(() => setLeaving(null));
  };
  const undo = () => {
    if (!onUndo) return;
    setUndoing(true);
    void onUndo().finally(() => setUndoing(false));
  };
  const suppliedLine = scope.suppliedAt ? `Read on ${fmtAuWeekdayDayMonth(scope.suppliedAt)}` : null;
  const card =
    supplied && view === "supplied" ? (
      <JobSection name="Supplied scope" line={suppliedLine} icon="file" hue="pink" className="jov-summary" action={tray}>
        <SuppliedBody supplied={supplied} differs={differsAreas(scope.systems)} />
      </JobSection>
    ) : supplied && view === "side" && sideBySide ? (
      <JobSection name="Scope" icon="file" hue="pink" className="jov-summary jsc-sidecard" action={tray}>
        <SideBySide scope={scope} supplied={supplied} quotedLine={scope.quoted ? quotedLine(scope.quoted) : null} suppliedLine={suppliedLine} />
      </JobSection>
    ) : (
      <JobSection name={quotedName} line={scope.quoted ? quotedLine(scope.quoted) : null} icon="file" hue="pink" className="jov-summary" action={tray}>
        <div className="jsc">
          {scope.lede && <p className="jsc-lede">{scope.lede}</p>}
          {scope.systems.map((s, i) => (
            <div className="jsc-part" key={`${s.area}-${i}`}>
              <h3 className={supplied && s.differs ? "jsc-h jsc-hrow" : "jsc-h"}>
                {[s.area, s.kind].filter(Boolean).join(": ")}
                {supplied && s.differs && <StateWord tone="info">Differs</StateWord>}
              </h3>
              <p className="jsc-p">
                {s.text}
                {s.from.length > 0 && <span className="jsc-from">{s.from.join(", ")}</span>}
              </p>
            </div>
          ))}
          {added.length > 0 && (
            <div className="jsc-part">
              <h3 className="jsc-h">Added</h3>
              <ul className="jsc-ul">
                {added.map((a, i) => (
                  <li key={i}>
                    {a.text}
                    {a.from && <span className="jsc-from">{a.from}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {scope.notOurs.length > 0 && (
            <div className="jsc-part">
              <h3 className="jsc-h">Not ours</h3>
              <p className="jsc-p">{scope.notOurs.join("; ")}</p>
            </div>
          )}
          {scope.clarify.length > 0 && (
            <div className="jsc-part">
              <h3 className="jsc-h">To clarify</h3>
              <ol className="jsc-ol">
                {scope.clarify.map((c, i) => (
                  <li key={i}>
                    <span className="jsc-n">{i + 1}</span>
                    <span>{c.q}</span>
                    <span className="jsc-who">{c.who}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </JobSection>
    );
  return (
    <>
      {part !== "rest" && card}
      {part !== "scope" && since.length > 0 && (
        <JobSection
          name="Since the quote"
          icon="plus"
          hue="orange"
          action={
            updateHref && rows.open.length > 0 ? (
              <Button kind="quote" size={32} href={updateHref}>
                Update quote
              </Button>
            ) : undefined
          }
        >
          <ul className="jsc-since">
            {since.map((a) => (
              <li key={a.text}>
                <span>
                  <b>{a.text}</b>
                  {a.from && <span className="jsc-said">{a.from}</span>}
                </span>
                {a.version ? (
                  <StateWord tone="info">
                    In version {a.version}
                  </StateWord>
                ) : (
                  onLeave && (
                    <Button kind="quiet" size={32} disabled={leaving != null} onClick={() => leave(a.text)}>
                      Leave out
                    </Button>
                  )
                )}
              </li>
            ))}
          </ul>
        </JobSection>
      )}
      {part !== "scope" && (scope.updates.length > 0 || reading) && (
        <JobSection name="Latest updates" icon="clock" hue="purple">
          <ul className="jsc-ups">
            {reading && (
              <li>
                <span className="jsc-on">Now</span>
                <span className="jov-none">Reading the new note</span>
              </li>
            )}
            {scope.updates.map((u, i) => {
              const offerUndo = i === 0 && scope.canUndo && !reading && !!onUndo;
              return (
                <li key={i} className={offerUndo ? "jsc-up-act" : undefined}>
                  <span className="jsc-on">{u.on}</span>
                  <span>
                    <b>{u.from}</b>
                    <span className="jsc-said">{u.said}</span>
                  </span>
                  {offerUndo && (
                    <button type="button" className="pt-btn pt-btn--quiet pt-btn--32" disabled={undoing} onClick={undo}>
                      Undo
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </JobSection>
      )}
    </>
  );
}

/** The areas whose quoted system departs from what was supplied. */
const differsAreas = (systems: readonly ScopeSystem[]): Set<string> => new Set(systems.filter((s) => s.differs).map((s) => areaKey(s.area)));
const areaKey = (a: string) => a.trim().toLowerCase();

/** What the job was supplied with, as read: its systems, its fine print,
    what it keeps for others and what it leaves open. */
function SuppliedBody({ supplied, differs }: { supplied: SuppliedScope; differs: ReadonlySet<string> }) {
  return (
    <div className="jsc">
      {supplied.lede && <p className="jsc-lede">{supplied.lede}</p>}
      {supplied.systems.map((s, i) => {
        const off = differs.has(areaKey(s.area));
        return (
          <div className="jsc-part" key={`${s.area}-${i}`}>
            <h3 className={off ? "jsc-h jsc-hrow" : "jsc-h"}>
              {[s.area, s.kind].filter(Boolean).join(": ")}
              {off && <StateWord tone="info">Differs</StateWord>}
            </h3>
            <p className="jsc-p">
              {s.text}
              {s.from.length > 0 && <span className="jsc-from">{s.from.join(", ")}</span>}
            </p>
          </div>
        );
      })}
      {supplied.fine.length > 0 && (
        <div className="jsc-part">
          <h3 className="jsc-h">Fine print</h3>
          <ul className="jsc-ul">
            {supplied.fine.map((f, i) => (
              <li key={i}>
                {f.text}
                {f.from && <span className="jsc-from">{f.from}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {supplied.notOurs.length > 0 && (
        <div className="jsc-part">
          <h3 className="jsc-h">Not ours</h3>
          <p className="jsc-p">{supplied.notOurs.join("; ")}</p>
        </div>
      )}
      {supplied.clarify.length > 0 && (
        <div className="jsc-part">
          <h3 className="jsc-h">To clarify</h3>
          <ol className="jsc-ol">
            {supplied.clarify.map((c, i) => (
              <li key={i}>
                <span className="jsc-n">{i + 1}</span>
                <span>{c.q}</span>
                <span className="jsc-who">{c.who}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/** The two scopes a row per area, the quoted on the left: each area as
    either names it, in the order they come, and the fine print last. */
function SideBySide({ scope, supplied, quotedLine, suppliedLine }: { scope: JobScopeRead; supplied: SuppliedScope; quotedLine: string | null; suppliedLine: string | null }) {
  const areas: string[] = [];
  for (const a of [...scope.systems.map((s) => s.area), ...supplied.systems.map((s) => s.area)]) if (!areas.some((x) => areaKey(x) === areaKey(a))) areas.push(a);
  const said = (s: { kind: string; text: string; from: string[] } | undefined) =>
    s ? (
      <>
        <h3 className="jsc-h">{s.kind}</h3>
        <p className="jsc-p">
          {s.text}
          {s.from.length > 0 && <span className="jsc-from">{s.from.join(", ")}</span>}
        </p>
      </>
    ) : (
      <p className="jsc-p jsc-none">Not in this scope</p>
    );
  return (
    <div className="jsc-side">
      <div className="jsc-siderow jsc-sidetop">
        <span />
        <span className="jsc-sidecell">
          <b className="jsc-sidename">Quoted scope</b>
          {quotedLine && <span className="jsc-from">{quotedLine}</span>}
        </span>
        <span className="jsc-sidecell">
          <b className="jsc-sidename">Supplied scope</b>
          {suppliedLine && <span className="jsc-from">{suppliedLine}</span>}
        </span>
      </div>
      {areas.map((a) => {
        const q = scope.systems.find((s) => areaKey(s.area) === areaKey(a));
        const s = supplied.systems.find((x) => areaKey(x.area) === areaKey(a));
        return (
          <div className="jsc-siderow" key={a}>
            <span className="jsc-sidelab">
              {a}
              {q?.differs && <StateWord tone="info">Differs</StateWord>}
            </span>
            <span className="jsc-sidecell">{said(q)}</span>
            <span className="jsc-sidecell">{said(s)}</span>
          </div>
        );
      })}
      {supplied.fine.length > 0 && (
        <div className="jsc-siderow">
          <span className="jsc-sidelab">Fine print</span>
          <span className="jsc-sidecell">
            <p className="jsc-p jsc-none">Held to the supplied fine print</p>
          </span>
          <span className="jsc-sidecell">
            <ul className="jsc-ul">
              {supplied.fine.map((f, i) => (
                <li key={i}>
                  {f.text}
                  {f.from && <span className="jsc-from">{f.from}</span>}
                </li>
              ))}
            </ul>
          </span>
        </div>
      )}
    </div>
  );
}
