"use client";

import { useEffect, useEffectEvent, useRef, type RefObject } from "react";
import type { DesignDocument } from "@/lib/studio/document";
import type { DataPack } from "@/lib/studio/packs/schema";
import { takeFromQuote, tookWords } from "@/lib/studio/take-from-quote";
import { ToastProvider, useToast } from "@/components/parts/toast";

/* WHAT THE DESIGN TAKES FROM THE QUOTE (take-from-quote.ts): read as the
   design opens and whenever its tab is come back to, taken as one change,
   and said in a toast with Undo, as the quote says a change it made with
   the design (the units mock, board 4). Undo puts the design back and the
   quote asks again. Draws nothing of its own but the toast. */

const actions = () => import("@/app/actions/studio");

function Takes({ job, designId, pack, docRef, mutate }: Props) {
  const toast = useToast();
  /* what's been taken here already, so a read before the save lands takes nothing twice */
  const done = useRef(new Set<string>());
  const look = useEffectEvent(async () => {
    if (!pack) return;
    const a = await actions();
    const r = await a.readQuoteTakes(job, designId).catch(() => null);
    const before = docRef.current;
    if (!r || !before || before.id !== designId) return;
    const takes = r.takes.filter((t) => !done.current.has(`l:${t.lineId}`));
    const drop = r.drop.filter((id) => !done.current.has(`u:${id}`));
    if (takes.length === 0 && drop.length === 0) return;
    const took = takeFromQuote(before, pack, takes, drop);
    /* tried once here: what's left is asked for again when the design next opens */
    takes.forEach((t) => done.current.add(`l:${t.lineId}`));
    took.dropped.forEach((id) => done.current.add(`u:${id}`));
    if (took.words.length === 0) return;
    mutate(() => took.doc);
    toast({
      text: tookWords(took),
      undo: () => {
        mutate(() => before);
        void a.refuseQuoteTakes(job, took.lineIds, took.dropped);
      },
    });
  });
  useEffect(() => {
    void look();
    const back = () => {
      if (document.visibilityState === "visible") void look();
    };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [job, designId, pack]);
  return null;
}

type Props = {
  job: string;
  designId: string;
  pack: DataPack | null;
  docRef: RefObject<DesignDocument | null>;
  mutate: (fn: (d: DesignDocument) => DesignDocument) => void;
};

export function QuoteTakes(p: Props) {
  return (
    <ToastProvider>
      <Takes {...p} />
    </ToastProvider>
  );
}
