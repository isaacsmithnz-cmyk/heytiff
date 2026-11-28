"use client";

import { useEffect, useEffectEvent, useRef, type RefObject } from "react";
import type { DesignDocument } from "@/lib/studio/document";
import type { JobPlanRead } from "@/lib/jobs/plans";
import { buildingTakes, keptChanges, keptWords, plansWith, takeOnto } from "@/lib/studio/building-kept";
import { ToastProvider, useToast } from "@/components/parts/toast";

/* THE DESIGN AND THE BUILDING, BOTH WAYS (join 2, "the building", board 5
   of https://claude.ai/artifact/6xDKm8xV6f2PGZJKVo6M46; building-kept.ts).

   As the design opens on a job's plans, what the building has that its
   zones don't, set in another design, is taken as one change: "From the
   building: Grand Hall height 6.4 m", with Undo. A zone's value set by hand
   here goes onto the job's plan once it has sat still a moment: "The
   building has it now: Grand Hall height 6.4 m", with Undo, which puts the
   zone back and the building with it. Draws nothing but the toast. */

const actions = () => import("@/app/actions/job-plans");

/** how long a zone sits still before what was set on it is kept, ms */
const SETTLE_MS = 1500;

/** what a zone holds that the building keeps: the change to watch for */
const zonesOf = (d: DesignDocument) =>
  d.objects
    .filter((o) => o.type === "room")
    .map((o) => {
      const p = o.props;
      return [o.id, p.readKey, p.handSet, p.name, p.ceilingHeightM, p.roomAbove, p.glazing, p.condition].map((v) => JSON.stringify(v ?? null)).join(",");
    })
    .join("|");

const nameIn = (d: DesignDocument, id: string) => String(d.objects.find((o) => o.id === id)?.props.name ?? "Zone");
const said = (words: string[]) => (words.length > 2 ? `${words.slice(0, 2).join(", ")} and ${words.length - 2} more` : words.join(", "));

/** the props the building keeps, as a zone of `from` has them */
const KEPT_PROPS = ["name", "ceilingHeightM", "heightFrom", "roomAbove", "glazing", "condition", "handSet"];
function putBack(cur: DesignDocument, from: DesignDocument, ids: ReadonlySet<string>): DesignDocument {
  const was = new Map(from.objects.map((o) => [o.id, o]));
  return {
    ...cur,
    objects: cur.objects.map((o) => {
      const w = ids.has(o.id) ? was.get(o.id) : undefined;
      if (!w) return o;
      const props = { ...o.props };
      for (const k of KEPT_PROPS) {
        if (w.props[k] === undefined) delete props[k];
        else props[k] = w.props[k];
      }
      return { ...o, props };
    }),
  };
}

function Keep({ job, doc, docRef, mutate, plans, onPlans }: Props) {
  const toast = useToast();
  /* the design as it opened, or as it was last kept: what a change is measured from */
  const base = useRef<DesignDocument | null>(null);
  const took = useRef(false);

  const takeNow = useEffectEvent(() => {
    const d = docRef.current;
    if (!plans || !d || took.current) return;
    took.current = true;
    const takes = buildingTakes(d, plans);
    if (!takes.length) {
      base.current = d;
      return;
    }
    const next = takeOnto(d, takes);
    base.current = next;
    mutate(() => next);
    toast({ text: `From the building: ${said(takes.flatMap((t) => keptWords(nameIn(d, t.zoneId), t.values)))}`, undo: () => mutate(() => d) });
  });
  useEffect(() => {
    if (plans) takeNow();
  }, [plans]);

  const keepNow = useEffectEvent(async () => {
    const d = docRef.current;
    const b = base.current;
    if (!d || !b || !plans) return;
    const writes = keptChanges(b, d, plans);
    base.current = d;
    if (!writes.length) return;
    const a = await actions();
    const why = await a.keepZonesOnPlans(job, d.id, writes).catch(() => "The building couldn't be kept on the job. Try again.");
    if (why) {
      /* asked again on the next change */
      base.current = b;
      toast({ text: why });
      return;
    }
    onPlans(plansWith(plans, writes, { by: null, design: d.id, at: new Date().toISOString() }));
    const words = writes.flatMap((w) => keptWords(nameIn(b, w.zoneId), w.values));
    if (!words.length) return;
    const ids = new Set(writes.map((w) => w.zoneId));
    toast({ text: `The building has it now: ${said(words)}`, undo: () => mutate((cur) => putBack(cur, b, ids)) });
  });
  const zones = zonesOf(doc);
  useEffect(() => {
    if (!plans || !base.current) return;
    const t = setTimeout(() => void keepNow(), SETTLE_MS);
    return () => clearTimeout(t);
  }, [zones, plans]);
  return null;
}

type Props = {
  job: string;
  doc: DesignDocument;
  docRef: RefObject<DesignDocument | null>;
  mutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  /** the job's plans, once read: null until then */
  plans: JobPlanRead[] | null;
  /** the job's plans as they are once a write is kept */
  onPlans: (plans: JobPlanRead[]) => void;
};

export function BuildingKeeper(p: Props) {
  return (
    <ToastProvider>
      <Keep {...p} />
    </ToastProvider>
  );
}
