"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { decideJob } from "@/app/actions/analytics-decide";
import { makeWorkOrder } from "@/app/actions/booking-sm8";
import { ANSWERS, QUESTIONS, QUESTION_WORDS, answerLabel, answerSaid, cleanupFor, kindLabel, type Question } from "@/lib/analytics/decisions";
import { sm8JobUrl } from "@/lib/integrations/sm8-links";
import { money, type AnalyticsJob, type Ask } from "@/lib/analytics/job-analytics";
import { JobCell, useVoids, VoidList, VoidSaid, type Voids } from "./analytics-jobs";

/* TO DECIDE — what the figures can't place on their own (Isaac, 2026-10-07:
   "anything unknown or questionable should be manually decided"; the
   mock-up's third screen). One group per question, each row a job with what
   was read from it and the answers it takes. What you press is drawn at once
   and put back, with the action's words, if it is refused; an answer kept,
   the page is asked again so every figure takes it. A row answered on this
   visit stays where it was, with Undo; the ones answered before are a press
   away. A suggestion is said beside the choices, never chosen for you.

   THE CLEAN-UP IN SERVICEM8 (Isaac: "They can clean up in servicem8 too with
   an extra button"). An answer ServiceM8 disagrees with offers the change
   that would make it agree, and never makes it on its own. A won Quote is
   made a Work Order by the job card's own press (makeWorkOrder), where this
   viewer may make one; anything else opens the job in ServiceM8. Once a
   change has gone, the answer keeps no Undo: it is ServiceM8's now. */

/** Where a row's change to ServiceM8 stands on this visit. */
type Sm8Step = { busy: true } | { state: "sent" | "waiting" | "trial" } | { error: string };

const SM8_SAID = {
  sent: "A work order in ServiceM8 now.",
  waiting: "On its way to ServiceM8.",
  trial: "Trial run: checked, and nothing sent.",
} as const;

const FIRST = 20;

const keyOf = (a: Ask) => `${a.job.id}:${a.question}`;

function without<T>(m: Record<string, T>, k: string): Record<string, T> {
  const out = { ...m };
  delete out[k];
  return out;
}

