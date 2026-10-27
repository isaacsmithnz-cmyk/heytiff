"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Fade } from "@/components/parts/fade";
import { StateWord } from "@/components/parts/state";
import { Group, Wrong } from "@/components/settings/parts";
import type { ComponentKey } from "@/lib/quotes/components";
import { INSTALL_GROUPS, fittingWords, suppliersWords, type GroupPart, type InstallGroup } from "@/lib/quotes/install-groups";
import { RANGE_KINDS, sizeWords, type RangeKind, type RangeView } from "@/lib/quotes/ranges";
import type { ComponentShortlist } from "@/lib/quotes/settings-query";
import { RangeDialog, rangeLines, useRanges, type RangesState } from "./quoting-ranges";
import { dollars, Oops } from "./pb-bits";

/* COMMON INSTALL ITEMS, on Price book › What prices each part (Isaac, 28
   October 2026, the mock he said yes to: "clearly show the part with its
   universal name… next to it is the actual item from a supplier… the
   actual product code… where we're buying it from, plus the price"; and
   "simplify… one page").

   One short list: the eight groups (install-groups.ts), a row each, with
   the parts in it and the suppliers they come from. Open shows the group's
   parts, each by its trade name with what it is under it, then the item
   that prices it, its code, its supplier and what it costs. A part priced
   from one item opens its shortlist (Choose another); a part that comes in
   sizes opens its range. The ductwork's fittings show a size a row. */

type Props = {
  components: ComponentShortlist[];
  ranges: RangeView[];
  busy: boolean;
  wrong: string | null;
  /** a preferred item's shortlist, opened over the group */
  onChoose: (key: ComponentKey) => void;
};

const perUnit = (unit: "m" | "each") => (unit === "m" ? "a metre" : "each");
const sizes = (n: number) => `${n} size${n === 1 ? "" : "s"}`;

/** The suppliers a group's parts are priced from today. */
function boughtFrom(g: InstallGroup, components: readonly ComponentShortlist[], ranges: readonly RangeView[]): string[] {
  return g.sections.flatMap((s) =>
    s.parts.flatMap((p) =>
      "component" in p
        ? (components.find((c) => c.key === p.component)?.chosen?.offer.supplierName ?? [])
        : (ranges.find((r) => r.kind === p.range)?.items.map((i) => i.supplierName) ?? [])
    )
  );
}

export function CommonItems({ components, ranges: initialRanges, busy, wrong, onChoose }: Props) {
  const state = useRanges(initialRanges);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [openRange, setOpenRange] = useState<RangeKind | null>(null);
  const group = INSTALL_GROUPS.find((g) => g.key === openGroup) ?? null;
  const range = state.ranges.find((r) => r.kind === openRange) ?? null;

  return (
    <Group heading="Common install items">
      {wrong && !group && <Wrong>{wrong}</Wrong>}
      <div className="st2-pb-rows" role="table" aria-label="Common install items">
        <div className="st2-pb-grid st2-pb-groups st2-pb-head" role="row">
          <span role="columnheader">Group</span>
          <span role="columnheader">Bought from</span>
          <span role="columnheader">
            <span className="sr-only">Open</span>
          </span>
        </div>
        {INSTALL_GROUPS.map((g) => {
          const from = suppliersWords(boughtFrom(g, components, state.ranges));
          return (
            <div key={g.key} className="st2-pb-grid st2-pb-groups" role="row">
              <span role="cell" className="st2-pb-name">
                <b>{g.label}</b>
                <span className="st2-pb-line">
                  <Fade>{g.summary}</Fade>
                </span>
              </span>
              <span role="cell">
                <Fade>{from ?? "Lowest price"}</Fade>
              </span>
              <span role="cell" className="st2-pb-act">
                <Button kind="second" size={32} aria-label={`Open ${g.label}`} onClick={() => setOpenGroup(g.key)}>
                  Open
                </Button>
              </span>
            </div>
          );
        })}
      </div>
      {group && (
        <GroupDialog
          group={group}
          components={components}
          state={state}
          busy={busy || state.busy}
          wrong={wrong}
          onChoose={onChoose}
          onRange={setOpenRange}
          onClose={() => setOpenGroup(null)}
        />
      )}
      {range && <RangeDialog range={range} state={state} onClose={() => setOpenRange(null)} />}
    </Group>
  );
}

