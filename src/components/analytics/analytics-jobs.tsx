"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { decideJob } from "@/app/actions/analytics-decide";
import { answerSaid } from "@/lib/analytics/decisions";
import { longDay, money, type AnalyticsJob } from "@/lib/analytics/job-analytics";
import { sm8JobUrl } from "@/lib/integrations/sm8-links";

/* A JOB ON THE ANALYTICS PAGE, and calling it void (Isaac, 2026-10-07: "i
   also need a way to mark jobs void or something, unsuccessful isnt accurate
   for invalid jobs"). Every list of jobs here draws a job the one way: its
   number and client, a door onto its card, and where, what and how much. Void
   is a press on any of them, kept as one answer in job_analytics_decisions,
   and Undo takes it back. ServiceM8 has no void: its own word for a job that
   wasn't one is deleting it, which HeyTiff's copy then leaves out by itself,
   so the job is opened there rather than deleted from here. */

/** The job, its card's door and the facts about it. */
export function JobCell({ job, client }: { job: AnalyticsJob; client: string | null }) {
  const facts = [
    job.suburb,
    `${job.status ?? "No status"} in ServiceM8`,
    job.raisedOn ? `raised ${longDay(job.raisedOn)}` : null,
    job.valueCents === null ? "no price" : money(job.valueCents),
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="an-qjob">
      <Link href={`/dashboard/workboard?job=${encodeURIComponent(job.id)}`}>
        {job.number ? `#${job.number} ` : ""}
        {client ?? "No client name"}
      </Link>
      <span>{facts}</span>
    </div>
  );
}

/** One answer said of a job, and Undo, drawn at once and put back with the
    action's words when refused: Void, or kept open as a tender. `server` is
    what the page says; a press on this visit goes ahead of it until the page
    catches up. The jobs pressed on stay known, so a list that would drop
    them keeps them in place. */
function useMark(question: "void" | "extend", answer: string) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pressed, setPressed] = useState<Record<string, AnalyticsJob>>({});

  const isOn = (job: AnalyticsJob, server: boolean) => (job.id in local ? local[job.id]! : server);

  async function setOn(job: AnalyticsJob, on: boolean, server: boolean) {
    const id = job.id;
    const was = isOn(job, server);
    setLocal((m) => ({ ...m, [id]: on }));
    setPressed((m) => ({ ...m, [id]: job }));
    setBusy((b) => ({ ...b, [id]: true }));
    setErrors((e) => {
      const out = { ...e };
      delete out[id];
      return out;
    });
    const r = await decideJob(id, question, on ? answer : null);
    setBusy((b) => {
      const out = { ...b };
      delete out[id];
      return out;
    });
    if (!r.ok) {
      setLocal((m) => ({ ...m, [id]: was }));
      setErrors((e) => ({ ...e, [id]: r.error }));
      return;
    }
    startRefresh(() => router.refresh());
  }

  return { isOn, setOn, busy, errors, pressed };
}

export type Mark = ReturnType<typeof useMark>;

/** Void and Undo. */
export function useVoids() {
  const m = useMark("void", "void");
  return { ...m, isVoid: m.isOn, setVoid: m.setOn };
}

export type Voids = ReturnType<typeof useVoids>;

/** Kept open as a tender, and Undo (Isaac, 2026-10-08: "Do 60 days with
    option to extend if it's a tender etc"). */
export const useKeptOpen = () => useMark("extend", "tender");

/** A kept tender's line: what it does, and Undo. */
export function KeptSaid({ days, busy, onUndo }: { days: number; busy: boolean; onUndo: () => void }) {
  return (
    <>
      <span className="an-said">
        <i aria-hidden="true" />
        {`Kept open as a tender, to ${days} days.`}
      </span>
      <button type="button" className="an-undo" disabled={busy} onClick={onUndo}>
        Undo
      </button>
    </>
  );
}

