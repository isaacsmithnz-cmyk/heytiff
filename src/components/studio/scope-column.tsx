"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/parts/button";
import { Loading, Wrong } from "@/components/parts/states";
import { CvBox } from "@/components/conversations/box";
import { JobScope } from "@/components/jobs/job-scope";
import { JobSection } from "@/components/jobs/job-section";
import { useConversation, type Opening } from "@/components/tiff/modal/use-conversation";
import type { JobScopeRead } from "@/lib/jobs/job-scope";
import { quoteHref } from "@/lib/shell/links";

/* THE JOB'S SCOPE, IN THE STUDIO (Isaac, 9 November 2026: "a button in the
   design studio that you can refer back to while doing the design. Clicking
   it open will pop out the scope that was built on the home page or on the
   job home page. You can continue to edit it from there using TIFF"; the
   mock's boards 8 to 10, https://claude.ai/artifact/3gzx9mP747FgTX7qxsH9fe,
   "Build it").

   A column on the LEFT of the plan, not a dialog over it: the scope is
   referred to while drawing, so the plan shrinks and Systems stays on the
   right. In it, the Overview's own Scope section word for word (JobScope:
   the lede, a paragraph per system with its sources, Added, Not ours, To
   clarify, Latest updates), its close cross in the head, and at its foot
   the job's box. A note typed there is a note on the job, filed by Tiff as
   the Overview's box files one; then the brief is asked for again
   (api/workboard/job-scope), which rewrites it only when the job's story
   moved, and Latest updates says what changed. No voice here: the Studio
   has its own microphone in Tiff's pill. */

const OPENING: Opening = { origin: null, still: true, at: 0, room: "diary" };

type ScopeAnswer = { ok: true; scope: JobScopeRead | null } | { ok: false; reason: string };

async function askScope(body: Record<string, unknown>): Promise<ScopeAnswer> {
  try {
    const res = await fetch("/api/workboard/job-scope", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return (await res.json()) as ScopeAnswer;
  } catch {
    return { ok: false, reason: "Couldn't reach the job." };
  }
}

export function ScopeColumn({ jobUuid, jobNumber, onClose }: { jobUuid: string; jobNumber: string | null; onClose: () => void }) {
  /* undefined until the first answer, null for a job with no brief yet */
  const [scope, setScope] = useState<JobScopeRead | null | undefined>(undefined);
  const [wrong, setWrong] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /* what an answer does to the column: the brief, or why it couldn't be had */
  const take = useCallback((a: ScopeAnswer) => {
    if (!alive.current) return;
    if (a.ok) {
      setScope(a.scope);
      setWrong(null);
    } else {
      setWrong(a.reason);
      setScope((cur) => (cur === undefined ? null : cur));
    }
  }, []);
  /* bring the brief up to date as the column opens: a read only if something moved */
  useEffect(() => {
    let live = true;
    void askScope({ job: jobUuid }).then((a) => {
      if (live) take(a);
    });
    return () => {
      live = false;
    };
  }, [jobUuid, take]);

  const convo = useConversation({
    opening: OPENING,
    voiceEnabled: false,
    target: { kind: "job", id: jobUuid },
    targetLabel: jobNumber ? `job ${jobNumber}` : "the job",
    screen: "Design",
  });
  const working = convo.stage === "thinking" || convo.stage === "answering";
  /* once her turn has landed, the brief is asked for again; the Scope says
     she is reading until that answer is back */
  const filedCount = convo.turns.filter((t) => t.who === "tiff").length;
  const [settled, setSettled] = useState(filedCount);
  const asking = useRef<number | null>(null);
  useEffect(() => {
    if (working || filedCount === settled || asking.current === filedCount) return;
    asking.current = filedCount;
    void askScope({ job: jobUuid }).then((a) => {
      take(a);
      if (alive.current) setSettled(filedCount);
    });
  }, [filedCount, working, settled, jobUuid, take]);
  const reading = filedCount !== settled;
  const lastTiff = [...convo.turns].reverse().find((t) => t.who === "tiff") ?? null;

  const send = () => {
    if (!convo.draft.trim() || working) return;
    convo.send();
  };
  const undo = async () => take(await askScope({ job: jobUuid, undo: true }));

  return (
    <aside className="ds-scopecol" aria-label="Scope">
      <div className="ds-scope-b">
        <div className="jov">
          {scope ? (
            <JobScope scope={scope} reading={reading || working} onUndo={undo} updateHref={quoteHref(jobUuid, { update: true })} sideBySide={false} />
          ) : scope === null ? (
            <JobSection name="Scope" icon="file" hue="pink" className="jov-summary">
              <p className="ds-scope-none">{wrong ?? "No scope written yet"}</p>
            </JobSection>
          ) : (
            <Loading what="Reading the scope" />
          )}
          {wrong && scope && <Wrong word="The scope couldn't be brought up to date" means={wrong} />}
        </div>
        <div className="ds-scope-x">
          <IconButton glyph="close" label="Close the scope" size={32} onClick={onClose} />
        </div>
      </div>
      <div className="ds-scope-f">
        {lastTiff && (
          <p className="ds-scope-said">
            <b>Tiff</b> {lastTiff.text}
          </p>
        )}
        <CvBox
          value={convo.draft}
          onChange={convo.setDraft}
          onSubmit={send}
          label="Write a note on this job"
          placeholder="Write a note on this job"
          sendWord="Tiff"
          sendLabel="Send to Tiff"
          waiting={working}
          dict={null}
        />
      </div>
    </aside>
  );
}
