"use client";

import { useState } from "react";
import type { JoinAsk } from "@/lib/quotes/design-units";
import { AskCard } from "./tiff-questions";

/* THE DESIGN'S QUESTIONS WHERE TIFF ISN'T ON (design-units.ts): the
   quote's units and the design's, joined one question at a time over the
   line items, as her card asks them in Build. No box for your own words:
   there's nobody to send them to. */
export function JoinCard({ asks, busy, onPick }: { asks: readonly JoinAsk[]; busy: boolean; onPick: (id: string, index: number) => void }) {
  const [draft, setDraft] = useState("");
  const a = asks[0];
  if (!a) return null;
  return (
    <AskCard
      ask={{ id: 0, question: a.question, topic: a.topic, put: a.put, answers: a.answers, deltas: a.deltas, done: null }}
      step={`Question 1 of ${asks.length}`}
      busy={busy}
      draft={draft}
      onDraft={setDraft}
      onPick={(i) => onPick(a.id, i)}
    />
  );
}