/** What a list offers besides Void: keeping a quote open as a tender. */
export type KeepOpen = {
  marks: Mark;
  /** whether the page says the job is kept open */
  server: (job: AnalyticsJob) => boolean;
  /** whether the job can be: a quote, not one a person marked lost */
  can: (job: AnalyticsJob) => boolean;
  /** the tender days */
  days: number;
};

/** A void job's line: what it did, Undo, and ServiceM8, which still has it. */
export function VoidSaid({ job, busy, onUndo }: { job: AnalyticsJob; busy: boolean; onUndo: () => void }) {
  const url = sm8JobUrl(job.id);
  return (
    <>
      <span className="an-said void">
        <i aria-hidden="true" />
        {answerSaid("void", "void")}
      </span>
      <button type="button" className="an-undo" disabled={busy} onClick={onUndo}>
        Undo
      </button>
      {url && (
        <span className="an-note">
          ServiceM8 still has it.{" "}
          <a className="an-out" href={url} target="_blank" rel="noreferrer">
            Open in ServiceM8
          </a>
        </span>
      )}
    </>
  );
}

/** A list of jobs, each with Void or, once void, Undo: the lost quotes to
    review, and the jobs already void. */
export function VoidList({
  jobs,
  names,
  voids,
  serverVoid,
  what,
  canDecide,
  keep,
}: {
  jobs: AnalyticsJob[];
  names: Record<string, string>;
  voids: Voids;
  /** whether the page says each is void */
  serverVoid: boolean;
  /** the line under the job: why it is in this list */
  what: (job: AnalyticsJob) => string;
  canDecide: boolean;
  /** offer "Tender, keep open" beside Void */
  keep?: KeepOpen;
}) {
  const [all, setAll] = useState(false);
  /* a job pressed on stays where it was, though the page drops it */
  const pressedAway = [
    ...Object.values(voids.pressed).filter((p) => voids.isVoid(p, serverVoid) !== serverVoid),
    ...(keep ? Object.values(keep.marks.pressed).filter((p) => keep.marks.isOn(p, keep.server(p)) !== keep.server(p)) : []),
  ];
  const shown = [...jobs, ...pressedAway.filter((p, i) => !jobs.some((j) => j.id === p.id) && pressedAway.findIndex((q) => q.id === p.id) === i)];
  const rows = all ? shown : shown.slice(0, 20);
  return (
    <>
      <div className="an-qlist">
        {rows.map((job) => {
          const isVoid = voids.isVoid(job, serverVoid);
          const kept = keep ? keep.marks.isOn(job, keep.server(job)) : false;
          const busy = !!voids.busy[job.id] || !!keep?.marks.busy[job.id];
          const error = voids.errors[job.id] ?? keep?.marks.errors[job.id];
          return (
            <div className="an-qrow" key={job.id}>
              <JobCell job={job} client={job.clientId ? (names[job.clientId] ?? null) : null} />
              <div className="an-qwhat">
                <span className="an-label">{what(job)}</span>
                <span>{job.brief ?? "No description in ServiceM8."}</span>
              </div>
              <div className="an-qact">
                {isVoid ? (
                  <VoidSaid job={job} busy={busy} onUndo={() => voids.setVoid(job, false, serverVoid)} />
                ) : kept && keep ? (
                  <KeptSaid days={keep.days} busy={busy} onUndo={() => keep.marks.setOn(job, false, keep.server(job))} />
                ) : (
                  <>
                    {keep?.can(job) && (
                      <button type="button" className="an-choice" disabled={busy || !canDecide} onClick={() => keep.marks.setOn(job, true, keep.server(job))}>
                        Tender, keep open
                      </button>
                    )}
                    <button type="button" className="an-choice" disabled={busy || !canDecide} onClick={() => voids.setVoid(job, true, serverVoid)}>
                      Void
                    </button>
                  </>
                )}
                {error && (
                  <p className="an-err" role="alert">
                    {error}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {shown.length > rows.length && (
        <button type="button" className="an-more" onClick={() => setAll(true)}>
          Show {(shown.length - rows.length).toLocaleString("en-AU")} more
        </button>
      )}
    </>
  );
}
