"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import type { JobPlanRead } from "@/lib/jobs/plans";
import { readQuestions, sheetTitleOf, type ReadAnswer, type ReadQuestion } from "@/lib/jobs/read-questions";

/* CHECK THE READ, ONE QUESTION AT A TIME (Isaac, 26 November 2026: "make
   check the read workflow smooth", then "Yes, build it" to
   https://claude.ai/artifact/Tx16qpWRbxfusq6xCEWKYn, its second row). What
   Tiff wasn't sure of in a set's floors, a question at a time, with the
   pages it's about shown big and their sheet titles under them, Tiff's
   likely answer the main button and what each answer does beside it, as
   the quote's questions are asked. An answer saves itself, on its pages
   alone, and the next question comes; Skip leaves one asked, Back goes to
   the one before. The last answer closes it, and the job says what changed
   with Undo. A page pressed opens at its full size, to read its title block
   or its rooms, and Back to the question returns. */

/** A floor page's full picture, signed (pagesToView). */
export type PageShown = { n: number; url: string };

export function CheckReadDialog({
  plan,
  onAnswer,
  onDone,
  onClose,
  loadPages,
}: {
  plan: JobPlanRead;
  /** an answer's floors saved on its pages alone: what went wrong, or null */
  onAnswer: (chosen: Record<number, string>) => Promise<string | null>;
  /** answered at least one: every page's floor as answered, and how many were skipped */
  onDone: (answered: Record<number, string>, skipped: number) => void;
  /** closed with nothing answered */
  onClose: () => void;
  /** the pages' full pictures; until they come the thumbnails stand in */
  loadPages?: () => Promise<readonly PageShown[] | null>;
}) {
  /* asked once, as the dialog opens: an answer changes the plan under it */
  const [questions] = useState(() => readQuestions(plan));
  const [at, setAt] = useState(0);
  const [answered, setAnswered] = useState<Record<number, string>>({});
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [looking, setLooking] = useState<number | null>(null);
  const [full, setFull] = useState<Record<number, string>>({});

  /* the pictures are asked for once, as it opens: the caller's loader is
     held from the first draw, as a new one each draw would ask again */
  const [load] = useState(() => loadPages);
  useEffect(() => {
    if (!load) return;
    let live = true;
    void load()
      .catch(() => null)
      .then((shown) => {
        if (live && shown) setFull(Object.fromEntries(shown.map((p) => [p.n, p.url])));
      });
    return () => {
      live = false;
    };
  }, [load]);

  const q = questions[at];
  const answeredAny = Object.keys(answered).length > 0;
  const close = () => (answeredAny ? onDone(answered, skipped.size) : onClose());
  const next = (now: Record<number, string>, skips: ReadonlySet<string>) => {
    setError(null);
    setLooking(null);
    if (at + 1 < questions.length) {
      setAt(at + 1);
      return;
    }
    if (Object.keys(now).length > 0) onDone(now, skips.size);
    else onClose();
  };
  const answer = async (a: ReadAnswer) => {
    if (busy || !q) return;
    setError(null);
    setBusy(a.key);
    const wrong = await onAnswer(a.chosen).catch(() => "The floors couldn't be saved. Try again.");
    setBusy(null);
    if (wrong) {
      setError(wrong);
      return;
    }
    const now = { ...answered, ...a.chosen };
    const skips = new Set(skipped);
    skips.delete(q.key);
    setAnswered(now);
    setSkipped(skips);
    next(now, skips);
  };
  const skip = () => {
    if (!q) return;
    const skips = new Set(skipped).add(q.key);
    setSkipped(skips);
    next(answered, skips);
  };

  if (!q) return null;
  return (
    <Dialog
      heading="Check the read"
      under={plan.name}
      width={960}
      onClose={close}
      dismissable={!busy}
      foot={
        <>
          <span className="ckr-count">{`${at + 1} of ${questions.length}`}</span>
          {looking !== null ? (
            <Button onClick={() => setLooking(null)}>Back to the question</Button>
          ) : (
            <>
              {at > 0 && (
                <Button onClick={() => setAt(at - 1)} disabled={!!busy}>
                  Back
                </Button>
              )}
              <Button onClick={skip} disabled={!!busy}>
                Skip this question
              </Button>
            </>
          )}
        </>
      }
    >
      <ReadQuestionBody plan={plan} q={q} full={full} looking={looking} onLook={setLooking} busy={busy} error={error} onAnswer={(a) => void answer(a)} />
    </Dialog>
  );
}

/** One question's body: what's asked and why, its pages big under their
    sheet titles (pressed, one at its full size), and its answers with what
    each does. Check the read's own dialog draws it, and New design draws it
    in its place to settle the read before a design starts. */
export function ReadQuestionBody({
  plan,
  q,
  full,
  looking,
  onLook,
  busy,
  error,
  onAnswer,
}: {
  plan: JobPlanRead;
  q: ReadQuestion;
  /** the pages' full pictures, by page, as they've come */
  full: Readonly<Record<number, string>>;
  /** the page shown at its full size, or none */
  looking: number | null;
  onLook: (n: number | null) => void;
  /** the answer whose save is out */
  busy: string | null;
  error: string | null;
  onAnswer: (a: ReadAnswer) => void;
}) {
  const pageOf = (n: number) => plan.pages.find((p) => p.n === n);
  const srcOf = (n: number) => full[n] ?? plan.thumbs[n] ?? null;
  const titleOf = (n: number) => {
    const page = pageOf(n);
    return page ? sheetTitleOf(page) : null;
  };
  const lookSrc = looking !== null ? srcOf(looking) : null;
  return (
      <div className="ckr">
        <div className="ckr-said">
          <p className="ckr-q">{q.ask}</p>
          {q.why && <p className="ckr-why">{q.why}</p>}
        </div>
        {looking !== null && lookSrc ? (
          <div className="ckr-look" role="region" aria-label={`Page ${looking}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lookSrc} alt={`Page ${looking}`} />
          </div>
        ) : (
          <>
            <div className={`ckr-pages ckr-pages--${Math.min(q.pages.length, 3)}`}>
              {q.pages.map((n) => {
                const src = srcOf(n);
                const title = titleOf(n);
                return (
                  <figure key={n} className="ckr-page">
                    {src ? (
                      <button type="button" className="ckr-open" aria-label={`Look at page ${n}`} onClick={() => onLook(n)}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt="" />
                      </button>
                    ) : (
                      <span className="ckr-blank" />
                    )}
                    <figcaption className="ckr-cap">
                      {`Page ${n}`}
                      {title && <span>{title}</span>}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
            <div className="ckr-answers">
              {q.answers.map((a) => (
                <div key={a.key} className="ckr-answer">
                  <Button kind={a.likely ? "main" : "second"} onClick={() => onAnswer(a)} disabled={!!busy} aria-busy={busy === a.key || undefined}>
                    {a.label}
                  </Button>
                  <span className="ckr-does">{a.does}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {error && (
          <p className="pt-field-error" role="alert">
            {error}
          </p>
        )}
      </div>
  );
}
