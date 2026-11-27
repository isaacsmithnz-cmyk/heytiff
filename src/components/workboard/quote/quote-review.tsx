"use client";

import { useState } from "react";
import { Button } from "@/components/parts/button";
import { Field, TextArea } from "@/components/parts/field";
import { StateWord } from "@/components/parts/state";
import type { QuoteReview, ReviewFinding } from "@/lib/quotes/review";

/* TIFF'S CHECK, ONE FINDING AT A TIME (review.ts; the mock,
   https://claude.ai/artifact/5FtXp1LSQWQGpN4gcsCwwk, "Yes, build it", 26
   November 2026). The one you're on is a card at the panel's foot, the
   spot it's about shown on the page beside it; its fixes as buttons, the
   likely one the main button, then Keep as written. Keeping a Doesn't match
   asks why, and the why goes on the quote under Qualifications; a Worth a
   look keeps with or without one. The cards are the house's one-question
   card (tiff-questions.tsx), so it reads as her questions do. */

export function ReviewWalk({
  review,
  at,
  n,
  of,
  busy,
  onAnswer,
  onProceed,
}: {
  review: QuoteReview;
  at: ReviewFinding;
  n: number;
  of: number;
  busy: boolean;
  /** a fix picked by its index, or kept with its reason */
  onAnswer: (id: string, pick: number | "keep", reason: string) => void;
  /** past the check as it is, marked ready to send on your word */
  onProceed?: () => void;
}) {
  const [keeping, setKeeping] = useState<string | null>(null);
  const [why, setWhy] = useState("");
  const live = review.findings.filter((f) => f.state !== "sent");
  const mismatch = at.kind === "mismatch";
  const open = keeping === at.id;
  const needWhy = mismatch && !why.trim();
  return (
    <div className="qx-card qx-ask qx-now qr-walk" aria-label="Tiff's check">
      <p className="qx-step">
        <span>{`${n} of ${of}`}</span>
        <span className="qx-bars" aria-hidden="true">
          {live.map((f) => (
            <i key={f.id} className={f.id === at.id ? "on" : f.state !== "open" ? "done" : undefined} />
          ))}
        </span>
      </p>
      <p className="qr-kind">
        <StateWord tone={mismatch ? "wrong" : "look"}>{mismatch ? "Doesn't match" : "Worth a look"}</StateWord>
      </p>
      <p className="qx-askq">{at.words}</p>
      {at.put && <p className="qx-askput">{`On the quote now: ${at.put}`}</p>}
      <div className="qx-answers">
        {!open &&
          at.answers.map((a, i) => (
            <Button key={i} kind={i === 0 ? "main" : "second"} size={44} className="qx-answer" disabled={busy} onClick={() => onAnswer(at.id, i, "")}>
              <span>{a.label}</span>
            </Button>
          ))}
        {!open ? (
          <Button
            kind="second"
            size={44}
            className="qx-answer"
            disabled={busy}
            onClick={() => {
              setKeeping(at.id);
              setWhy("");
            }}
          >
            Keep as written
          </Button>
        ) : (
          <>
            <Field label={mismatch ? "Why it stays, on the quote" : "Why it stays, on the quote (if you like)"}>
              <TextArea rows={2} value={why} maxLength={300} onChange={(e) => setWhy(e.target.value)} autoFocus />
            </Field>
            <Button
              kind="main"
              size={44}
              className="qx-answer"
              disabled={busy || needWhy}
              onClick={() => {
                onAnswer(at.id, "keep", why);
                setKeeping(null);
              }}
            >
              {why.trim() ? "Keep with this reason" : "Keep it"}
            </Button>
            <Button kind="quiet" size={44} className="qx-answer" disabled={busy} onClick={() => setKeeping(null)}>
              Back to the fixes
            </Button>
          </>
        )}
        {/* past what's left, on your word (Isaac, 27 November 2026: "make
            a way to skip it or say that you are happy to proceed") */}
        {!open && onProceed && (
          <Button kind="quiet" size={44} className="qx-answer" disabled={busy} onClick={onProceed}>
            Ignore
          </Button>
        )}
      </div>
    </div>
  );
}