export function ToDecide({
  asks,
  names,
  canDecide,
  workOrders = null,
  voided = [],
}: {
  asks: Ask[];
  names: Record<string, string>;
  canDecide: boolean;
  /** a Quote can be made a Work Order in ServiceM8 from here */
  workOrders?: "on" | "trial" | null;
  /** jobs of the period already void */
  voided?: AnalyticsJob[];
}) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  /* answers given on this visit, ahead of the page catching up: undefined is
     "as the page says", null is "taken back" */
  const [local, setLocal] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [showDecided, setShowDecided] = useState(false);
  const [more, setMore] = useState<ReadonlySet<Question>>(new Set());
  const [sm8, setSm8] = useState<Record<string, Sm8Step>>({});
  const [showVoided, setShowVoided] = useState(false);
  const voids = useVoids();
  /* the rows pressed on this visit stay where they were, though the page,
     once it has the answer, drops a job made void */
  const [seen, setSeen] = useState<Record<string, Ask>>({});
  const remember = (a: Ask) => {
    const k = keyOf(a);
    setSeen((m) => ({ ...m, [k]: a }));
  };
  const all = [...asks, ...Object.values(seen).filter((a) => !asks.some((b) => keyOf(b) === keyOf(a)))];
  const voidNow = (a: Ask) => voids.isVoid(a.job, false);

  const answerOf = (a: Ask): string | null => (keyOf(a) in local ? local[keyOf(a)] : a.answer);

  async function give(a: Ask, answer: string | null) {
    const k = keyOf(a);
    remember(a);
    const before = answerOf(a);
    setLocal((m) => ({ ...m, [k]: answer }));
    setTouched((t) => new Set(t).add(k));
    setBusy((b) => ({ ...b, [k]: true }));
    setErrors((e) => without(e, k));
    const r = await decideJob(a.job.id, a.question, answer);
    setBusy((b) => without(b, k));
    if (!r.ok) {
      setLocal((m) => ({ ...m, [k]: before }));
      setErrors((e) => ({ ...e, [k]: r.error }));
      return;
    }
    startRefresh(() => router.refresh());
  }

  /* one press is one job's change: the card's door, with a fresh press id */
  async function toWorkOrder(a: Ask) {
    const k = keyOf(a);
    setSm8((m) => ({ ...m, [k]: { busy: true } }));
    const r = await makeWorkOrder({ jobUuid: a.job.id, pressId: crypto.randomUUID() });
    setSm8((m) => ({ ...m, [k]: r.ok ? { state: r.state } : { error: r.error } }));
    if (r.ok && r.state === "sent") startRefresh(() => router.refresh());
  }

  /* the won Quotes still waiting on their change, one after another */
  const waitingWorkOrders = workOrders
    ? all.filter((a) => {
        if (voidNow(a)) return false;
        const ans = answerOf(a);
        const step = sm8[keyOf(a)];
        return ans !== null && cleanupFor(a.question, ans, a.job.status) === "work_order" && (!step || "error" in step);
      })
    : [];
  async function allToWorkOrder() {
    for (const a of waitingWorkOrders) await toWorkOrder(a);
  }

  const open = all.filter((a) => answerOf(a) === null && !voidNow(a));
  const openJobs = new Set(open.map((a) => a.job.id)).size;
  const decidedBefore = asks.filter(
    (a) => a.answer !== null && !touched.has(keyOf(a)) && cleanupFor(a.question, a.answer, a.job.status) === null,
  ).length;
  const voidedCount = voided.filter((j) => voids.isVoid(j, true)).length;

  return (
    <div className="an">
      <div className="an-headrow">
        <p className="an-head" aria-live="polite">
          {openJobs === 0
            ? "Nothing to decide. Every job is in the figures."
            : `${openJobs.toLocaleString("en-AU")} ${openJobs === 1 ? "job" : "jobs"} to decide.`}
        </p>
        {waitingWorkOrders.length > 1 && (
          <button type="button" className="an-choice" onClick={allToWorkOrder}>
            Make {waitingWorkOrders.length} work orders in ServiceM8
          </button>
        )}
        {decidedBefore > 0 && (
          <button type="button" className="an-more" onClick={() => setShowDecided((s) => !s)} aria-expanded={showDecided}>
            {showDecided ? "Hide what was decided" : `Show what was decided, ${decidedBefore.toLocaleString("en-AU")}`}
          </button>
        )}
      </div>
      {!canDecide && <p className="an-err">Answers can&rsquo;t be kept until the database is updated for them.</p>}

      {QUESTIONS.map((q) => {
        const ofQ = all.filter((a) => a.question === q);
        /* an answer ServiceM8 still disagrees with stays in view: its change is still to make */
        const rows = ofQ.filter((a) => {
          const ans = answerOf(a);
          return ans === null || touched.has(keyOf(a)) || voids.pressed[a.job.id] || showDecided || cleanupFor(a.question, ans, a.job.status) !== null;
        });
        if (rows.length === 0) return null;
        const waiting = ofQ.filter((a) => answerOf(a) === null && !voidNow(a)).length;
        const shown = more.has(q) ? rows : rows.slice(0, FIRST);
        return (
          <section className="an-sec" key={q} aria-labelledby={`an-h-${q}`}>
            <div className="an-qhead">
              <h2 id={`an-h-${q}`}>{QUESTION_WORDS[q].title}</h2>
              <span className={waiting ? "an-qcount warn" : "an-qcount ok"}>
                {waiting ? `${waiting.toLocaleString("en-AU")} to decide` : "All decided"}
              </span>
            </div>
            <p className="an-say">{QUESTION_WORDS[q].why}</p>
            <div className="an-qlist">
              {shown.map((a) => (
                <Row
                  key={keyOf(a)}
                  ask={a}
                  client={a.job.clientId ? (names[a.job.clientId] ?? null) : null}
                  answer={answerOf(a)}
                  busy={!!busy[keyOf(a)]}
                  error={errors[keyOf(a)] ?? null}
                  canDecide={canDecide}
                  onAnswer={(ans) => give(a, ans)}
                  workOrders={workOrders}
                  sm8={sm8[keyOf(a)] ?? null}
                  onWorkOrder={() => toWorkOrder(a)}
                  voids={voids}
                  onVoid={() => remember(a)}
                />
              ))}
            </div>
            {rows.length > shown.length && (
              <button type="button" className="an-more" onClick={() => setMore((m) => new Set(m).add(q))}>
                Show {(rows.length - shown.length).toLocaleString("en-AU")} more
              </button>
            )}
          </section>
        );
      })}

      {voided.length > 0 && (
        <section className="an-sec" aria-labelledby="an-h-void">
          <div className="an-qhead">
            <h2 id="an-h-void">{QUESTION_WORDS.void.title}</h2>
            <span className="an-qcount">{voidedCount.toLocaleString("en-AU")}</span>
          </div>
          <p className="an-say">{QUESTION_WORDS.void.why}</p>
          <button type="button" className="an-more" onClick={() => setShowVoided((s) => !s)} aria-expanded={showVoided}>
            {showVoided ? "Hide the void jobs" : `Show the ${voided.length.toLocaleString("en-AU")} void ${voided.length === 1 ? "job" : "jobs"}`}
          </button>
          {showVoided && (
            <VoidList jobs={voided} names={names} voids={voids} serverVoid what={() => "Job description"} canDecide={canDecide} />
          )}
        </section>
      )}
    </div>
  );
}