/* ONE GROUP, OPENED: its parts a row each, under the group's own headings. */
function GroupDialog({
  group,
  components,
  state,
  busy,
  wrong,
  onChoose,
  onRange,
  onClose,
}: {
  group: InstallGroup;
  components: readonly ComponentShortlist[];
  state: RangesState;
  busy: boolean;
  wrong: string | null;
  onChoose: (key: ComponentKey) => void;
  onRange: (kind: RangeKind) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      heading={group.label}
      width={960}
      onClose={onClose}
      foot={
        <Button kind="second" size={36} onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="st2-pb-dlg">
        {wrong && <Oops>{wrong}</Oops>}
        {group.sections.map((s, i) => (
          <section key={s.heading ?? i} aria-label={s.heading ?? group.label} className={s.heading ? undefined : "st2-pb-first"}>
            {s.heading && <h3 className="st2-pb-sub">{s.heading}</h3>}
            <div className="st2-pb-rows" role="table" aria-label={s.heading ?? group.label}>
              <div className="st2-pb-grid st2-pb-common st2-pb-head" role="row">
                <span role="columnheader">Part</span>
                <span role="columnheader">Item</span>
                <span role="columnheader">From</span>
                <span role="columnheader" className="st2-pb-fig">
                  Buy
                </span>
                <span role="columnheader">
                  <span className="sr-only">Change it</span>
                </span>
              </div>
              {s.parts.map((p) => (
                <PartRows key={"component" in p ? p.component : p.range} part={p} components={components} ranges={state.ranges} busy={busy} onChoose={onChoose} onRange={onRange} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

function Row({
  name,
  spec,
  item,
  none = "Nothing chosen yet",
  code,
  from,
  mine = false,
  buy,
  act,
}: {
  name: string;
  spec: string;
  item: string | null;
  /** what the item column says when nothing is chosen */
  none?: string;
  code: string;
  from: string;
  mine?: boolean;
  buy: string;
  act: ReactNode;
}) {
  return (
    <div className="st2-pb-grid st2-pb-common" role="row">
      <span role="cell" className="st2-pb-name">
        <b>{name}</b>
        <span className="st2-pb-line">
          <Fade>{spec}</Fade>
        </span>
      </span>
      <span role="cell" className={item ? "st2-pb-name" : "st2-pb-name st2-pb-none"}>
        <Fade>{item ?? none}</Fade>
        {code && (
          <span className="st2-pb-line">
            <Fade>{code}</Fade>
          </span>
        )}
      </span>
      <span role="cell" className="st2-pb-name">
        <Fade>{from}</Fade>
        {mine && <StateWord tone="info">Your pick</StateWord>}
      </span>
      <span role="cell" className="st2-pb-fig">
        {buy}
      </span>
      <span role="cell" className="st2-pb-act">
        {act}
      </span>
    </div>
  );
}

/** A part's row: the item that prices it; a range, its line and sizes; the
    fittings, a size a row. */
function PartRows({
  part,
  components,
  ranges,
  busy,
  onChoose,
  onRange,
}: {
  part: GroupPart;
  components: readonly ComponentShortlist[];
  ranges: readonly RangeView[];
  busy: boolean;
  onChoose: (key: ComponentKey) => void;
  onRange: (kind: RangeKind) => void;
}) {
  if ("component" in part) {
    const c = components.find((x) => x.key === part.component);
    const pick = c?.chosen ?? null;
    const per = pick?.offer.perUnitCents ?? null;
    const choose = c && c.groups.length > 0 && (
      <Button kind="second" size={32} disabled={busy} aria-label={`Choose what prices ${c.label}`} onClick={() => onChoose(c.key)}>
        Choose another
      </Button>
    );
    return (
      <Row
        name={part.name}
        spec={part.spec}
        item={pick ? pick.group.name : c && c.groups.length === 0 ? "Nothing in your price book yet" : null}
        code={pick ? [pick.offer.code, pick.offer.pack].filter(Boolean).join(", ") : ""}
        from={pick?.offer.supplierName ?? ""}
        mine={pick?.overridden ?? false}
        buy={pick && c ? (per == null ? "Needs roll length" : `${dollars(per)} ${perUnit(c.unit)}`) : ""}
        act={choose}
      />
    );
  }

  const r = ranges.find((x) => x.kind === part.range);
  const items = r?.items ?? [];
  const k = RANGE_KINDS[part.range];
  const change = (
    <Button kind="second" size={32} disabled={busy} aria-label={`${items.length ? "Change" : "Choose"} the range of ${k.noun}`} onClick={() => onRange(part.range)}>
      {items.length ? "Change range" : "Choose range"}
    </Button>
  );
  if (part.bySize && items.length) {
    const sorted = [...items].sort((a, b) => fittingWords(a.name, a.size).localeCompare(fittingWords(b.name, b.size), undefined, { numeric: true }));
    return (
      <>
        {sorted.map((i, n) => (
          <Row
            key={`${i.supplierKey}|${i.code}`}
            name={fittingWords(i.name, i.size)}
            spec={sizeWords(part.range, i.size)}
            item={i.name}
            code={i.code}
            from={i.supplierName}
            buy={i.buyCents == null ? "No longer in the book" : dollars(i.buyCents)}
            act={n === sorted.length - 1 ? change : null}
          />
        ))}
      </>
    );
  }
  const prices = items.map((i) => i.buyCents).filter((c): c is number => c != null);
  const least = prices.length ? Math.min(...prices) : null;
  return (
    <Row
      name={part.name}
      spec={part.spec}
      item={items.length ? rangeLines(items).join("; ") : null}
      none="Every size in your book"
      code={items.length ? sizes(items.length) : ""}
      from={suppliersWords(items.map((i) => i.supplierName)) ?? "Lowest price"}
      buy={least == null ? "" : items.length > 1 ? `from ${dollars(least)}` : dollars(least)}
      act={change}
    />
  );
}
