"use client";

import { useState } from "react";
import type { JobScopeRead } from "@/lib/jobs/job-scope";
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

   Tiff keeps it (lib/workboard/job-scope-server.ts): written from
   everything on the job, rewritten when something new lands. */

export function JobScope({
  scope,
  reading = false,
  onUndo,
}: {
  scope: JobScopeRead;
  /** Tiff is reading something new on the job. */
  reading?: boolean;
  onUndo?: () => Promise<void>;
}) {
  const [undoing, setUndoing] = useState(false);
  const undo = () => {
    if (!onUndo) return;
    setUndoing(true);
    void onUndo().finally(() => setUndoing(false));
  };
  return (
    <>
      <JobSection name="Scope" icon="file" hue="pink" className="jov-summary">
        <div className="jsc">
          {scope.lede && <p className="jsc-lede">{scope.lede}</p>}
          {scope.systems.map((s, i) => (
            <div className="jsc-part" key={`${s.area}-${i}`}>
              <h3 className="jsc-h">{[s.area, s.kind].filter(Boolean).join(": ")}</h3>
              <p className="jsc-p">
                {s.text}
                {s.from.length > 0 && <span className="jsc-from">{s.from.join(", ")}</span>}
              </p>
            </div>
          ))}
          {scope.added.length > 0 && (
            <div className="jsc-part">
              <h3 className="jsc-h">Added</h3>
              <ul className="jsc-ul">
                {scope.added.map((a, i) => (
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
      {(scope.updates.length > 0 || reading) && (
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