function Row({
  ask,
  client,
  answer,
  busy,
  error,
  canDecide,
  onAnswer,
  workOrders,
  sm8,
  onWorkOrder,
  voids,
  onVoid,
}: {
  ask: Ask;
  client: string | null;
  answer: string | null;
  busy: boolean;
  error: string | null;
  canDecide: boolean;
  onAnswer: (answer: string | null) => void;
  workOrders: "on" | "trial" | null;
  sm8: Sm8Step | null;
  onWorkOrder: () => void;
  voids: Voids;
  onVoid: () => void;
}) {
  const j = ask.job;
  const isVoid = voids.isVoid(j, false);
  const voidBusy = !!voids.busy[j.id];
  const { label, said, hint } = evidence(ask);
  const choices = ANSWERS[ask.question];
  /* a change that has gone, or is going, to ServiceM8 can't be undone here */
  const gone = !!sm8 && "state" in sm8 && sm8.state !== "trial";

  return (
    <div className="an-qrow">
      <JobCell job={j} client={client} />
      <div className="an-qwhat">
        <span className="an-label">{label}</span>
        <span>{said}</span>
        {hint && <span className="an-note">{hint}</span>}
      </div>
      <div className="an-qact">
        {isVoid ? (
          <VoidSaid job={j} busy={voidBusy} onUndo={() => voids.setVoid(j, false, false)} />
        ) : answer === null ? (
          <>
            {choices.map((c) => (
              <button key={c} type="button" className="an-choice" disabled={busy || !canDecide} onClick={() => onAnswer(c)}>
                {answerLabel(ask.question, c)}
              </button>
            ))}
            <button
              type="button"
              className="an-choice"
              disabled={busy || voidBusy || !canDecide}
              onClick={() => {
                onVoid();
                voids.setVoid(j, true, false);
              }}
            >
              {answerLabel("void", "void")}
            </button>
          </>
        ) : (
          <>
            <span className="an-said ok">
              <i aria-hidden="true" />
              {answerSaid(ask.question, answer)}
            </span>
            {!gone && (
              <button type="button" className="an-undo" disabled={busy} onClick={() => onAnswer(null)}>
                Undo
              </button>
            )}
            <Cleanup ask={ask} answer={answer} workOrders={workOrders} sm8={sm8} onWorkOrder={onWorkOrder} />
          </>
        )}
        {(error ?? voids.errors[j.id]) && (
          <p className="an-err" role="alert">
            {error ?? voids.errors[j.id]}
          </p>
        )}
      </div>
    </div>
  );
}

/** The change ServiceM8 needs for this answer: the press that makes it, its
    result, or the job opened in ServiceM8 to change it there. */
function Cleanup({
  ask,
  answer,
  workOrders,
  sm8,
  onWorkOrder,
}: {
  ask: Ask;
  answer: string;
  workOrders: "on" | "trial" | null;
  sm8: Sm8Step | null;
  onWorkOrder: () => void;
}) {
  const need = cleanupFor(ask.question, answer, ask.job.status);
  if (!need) return null;
  const url = sm8JobUrl(ask.job.id);
  if (need === "work_order" && workOrders) {
    if (sm8 && "state" in sm8) return <span className="an-note">{SM8_SAID[sm8.state]}</span>;
    const busy = !!sm8 && "busy" in sm8;
    return (
      <>
        <button type="button" className="an-choice" disabled={busy} onClick={onWorkOrder}>
          {busy ? "Making it a work order" : "Make it a work order in ServiceM8"}
        </button>
        {sm8 && "error" in sm8 && (
          <p className="an-err" role="alert">
            {sm8.error}
          </p>
        )}
      </>
    );
  }
  if (!url) return null;
  return (
    <span className="an-note">
      ServiceM8 still says {(ask.job.status ?? "").trim()}.{" "}
      <a className="an-out" href={url} target="_blank" rel="noreferrer">
        Open in ServiceM8
      </a>
    </span>
  );
}

/** What was read from the job that raised the question. */
function evidence(a: Ask): { label: string; said: string; hint: string | null } {
  const j = a.job;
  const brief = j.brief ?? "No description in ServiceM8.";
  switch (a.question) {
    case "quote":
      return {
        label: "Job description",
        said: brief,
        hint:
          a.kind && a.kind !== "service" && a.kind !== "maintenance"
            ? `Reads like ${kindLabel(a.kind).toLowerCase().replace("vrf", "VRF")} work, and no quote was sent.`
            : `No quote was sent, and it comes to ${money(j.valueCents)}.`,
      };
    case "outcome":
      return {
        label: "What doesn't match",
        said:
          (j.status ?? "").trim().toLowerCase() === "unsuccessful"
            ? j.paid
              ? "Unsuccessful in ServiceM8, but marked paid."
              : "Unsuccessful in ServiceM8, but a claim was invoiced on it."
            : "Accepted on the proposal, and still a Quote in ServiceM8.",
        hint: null,
      };
    case "kind":
    case "void":
      return { label: "Job description", said: brief, hint: null };
    case "price": {
      const kind = kindLabel(a.kind).replace(/^(?!VRF)./, (c) => c.toLowerCase());
      return {
        label: "Price",
        said: `${money(j.valueCents)} for a ${kind} job`,
        hint:
          a.times !== undefined && a.median !== undefined
            ? a.times >= 1
              ? `${Math.round(a.times)} times the median ${kind} job, ${money(a.median)}.`
              : `The median ${kind} job is ${money(a.median)}.`
            : null,
      };
    }
  }
}
