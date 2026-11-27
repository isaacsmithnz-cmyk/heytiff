"use client";

import { useEffect, useEffectEvent, useRef, type RefObject } from "react";
import type { DesignDocument } from "@/lib/studio/document";
import type { DataPack } from "@/lib/studio/packs/schema";
import { allocationsOf } from "@/lib/studio/allocations";
import { takeFromQuote, tookWords } from "@/lib/studio/take-from-quote";
import { cents2 } from "@/lib/quotes/quote-sum";
import { ToastProvider, useToast } from "@/components/parts/toast";

/* THE DESIGN AND THE QUOTE, BOTH WAYS (the units mock, board 4,
   https://claude.ai/artifact/1Dhn6R3di6pdBX9F3ah3Nk):

   What the quote's answers left for the design (take-from-quote.ts) is
   read as the design opens and whenever its tab is come back to, and taken
   as one change. A unit changed here, the quote follows it until it's sent
   (design-units-server.ts), and a toast says what it did: "The quote
   changed with it: Master Bedroom P40, +$410.00", or, sent, "The quote will
   need updating". Each toast's Undo puts both back. Draws nothing but the
   toast. */

const actions = () => import("@/app/actions/studio");

/** the design's units, model by model: what the quote follows */
const unitsOf = (d: DesignDocument) =>
  d.systems
    .flatMap((s) => allocationsOf(s).map((a) => `${a.id}:${a.model}:${a.roomId ?? ""}`))
    .sort()
    .join("|");

const signed = (c: number) => (Math.round(c) === 0 ? "" : `, ${c > 0 ? "+" : ""}${cents2(c)}`);

/** how long the units sit still before the quote is asked to follow, ms */
const SETTLE_MS = 1500;

function Takes({ job, designId, pack, doc, docRef, mutate, onQuote }: Props) {
  const toast = useToast();
  /* what's been taken here already, so a read before the save lands takes nothing twice */
  const done = useRef(new Set<string>());
  /* the design as the quote last followed it: what Undo goes back to */
  const followedAt = useRef<DesignDocument | null>(null);
  const take = useEffectEvent(async () => {
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
    /* what it took is the quote's already: nothing for the quote to follow */
    followedAt.current = took.doc;
    mutate(() => took.doc);
    toast({
      text: tookWords(took),
      undo: () => {
        mutate(() => before);
        followedAt.current = before;
        void a.refuseQuoteTakes(job, took.lineIds, took.dropped);
      },
    });
  });
  /* `opening`: what changed before this design opened, caught up once, its
     Undo on the quote's Changes, as there's no change of this sitting to undo */
  const follow = useEffectEvent(async (opening = false) => {
    const now = docRef.current;
    const was = opening ? null : followedAt.current;
    if (!now || now.id !== designId || (!opening && (!was || unitsOf(was) === unitsOf(now)))) return;
    followedAt.current = now;
    const a = await actions();
    const r = await a.followDesignNow(job, now).catch(() => null);
    if (!r) return;
    if (r.words.length) onQuote?.();
    if (!was) {
      if (r.words.length) toast({ text: `The quote changed with it: ${r.words.join(", ")}${r.deltaCents == null ? "" : signed(r.deltaCents)}` });
      return;
    }
    if (r.sent && r.waiting > 0) {
      toast({ text: "The quote will need updating", undo: () => mutate(() => was) });
      return;
    }
    if (r.words.length === 0) return;
    toast({
      text: `The quote changed with it: ${r.words.join(", ")}${r.deltaCents == null ? "" : signed(r.deltaCents)}`,
      undo: () => {
        mutate(() => was);
        followedAt.current = was;
        void a.undoFollowDesign(job, r.followed).then(() => onQuote?.());
      },
    });
  });
  useEffect(() => {
    void take();
    const back = () => {
      if (document.visibilityState === "visible") void take();
    };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [job, designId, pack]);
  /* as the units change: once they've sat still, the quote follows */
  const units = doc.id === designId ? unitsOf(doc) : "";
  useEffect(() => {
    if (!units) return;
    if (followedAt.current === null) {
      followedAt.current = docRef.current;
      const t = setTimeout(() => void follow(true), SETTLE_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => void follow(), SETTLE_MS);
    return () => clearTimeout(t);
  }, [units, docRef]);
  return null;
}

type Props = {
  job: string;
  designId: string;
  pack: DataPack | null;
  doc: DesignDocument;
  docRef: RefObject<DesignDocument | null>;
  mutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  /** the quote changed with the design: On the quote reads it again */
  onQuote?: () => void;
};

export function QuoteTakes(p: Props) {
  return (
    <ToastProvider>
      <Takes {...p} />
    </ToastProvider>
  );
}
