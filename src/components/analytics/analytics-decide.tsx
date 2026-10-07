"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { decideJob } from "@/app/actions/analytics-decide";
import { ANSWERS, QUESTIONS, QUESTION_WORDS, answerLabel, answerSaid, kindLabel, type Question } from "@/lib/analytics/decisions";
import { longDay, money, type Ask } from "@/lib/analytics/job-analytics";

/* TO DECIDE — what the figures can't place on their own (Isaac, 2026-10-07:
   "anything unknown or questionable should be manually decided"; the
   mock-up's third screen). One group per question, each row a job with what
   was read from it and the answers it takes. What you press is drawn at once
   and put back, with the action's words, if it is refused; an answer kept,
   the page is asked again so every figure takes it. A row answered on this
   visit stays where it was, with Undo; the ones answered before are a press
   away. A suggestion is said beside the choices, never chosen for you. */

const FIRST = 20;

const keyOf = (a: Ask) => `${a.job.id}:${a.question}`;

function without<T>(m: Record<string, T>, k: string): Record<string, T> {
  const out = { ...m };
  delete out[k];
  return out;
}

export function ToDecide({ asks, names, canDecide }: { asks: Ask[]; names: Record<string, string>; canDecide: boolean }) {
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

  const answerOf = (a: Ask): string | null => (keyOf(a) in local ? local[keyOf(a)] : a.answer);

  async function give(a: Ask, answer: string | null) {
    const k = keyOf(a);
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

  const open = asks.filter((a) => answerOf(a) === null);
  const openJobs = new Set(open.map((a) => a.job.id)).size;
  const decidedBefore = asks.filter((a) => a.answer !== null && !touched.has(keyOf(a))).length;

  return (
    <div className="an">
      <div className="an-headrow">
        <p className="an-head" aria-live="polite">
          {openJobs === 0
            ? "Nothing to decide. Every job is in the figures."
            : `${openJobs.toLocaleString("en-AU")} ${openJobs === 1 ? "job" : "jobs"} to decide.`}
        </p>
        {decidedBefore > 0 && (
          <button type="button" className="an-more" onClick={() => setShowDecided((s) => !s)} aria-expanded={showDecided}>
            {showDecided ? "Hide what was decided" : `Show what was decided, ${decidedBefore.toLocaleString("en-AU")}`}
          </button>
        )}
      </div>
      {!canDecide && <p className="an-err">Answers can&rsquo;t be kept until the database is updated for them.</p>}

      {QUESTIONS.map((q) => {
        const all = asks.filter((a) => a.question === q);
        const rows = all.filter((a) => answerOf(a) === null || touched.has(keyOf(a)) || showDecided);
        if (rows.length === 0) return null;
        const waiting = all.filter((a) => answerOf(a) === null).length;
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
}: {
  ask: Ask;
  client: string | null;
  answer: string | null;
  busy: boolean;
  error: string | null;
  canDecide: boolean;
  onAnswer: (answer: string | null) => void;
}) {
  const j = ask.job;
  const facts = [
    j.suburb,
    `${j.status ?? "No status"} in ServiceM8`,
    j.raisedOn ? `raised ${longDay(j.raisedOn)}` : null,
    j.valueCents === null ? "no price" : money(j.valueCents),
  ]
    .filter(Boolean)
    .join(", ");
  const { label, said, hint } = evidence(ask);
  const choices = ANSWERS[ask.question];

  return (
    <div className="an-qrow">
      <div className="an-qjob">
        <Link href={`/dashboard/workboard?job=${encodeURIComponent(j.id)}`}>
          {j.number ? `#${j.number} ` : ""}
          {client ?? "No client name"}
        </Link>
        <span>{facts}</span>
      </div>
      <div className="an-qwhat">
        <span className="an-label">{label}</span>
        <span>{said}</span>
        {hint && <span className="an-note">{hint}</span>}
      </div>
      <div className="an-qact">
        {answer === null ? (
          choices.map((c) => (
            <button key={c} type="button" className="an-choice" disabled={busy || !canDecide} onClick={() => onAnswer(c)}>
              {answerLabel(ask.question, c)}
            </button>
          ))
        ) : (
          <>
            <span className="an-said ok">
              <i aria-hidden="true" />
              {answerSaid(ask.question, answer)}
            </span>
            <button type="button" className="an-undo" disabled={busy} onClick={() => onAnswer(null)}>
              Undo
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
            ? "Unsuccessful in ServiceM8, but marked paid."
            : "Accepted on the proposal, and still a Quote in ServiceM8.",
        hint: null,
      };
    case "kind":
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
