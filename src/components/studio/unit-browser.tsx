"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import type { DataPack, FormFactor, IndoorUnit, Phase } from "@/lib/studio/packs/schema";
import type { SizingBasis } from "@/lib/studio/loads";
import {
  unitOptions,
  formFactorSummary,
  OVERSIZE_CAP,
  type SelectFilters,
  type SelectSort,
  type UnitOption,
  type UnitFit,
} from "@/lib/studio/select";
import {
  COLUMN_SPECS,
  SPEC_GROUP_LABELS,
  specsInGroup,
  loadColumnIds,
  saveColumnIds,
  type SpecGroup,
  type UnitSpec,
} from "@/lib/studio/unit-specs";
import type { PairProposal } from "@/lib/studio/split";
import { DUCT_AIRWAY_FORMS } from "@/lib/studio/form-factors";
import { multiFormFactorSummary, multiUnitOptions } from "@/lib/studio/multi";

/* one unit staged for comparison — self-contained (brand + option + chosen
   pair) so the comparison survives brand switches and never re-reads a pack */
type CompareEntry = { key: string; brand: string; option: UnitOption; pair: PairProposal | null };

/* Unit browser (Stage 5 overhaul) — model-first selection: form factor tabs,
   the whole style on offer with what suits the load leading and everything
   else filed underneath (flagged oversized / undersized), a supply-phase
   filter, then fit filters (W×D×H, airflow) and sortable columns. Two panes: a lean table
   of indoor models on the left, and a detail panel on the right showing the
   highlighted option's full spec sheet — Indoor unit / Outdoor unit / Pairing
   — with the outdoor pairing picked there (phase badges), not in the row.
   Rendered through a PORTAL to body: the dashboard shell's .page transform
   breaks position:fixed for anything rendered inside it (see project modal
   rule). */

/** Required-capacity band (ducted AHU flow): a pair reads "in range" from the
    required figure up to ~135% of it — the same oversize spirit as the
    browser's 150% gate, tighter so the badge stays meaningful. */
export const REQUIRED_BAND_CAP = 1.35;

/** What a row commits to.

    The two system flows choose different things, and the modal has to hand
    back what was actually picked rather than flatten them: a split picks an
    indoor unit AND the outdoor it pairs with, while a multi picks only the
    indoor head — its outdoor is shared across every room and chosen once for
    the system, so there is no pairing to return here. */
export type UnitChoice =
  | { kind: "pair"; pair: PairProposal }
  | { kind: "idu"; idu: IndoorUnit };

/** How the browser is being driven.
    - "pair"     — split: rows are indoor units with their outdoor pairings.
    - "per-room" — multi/VRF: rows are multi-capable indoor heads, no pairing
                   column, and each room takes one. */
export type BrowserMode = "pair" | "per-room";

/** One table row, either flow. A per-room row has no pairing — see UnitChoice. */
type BrowserRow = {
  idu: IndoorUnit;
  /** capacity under the sizing basis: the pairing's in pair flow, the indoor
      unit's own in per-room flow */
  capacityKw: number;
  fit: UnitFit;
  bestFit: boolean;
  pairs: PairProposal[];
  defaultPair: PairProposal | null;
};

/** One room in the browser's right-hand column — the workflow's spine: draw
    every room first, then attribute a unit to each by dragging it onto the
    card. The column is also the ranking lens, the fallback attribution for a
    drop outside every room, and — via `served` — the placement progress. */
export type BrowserRoom = {
  id: string;
  name: string;
  /** floor area, null until the floor is calibrated */
  areaM2: number | null;
  loadKw: number | null;
  /** an indoor unit is already placed and attributed to this room */
  served: boolean;
  /** the indoor model attributed to this room — placed, or assigned and
      awaiting placement. Null when nothing has been attributed yet. */
  assignedModel: string | null;
  /** the outdoor it runs to. A split's is the room's own; a multi's is the
      SYSTEM's, shared by every room — `oduShared` says which, so the card can
      be honest rather than implying each room has its own. */
  oduModel?: string | null;
  oduShared?: boolean;
};

/** "ap35" finds MSZ-AP35VGD2: case, spaces and dashes never matter, and a
    series name finds its whole range */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export function unitMatchesQuery(u: IndoorUnit, query: string): boolean {
  const q = squash(query);
  return !q || squash(u.model).includes(q) || squash(u.series ?? "").includes(q);
}

/** The row's sizing flag. Nothing on a unit that suits the load — the
    Recommended heading already said so, and a chip on every row is noise. */
function FitChip({
  fit,
  loadKw,
  capacityKw,
}: {
  fit: UnitFit;
  loadKw: number | null;
  capacityKw: number;
}) {
  if (fit === "fits" || loadKw == null) return null;
  const pct = Math.round((capacityKw / loadKw) * 100);
  return fit === "undersized" ? (
    <em
      className="ds-ub-under"
      title={`${capacityKw.toFixed(1)} kW against a ${loadKw.toFixed(1)} kW load — ${pct}%, it won't hold the room`}
    >
      undersized
    </em>
  ) : (
    <em
      className="ds-ub-over"
      title={`${capacityKw.toFixed(1)} kW against a ${loadKw.toFixed(1)} kW load — ${pct}%`}
    >
      oversized
    </em>
  );
}

export function UnitBrowser({
  pack,
  loadKw,
  basis,
  onChoose,
  onClose,
  initialFormFactor,
  requiredKw,
  rooms,
  lensId,
  onLens,
  onAssign,
  mode = "pair",
  embedded = false,
  addLabel = "Add to plan",
  onDragRow,
  formFactor = null,
  onFormFactor,
  brandLocked = false,
  detailHost,
  addNote,
}: {
  pack: DataPack;
  loadKw: number | null;
  basis: SizingBasis;
  /** commit the chosen pairing (the host arms placement via its drag cards) */
  onChoose: (choice: UnitChoice) => void;
  /** close the window — never called when embedded, where the host owns it */
  onClose?: () => void;
  /** open on this form-factor tab while it has options (ducted AHU flow) */
  initialFormFactor?: FormFactor | null;
  /** highlight — never filter — pairs sized within REQUIRED_BAND_CAP of this */
  requiredKw?: number | null;
  /** the system's rooms, listed down the right-hand column: lens, fallback
      attribution, progress and drop target in one card (absent on hosts
      without rooms) */
  rooms?: BrowserRoom[];
  /** which card the ranking currently reads through */
  lensId?: string | null;
  /** re-aim the lens — the host re-ranks by handing back a new loadKw */
  onLens?: (roomId: string) => void;
  /** a unit was dragged onto a room card: attribute it to that room and STAY
      OPEN — the point of the column is attributing every room in one visit,
      with placement following afterwards. Absent = the column is read-only. */
  onAssign?: (choice: UnitChoice, roomId: string) => void;
  /** which flow is driving — see BrowserMode. Defaults to the split's. */
  mode?: BrowserMode;
  /** set inside another window (the system builder): no overlay and no title
      bar, and the keys are its own only while focus is inside it */
  embedded?: boolean;
  /** what the detail panel's button says it does */
  addLabel?: string;
  /** rows become drag sources for the HOST's drop targets: the host writes
      the choice into the transfer in its own format */
  onDragRow?: (choice: UnitChoice, transfer: DataTransfer) => void;
  /** the head type, held by the host (the builder's trail): the list shows
      this style and the tab strip is not drawn, the crumb being the tab */
  formFactor?: FormFactor | null;
  /** under a controlled head type, a search that finds nothing in it but
      something in another style asks the host to move the crumb there */
  onFormFactor?: (formFactor: FormFactor) => void;
  /** the system already has a unit of this brand, so the brand is locked:
      the brand reads as a dashed, locked control rather than a filter */
  brandLocked?: boolean;
  /** where the spec sheet goes. Absent, beside the list; an element, into
      the host's own column (the builder's right-hand side, full height);
      null, nowhere, while the host shows something else in that column */
  detailHost?: HTMLElement | null;
  /** a line over the Add button: what the unit does for where it goes */
  addNote?: (capacityKw: number) => string | null;
}) {
  const [filters, setFilters] = useState<SelectFilters>({});
  /** the search box — reaches every style, see `searched` */
  const [query, setQuery] = useState("");
  const q = squash(query);
  const [sort, setSort] = useState<SelectSort>("capacity");
  /** outdoor supply phase filter — null = any */
  const [phase, setPhase] = useState<Phase | null>(null);
  /** per-IDU chosen outdoor, keyed by ODU MODEL (indices shift when the phase
      filter narrows the pairs array — a model key can never silently swap) */
  const [oduPick, setOduPick] = useState<Record<string, string>>({});
  /** the highlighted row — the detail panel's subject */
  const [selected, setSelected] = useState<string | null>(null);
  /** group the table by product series (e.g. AP, EF) — an aid, toggleable off */
  const [groupBySeries, setGroupBySeries] = useState(true);
  /* A SERIES IS SHUT UNTIL IT IS ASKED FOR. Wall-mounted opens on PKFY, MSZ-AP
     and MSZ-LN rather than the eighty units inside them, so the styles are
     read at a glance and the sizes are read when a series is chosen. A search
     opens what it finds, because a search IS the asking. */
  const [openSeries, setOpenSeries] = useState<ReadonlySet<string>>(new Set());
  const seriesKey = (sectionKey: string, series: string) => `${sectionKey}::${series}`;
  const toggleSeries = (key: string) =>
    setOpenSeries((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  /** the model being dragged towards a room card, null at rest. Held so the
      column can show ITSELF as the destination while a unit is in flight —
      the affordance is the lit target, never a caption telling you to drag */
  const [dragModel, setDragModel] = useState<string | null>(null);
  /** the card the pointer is currently over, for the single lit target */
  const [dropRoomId, setDropRoomId] = useState<string | null>(null);
  /** the installer's chosen spec columns (persisted per-device) */
  const [columnIds, setColumnIds] = useState<string[]>(() => loadColumnIds());
  const toggleColumn = (id: string) =>
    setColumnIds((ids) => {
      const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
      saveColumnIds(next);
      return next;
    });

  /* comparison set — up to 3 units, captured with their brand + chosen pair so
     the side-by-side survives switching the browser to another brand (each
     entry is self-contained; the overlay never re-reads a pack) */
  const [compare, setCompare] = useState<CompareEntry[]>([]);
  /* COMPARING IS A MODE, NOT A COLUMN. A tick box on every row, always, made
     the one control on a draggable row a control for something else; and it
     asked a hundred rows to carry a question that is asked of two. Compare
     turns the mode on, the rows take their ticks, and leaving the mode with
     nothing picked puts the list back. */
  const [comparing, setComparing] = useState(false);
  const brandName =
    pack.brands.find((b) => b.id === pack.meta.brand)?.name ??
    pack.meta.name ??
    pack.meta.brand;
  const compareKey = (model: string) => `${brandName}::${model}`;
  const inCompare = (model: string) => compare.some((c) => c.key === compareKey(model));
  const COMPARE_MAX = 3;
  const endCompare = () => {
    setComparing(false);
    setCompare([]);
  };
  const toggleCompare = (o: BrowserRow, pair: PairProposal | null) =>
    setCompare((cur) => {
      const key = compareKey(o.idu.model);
      if (cur.some((c) => c.key === key)) return cur.filter((c) => c.key !== key);
      if (cur.length >= COMPARE_MAX) return cur; // capped
      return [...cur, { key, brand: brandName, option: o as unknown as UnitOption, pair }];
    });

  const perRoom = mode === "per-room";
  const tabs = useMemo(
    () =>
      perRoom
        ? multiFormFactorSummary(pack, loadKw, basis)
        : formFactorSummary(pack, loadKw, basis, phase),
    [perRoom, pack, loadKw, basis, phase]
  );

  /* A search reaches every style, not just the open tab: each tab counts
     the units that match (fits first, as ever), a tab with none goes quiet,
     and the table moves to a style that has one. Like the counts without a
     search, the size limits don't enter into it. */
  const searchedTabs = useMemo(() => {
    if (!q) return tabs;
    const rows = perRoom
      ? multiUnitOptions(pack, { loadKw, basis, formFactor: null })
      : unitOptions(pack, { loadKw, basis, formFactor: null, phase });
    const count = new Map<FormFactor, number>();
    const fitCount = new Map<FormFactor, number>();
    for (const r of rows) {
      if (!unitMatchesQuery(r.idu, q)) continue;
      const ff = r.idu.form_factor;
      count.set(ff, (count.get(ff) ?? 0) + 1);
      if (r.fit === "fits") fitCount.set(ff, (fitCount.get(ff) ?? 0) + 1);
    }
    return tabs.map((t) => ({
      ...t,
      count: count.get(t.formFactor) ?? 0,
      fitCount: fitCount.get(t.formFactor) ?? 0,
    }));
  }, [q, tabs, perRoom, pack, loadKw, basis, phase]);

  /** default tab: the caller's requested form factor, else the first tab
      (in prevalence order — wall-mounted leads) holding a clean fit, else
      the best-fit option's tab, else the first tab */
  const [tab, setTab] = useState<FormFactor | null>(initialFormFactor ?? null);
  const activeTab = useMemo(() => {
    /* a controlled tab is the host's crumb: the list shows that style and
       only the host moves it (a search that finds nothing in it asks the
       host to, see the search box) */
    if (formFactor != null) {
      return tabs.some((t) => t.formFactor === formFactor) ? formFactor : (tabs[0]?.formFactor ?? formFactor);
    }
    if (tab && searchedTabs.some((t) => t.formFactor === tab && t.count > 0)) return tab;
    if (q) {
      const hit = searchedTabs.find((t) => t.fitCount > 0) ?? searchedTabs.find((t) => t.count > 0);
      return hit?.formFactor ?? tab ?? tabs[0]?.formFactor ?? null;
    }
    /* Open where a person would look first. The old default followed the
       cross-form-factor best fit, but between two exact-capacity fits that
       winner is a ranking tiebreak — it once opened a bedroom split on Floor
       console because an MFZ pipped the identical-kW wall unit. The tab
       order already encodes what installers reach for; honour it. */
    const fit = tabs.find((t) => t.fitCount > 0);
    if (fit) return fit.formFactor;
    if (loadKw != null) {
      const all = perRoom
        ? multiUnitOptions(pack, { loadKw, basis })
        : unitOptions(pack, { loadKw, basis, formFactor: null, phase });
      const rec = all.find((o) => o.bestFit);
      if (rec) return rec.idu.form_factor;
    }
    return tabs[0]?.formFactor ?? null;
  }, [formFactor, tab, tabs, searchedTabs, q, pack, loadKw, basis, phase, perRoom]);

  /* One row shape, two sources. A pair row carries its outdoor pairings; a
     per-room row has none, because a multi's outdoor is chosen once for the
     system rather than per room. */
  const options = useMemo<BrowserRow[]>(() => {
    const rows: BrowserRow[] =
      perRoom
        ? multiUnitOptions(pack, {
            loadKw,
            basis,
            formFactor: activeTab,
            filters,
            sort,
          }).map((p) => ({
            idu: p.idu,
            capacityKw: p.capacityKw,
            fit: p.fit,
            bestFit: p.bestFit,
            pairs: [],
            defaultPair: null,
          }))
        : unitOptions(pack, {
            loadKw,
            basis,
            formFactor: activeTab,
            phase,
            filters,
            sort,
          }).map((o) => ({
            idu: o.idu,
            capacityKw: o.defaultPair.capacityKw,
            fit: o.fit,
            bestFit: o.bestFit,
            pairs: o.pairs,
            defaultPair: o.defaultPair,
          }));
    if (!q) return rows;
    /* Best fit is the smallest suiting unit ON SCREEN — a search that hides
       the style's best fit names the best of what it found */
    const hits = rows.filter((r) => unitMatchesQuery(r.idu, q));
    let best: BrowserRow | null = null;
    if (loadKw != null) {
      for (const r of hits) if (r.fit === "fits" && (!best || r.capacityKw < best.capacityKw)) best = r;
    }
    return hits.map((r) => ({ ...r, bestFit: r === best }));
  }, [perRoom, pack, loadKw, basis, activeTab, phase, filters, sort, q]);

  /* the airflow filter belongs to every ducted-airway form, not the "ducted"
     tab alone — bulkhead units are air-capable and carry the same figure */
  const isDucted =
    activeTab != null && DUCT_AIRWAY_FORMS.includes(activeTab);
  /* spec columns to show: the enabled set, in registry order, minus any that
     don't apply to this form factor (e.g. airflow off the ducted tab) */
  const activeSpecs = COLUMN_SPECS.filter(
    (s) =>
      columnIds.includes(s.id) &&
      (!s.only || (activeTab != null && s.only.includes(activeTab))) &&
      /* per-room has no outdoor and no pairing to describe — those columns
         would have nothing to read from (see BrowserRow) */
      (!perRoom || s.group === "idu")
  );
  /* the specs offered in the Columns menu for THIS tab (hide inapplicable ones) */
  const menuSpecs = COLUMN_SPECS.filter(
    (s) =>
      (!s.only || (activeTab != null && s.only.includes(activeTab))) &&
      (!perRoom || s.group === "idu")
  );
  /* compare + Model + specs, then the capacity a per-room row is judged on
     or the pair row's Outdoor: three fixed columns either way */
  const colSpan = 3 + activeSpecs.length;

  /** the option's outdoor pairing: the picked model if it still qualifies
      under the current filters, else the first surviving pairing */
  const pairFor = (o: BrowserRow): PairProposal | null =>
    o.pairs.find((p) => p.odu.model === oduPick[o.idu.model]) ?? o.defaultPair;

  const inRequiredBand = (p: PairProposal | null): boolean =>
    p != null &&
    requiredKw != null &&
    p.capacityKw >= requiredKw &&
    p.capacityKw <= requiredKw * REQUIRED_BAND_CAP;

  /* group same-series rows adjacently, preserving the sorted order within each
     group and ordering groups by first appearance (keeps the best-fit unit's
     series near the top). Headers only make sense with 2+ series. */
  const seriesGroups = (items: BrowserRow[]) => {
    const order: string[] = [];
    const bySeries = new Map<string, BrowserRow[]>();
    for (const o of items) {
      const s = o.idu.series || "Other";
      if (!bySeries.has(s)) {
        bySeries.set(s, []);
        order.push(s);
      }
      bySeries.get(s)!.push(o);
    }
    return order.map((series) => ({ series, items: bySeries.get(series)! }));
  };

  /* Sections: what suits the load leads, the rest files underneath in fit
     order (oversized, then undersized). Recommended shows even when it's
     empty — "nothing here fits" is the answer that sends you to another tab,
     and it can only be read if the section is on screen. Without a load
     there's nothing to rank against, so it stays one plain list. */
  const sections = useMemo(() => {
    const build = (key: string, title: string | null, hint: string | null, items: BrowserRow[]) => {
      const groups = seriesGroups(items);
      const grouped = groupBySeries && groups.length > 1;
      return {
        key,
        title,
        hint,
        groups,
        grouped,
        items: grouped ? groups.flatMap((g) => g.items) : items,
      };
    };
    if (loadKw == null) return [build("all", null, null, options)];
    const pick = (f: UnitFit) => options.filter((o) => o.fit === f);
    const out = [
      build(
        "fits",
        "Recommended",
        `Covers ${loadKw.toFixed(1)} kW without over-sizing past ${Math.round(OVERSIZE_CAP * 100)}%`,
        pick("fits")
      ),
    ];
    /* Oversized and undersized get a heading each, not one "other" bucket:
       they're opposite mistakes. Oversized is a judgement call you might
       still make (short-cycling, cost); undersized won't hold the room on a
       design day at all. Rolling them together read as one pile of rejects. */
    const over = pick("oversized");
    const under = pick("undersized");
    if (over.length)
      out.push(
        build(
          "over",
          "Oversized",
          `More than ${Math.round(OVERSIZE_CAP * 100)}% of the ${loadKw.toFixed(1)} kW load — short-cycles and costs more`,
          over
        )
      );
    if (under.length)
      out.push(
        build(
          "under",
          "Undersized",
          `Under the ${loadKw.toFixed(1)} kW load — won't hold the room on a design day`,
          under
        )
      );
    return out;
  }, [options, loadKw, groupBySeries]);

  /* WHETHER ANY ROW IS ON SCREEN. With every series shut there is nothing
     under the headings, and a row of column names over a list of five doors
     names columns nobody can see — so the header waits for the first series
     to open. */
  const anyRowsShown = sections.some(
    (s) =>
      s.items.length > 0 &&
      (!s.grouped ||
        Boolean(q) ||
        s.groups.some((g) => openSeries.has(seriesKey(s.key, g.series))))
  );

  /** the Group-by-series control only earns its place where it'd do something */
  const canGroup = sections.some((s) => s.groups.length > 1);

  /* rows in on-screen order (sections + series grouping reorder) — keyboard
     nav + the selection fallback both follow what the installer actually sees */
  const visibleOptions = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  /** the row the detail panel shows: the clicked one while it survives the
      current filters, else the best-fit row, else the first row */
  const selectedOption = useMemo(() => {
    return (
      visibleOptions.find((o) => o.idu.model === selected) ??
      visibleOptions.find((o) => o.bestFit) ??
      visibleOptions[0] ??
      null
    );
  }, [visibleOptions, selected]);

  /** what a row commits to — a pairing in the split flow, the indoor head
      alone in per-room (its outdoor belongs to the system, not the room) */
  const choiceFor = (o: BrowserRow): UnitChoice | null => {
    if (perRoom) return { kind: "idu", idu: o.idu };
    const pair = pairFor(o);
    return pair ? { kind: "pair", pair } : null;
  };

  const choose = (o: BrowserRow) => {
    const choice = choiceFor(o);
    if (choice) onChoose(choice);
  };

  /* Add straight from a comparison column (uses that entry's captured pair) */
  const chooseEntry = (e: CompareEntry) =>
    onChoose(e.pair ? { kind: "pair", pair: e.pair } : { kind: "idu", idu: e.option.idu });

  const onKey = (e: KeyboardEvent) => {
    if (comparing) return; // the compare overlay owns the keys while open
    if (e.key === "Escape") {
      // embedded, Escape belongs to the window around it
      if (!embedded) onClose?.();
      return;
    }
    const t = e.target as HTMLElement | null;
    /* a focused button answers Enter itself — embedded, the browser sits
       among the host's buttons */
    if (t && (embedded ? /^(INPUT|SELECT|TEXTAREA|BUTTON)$/ : /^(INPUT|SELECT|TEXTAREA)$/).test(t.tagName))
      return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((cur) => {
        const list = visibleOptions;
        if (!list.length) return cur;
        const curModel =
          cur && list.some((o) => o.idu.model === cur)
            ? cur
            : (list.find((o) => o.bestFit) ?? list[0]).idu.model;
        const idx = list.findIndex((o) => o.idu.model === curModel);
        const next =
          list[Math.min(list.length - 1, Math.max(0, idx + (e.key === "ArrowDown" ? 1 : -1)))];
        return next.idu.model;
      });
    } else if (e.key === "Enter" && selectedOption) {
      e.preventDefault();
      choose(selectedOption);
    }
  };
  useEffect(() => {
    if (embedded) return;
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* Under a controlled head type a search still reaches every style: when
     the style on the crumb has no match and another has, the host is asked
     to move the crumb there, the way the tab strip moves itself. Asked from
     the search box, as it is typed, never worked out afterwards. */
  const followSearch = (value: string) => {
    if (formFactor == null || !onFormFactor) return;
    const qq = squash(value);
    if (!qq) return;
    const rows = perRoom
      ? multiUnitOptions(pack, { loadKw, basis, formFactor: null })
      : unitOptions(pack, { loadKw, basis, formFactor: null, phase });
    const hits = rows.filter((r) => unitMatchesQuery(r.idu, qq));
    if (hits.some((r) => r.idu.form_factor === activeTab)) return;
    const to =
      tabs.find((t) => hits.some((r) => r.idu.form_factor === t.formFactor && r.fit === "fits")) ??
      tabs.find((t) => hits.some((r) => r.idu.form_factor === t.formFactor));
    if (to) onFormFactor(to.formFactor);
  };

  /* attribution by drag is offered only when there is a column to drop onto
     AND a host willing to record it */
  const hasRooms = !!rooms && rooms.length > 0;
  const canAssign = hasRooms && !!onAssign;
  const canDrag = canAssign || !!onDragRow;

  const numInput = (key: keyof SelectFilters, placeholder: string) => (
    <input
      inputMode="numeric"
      placeholder={placeholder}
      value={filters[key] ?? ""}
      onChange={(e) => {
        const v = parseInt(e.target.value, 10);
        setFilters((f) => ({ ...f, [key]: Number.isFinite(v) ? v : undefined }));
      }}
    />
  );

  const renderRow = (o: BrowserRow) => {
    const pair = pairFor(o);
    const checked = inCompare(o.idu.model);
    const isSel = selectedOption?.idu.model === o.idu.model;
    const band = inRequiredBand(pair);
    return (
      <tr
        key={o.idu.model}
        className={`${o.bestFit ? "rec" : ""}${isSel ? " sel" : ""}${band ? " band" : ""}${
          o.fit !== "fits" ? ` ${o.fit}` : ""
        }${canDrag ? " drag" : ""}`}
        aria-selected={isSel}
        onClick={() => setSelected(o.idu.model)}
        /* a row is the drag SOURCE for attribution; without a rooms column to
           drop onto there is nothing to drag to, so it stays inert */
        draggable={canDrag}
        onDragStart={(e) => {
          if (!canDrag) return;
          /* the row is the subject of the drag — highlight it in the table
             the same way the detail panel would */
          setSelected(o.idu.model);
          /* the row in flight is held before the host is told, so the
             browser's own record of the drag never lags the host's drop */
          setDragModel(o.idu.model);
          if (onDragRow) {
            const choice = choiceFor(o);
            if (choice && e.dataTransfer) onDragRow(choice, e.dataTransfer);
            return;
          }
          if (e.dataTransfer) {
            e.dataTransfer.setData("text/plain", o.idu.model);
            e.dataTransfer.effectAllowed = "copy";
          }
        }}
        onDragEnd={() => {
          setDragModel(null);
          setDropRoomId(null);
        }}
      >
        {/* compare is universal: a pair row compares its pairing, a per-room
            row the head alone, since its outdoor belongs to the system */}
        {comparing && (perRoom || pair) && (
          <td className="ds-ub-cmpcell" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={checked}
              disabled={!checked && compare.length >= COMPARE_MAX}
              onChange={() => toggleCompare(o, pair)}
              aria-label={`Compare ${o.idu.model}`}
              title={
                !checked && compare.length >= COMPARE_MAX
                  ? `Comparing ${COMPARE_MAX} — remove one first`
                  : "Add to comparison"
              }
            />
          </td>
        )}
        <td className="ds-ub-model">
          {/* the row IS the drag — the grip says so, the same mark the rack
              under the system card uses for the same gesture. The checkbox
              beside it is Compare, and was the only control on the row, so a
              draggable row read as a row you tick. */}
          {canDrag && (
            <svg className="ds-ub-grip" width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
              <circle cx="3" cy="4" r="1.4" />
              <circle cx="7" cy="4" r="1.4" />
              <circle cx="3" cy="8" r="1.4" />
              <circle cx="7" cy="8" r="1.4" />
              <circle cx="3" cy="12" r="1.4" />
              <circle cx="7" cy="12" r="1.4" />
            </svg>
          )}
          {o.idu.model}
          {o.bestFit && <em>Best fit</em>}
          <FitChip fit={o.fit} loadKw={loadKw} capacityKw={o.capacityKw} />
          {band && !o.bestFit && (
            <em className="ds-ub-inband" title="Within the required capacity band">
              In range
            </em>
          )}
        </td>
        {/* the capacity a per-room row is judged on. In pair flow the same
            figure arrives as the "Cooling / heating" pairing column. */}
        {perRoom && <td className="ds-ub-capcell">{o.capacityKw.toFixed(1)} kW</td>}
        {activeSpecs.map((s) => (
          <td key={s.id}>{s.cell(o as unknown as UnitOption, pair)}</td>
        ))}
        {!perRoom && pair && (
          <td className="ds-ub-oducell">
            <span className="ds-ub-odu">{pair.odu.model}</span>
            <PhaseBadge phase={pair.odu.phase} />
            {o.pairs.length > 1 && (
              <span
                className="ds-ub-morepairs"
                title={`${o.pairs.length - 1} more outdoor pairing${o.pairs.length > 2 ? "s" : ""} — pick in the panel`}
              >
                +{o.pairs.length - 1}
              </span>
            )}
          </td>
        )}
      </tr>
    );
  };

  const powerSeg = (
    <div className="ds-ub-powerseg" role="group" aria-label="Power">
      <span className="ds-ub-seglabel">Power</span>
      <button
        className={phase === null ? "on" : ""}
        onClick={() => setPhase(null)}
        title="Any supply phase"
      >
        Any
      </button>
      <button
        className={phase === "1" ? "on" : ""}
        onClick={() => setPhase("1")}
        title="Single phase outdoor units only"
      >
        1φ
      </button>
      <button
        className={phase === "3" ? "on" : ""}
        onClick={() => setPhase("3")}
        title="Three phase outdoor units only"
      >
        3φ
      </button>
    </div>
  );

  const detail = (
    <aside className="ds-ub-detail">
      {selectedOption ? (
        <DetailPanel
          option={selectedOption as unknown as UnitOption}
          pair={pairFor(selectedOption)}
          loadKw={loadKw}
          capacityKw={selectedOption.capacityKw}
          onPickOdu={(oduModel) =>
            setOduPick((m) => ({ ...m, [selectedOption.idu.model]: oduModel }))
          }
          onAdd={() => choose(selectedOption)}
          addLabel={addLabel}
          addNote={addNote?.(selectedOption.capacityKw) ?? null}
        />
      ) : (
        <div className="ds-ub-dempty">Select a unit to see its full spec sheet.</div>
      )}
    </aside>
  );

  const panel = (
    <div
      className={`ds-ub${embedded ? " embedded" : ""}`}
      role={embedded ? "region" : "dialog"}
      aria-modal={embedded ? undefined : true}
      aria-label="Choose a unit"
      onKeyDown={embedded ? (e) => onKey(e.nativeEvent) : undefined}
    >
      {!embedded && (
        <header className="ds-ub-head">
          <div className="ds-ub-title">
            <b>Choose a unit</b>
            {loadKw != null ? (
              <span>
                {requiredKw != null ? "Requires" : "Room load"} ≈ <b>{loadKw.toFixed(1)} kW</b>{" "}
               , {basis}
              </span>
            ) : (
              <span>No room selected — full catalogue</span>
            )}
          </div>
          {powerSeg}
          <button className="ds-ub-close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </header>
      )}

      {formFactor == null && (
      <nav className="ds-ub-tabs">
        {searchedTabs.map((t) => (
          <button
            key={t.formFactor}
            className={t.formFactor === activeTab ? "on" : ""}
            disabled={t.count === 0}
            onClick={() => setTab(t.formFactor)}
            title={
              loadKw == null
                ? `${t.count} ${t.label.toLowerCase()} unit${t.count === 1 ? "" : "s"}`
                : `${t.fitCount} of ${t.count} suit a ${loadKw.toFixed(1)} kW load`
            }
          >
            {t.label}
            {/* the fit count leads — it's the number you're shopping on —
                with the full catalogue count behind it so an empty tab still
                reads as "there are units here, none of them suit" */}
            {loadKw != null ? (
              <span className={`ds-ub-count${t.fitCount === 0 ? " none" : " fit"}`}>
                {t.fitCount}
                <i>/{t.count}</i>
              </span>
            ) : (
              <span className="ds-ub-count">{t.count}</span>
            )}
          </button>
        ))}
      </nav>
      )}

      <div className="ds-ub-filters">
        {/* the brand is a filter, not a fork: one pack, so one name, drawn
            locked once the system has a unit of it */}
        {embedded && (
          <span className={`ds-ub-brand${brandLocked ? " locked" : ""}`}>{brandName}</span>
        )}
        <input
          type="search"
          className="ds-ub-search"
          placeholder="Search models"
          aria-label="Search units"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            followSearch(e.target.value);
          }}
        />
        <span className="ds-ub-flabel">Fits within</span>
        <label>W ≤ {numInput("maxWidthMm", "mm")}</label>
        <label>D ≤ {numInput("maxDepthMm", "mm")}</label>
        <label>H ≤ {numInput("maxHeightMm", "mm")}</label>
        {isDucted && <label>Airflow ≥ {numInput("minAirflowLs", "L/s")}</label>}
        {Object.values(filters).some((v) => v != null) && (
          <button className="ds-ub-reset" onClick={() => setFilters({})}>
            Reset
          </button>
        )}
        {/* embedded there is no title bar to carry Power; a multi head
            has no outdoor of its own, so no supply to filter on */}
        {embedded && !perRoom && <span className="ds-ub-fright">{powerSeg}</span>}
      </div>

      {/* WHAT IS IN THE LIST above, HOW IT IS SHOWN here. The two jobs shared
          one row, so a tick box sat between a height filter and a menu and
          belonged to neither, and at narrow widths the row wrapped them into
          a heap. Shaping the list reads left to right: how it is grouped,
          then the two things that change what a row carries. */}
      <div className="ds-ub-view">
        {canGroup && (
          <label className="ds-ub-groupby">
            <input
              type="checkbox"
              checked={groupBySeries}
              onChange={(e) => setGroupBySeries(e.target.checked)}
            />
            Group by series
          </label>
        )}
        <span className="ds-ub-vspring" />
        <button
          className={`ds-ub-cmpmode${comparing ? " on" : ""}`}
          aria-pressed={comparing}
          onClick={() => (comparing ? endCompare() : setComparing(true))}
        >
          Compare
        </button>
        <ColumnsMenu specs={menuSpecs} enabled={columnIds} onToggle={toggleColumn} />
      </div>

      <div className="ds-ub-body">
        <div className="ds-ub-main">
          {/* embedded, the list takes focus so its keys stay its own */}
          <div className="ds-ub-scroll" tabIndex={embedded ? 0 : undefined}>
            <table className="ds-ub-table">
              <thead hidden={!anyRowsShown}>
                <tr>
                  {comparing && <th className="ds-ub-cmpcol" aria-label="Compare" />}
                  <th>Model</th>
                  {perRoom && <th>Cooling</th>}
                  {activeSpecs.map((s) =>
                    s.sortKey ? (
                      <th
                        key={s.id}
                        className={`sortable${sort === s.sortKey ? " on" : ""}`}
                        onClick={() => setSort(s.sortKey!)}
                        title={`Sort by ${s.label.toLowerCase()}`}
                      >
                        {s.header}
                        {sort === s.sortKey && (
                          <span className="ds-ub-sortmark">
                            {s.sortKey === "airflow" ? "↓" : "↑"}
                          </span>
                        )}
                      </th>
                    ) : (
                      <th key={s.id}>{s.header}</th>
                    )
                  )}
                  {!perRoom && <th>Outdoor</th>}
                </tr>
              </thead>
              <tbody>
                {/* with nothing at all in the tab the sections would just be
                    two empty headings — the single message below says it */}
                {(options.length === 0 ? [] : sections).flatMap((s) => [
                  ...(s.title
                    ? [
                        <tr key={`sec-${s.key}`} className={`ds-ub-sec ds-ub-sec-${s.key}`}>
                          <td colSpan={colSpan}>
                            <b>{s.title}</b>
                            <span className="ds-ub-count">{s.items.length}</span>
                            {s.hint && <span className="ds-ub-sechint">{s.hint}</span>}
                          </td>
                        </tr>,
                      ]
                    : []),
                  ...(s.items.length === 0
                    ? [
                        <tr key={`sec-${s.key}-none`}>
                          <td colSpan={colSpan} className="ds-ub-none">
                            {Object.values(filters).some((v) => v != null)
                              ? "Nothing in this style suits the load at these sizes — loosen a fit limit, or take one from below."
                              : "Nothing in this style suits the load — try another style, or take one from below."}
                          </td>
                        </tr>,
                      ]
                    : s.grouped
                      ? s.groups.flatMap((g) => {
                          const key = seriesKey(s.key, g.series);
                          /* a search has already narrowed the list to what was
                             asked for, so its groups open themselves */
                          const open = Boolean(q) || openSeries.has(key);
                          return [
                            <tr
                              key={`grp-${s.key}-${g.series}`}
                              className={`ds-ub-group${open ? " open" : ""}`}
                            >
                              <td colSpan={colSpan}>
                                <button
                                  type="button"
                                  aria-expanded={open}
                                  onClick={() => toggleSeries(key)}
                                >
                                  <svg
                                    className="ds-ub-caret"
                                    width="10"
                                    height="10"
                                    viewBox="0 0 16 16"
                                    aria-hidden="true"
                                  >
                                    <path
                                      d="M6 3l6 5-6 5"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                  {g.series}
                                  <span className="ds-ub-groupn">{g.items.length}</span>
                                </button>
                              </td>
                            </tr>,
                            ...(open ? g.items.map(renderRow) : []),
                          ];
                        })
                      : s.items.map(renderRow)),
                ])}
                {options.length === 0 && (
                  <tr>
                    <td colSpan={colSpan} className="ds-ub-none">
                      {q && !searchedTabs.some((t) => t.count > 0)
                        ? `No unit matches ${query.trim()}`
                        : phase != null
                          ? `No ${phase === "3" ? "three" : "single"}-phase pairings match — set Power to Any or loosen a filter.`
                          : "Nothing matches these filters — loosen a limit."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {detailHost === undefined
          ? detail
          : detailHost
            ? createPortal(detail, detailHost)
            : null}

        {/* ── the rooms column: every room on the system, with the size and
            load you are shopping against. Clicking a card aims the ranking
            lens at it; dragging a unit onto it attributes the unit to that
            room WITHOUT closing — the flow is attribute-everything-then-
            place, so the modal has to survive the whole round. ── */}
        {hasRooms && (
          <aside
            className={`ds-ub-roomcol${dragModel ? " arming" : ""}`}
            aria-label="Rooms on this system"
          >
            <header className="ds-ub-rchead">
              Rooms
              <span>{rooms!.length}</span>
            </header>
            <div className="ds-ub-rclist">
              {rooms!.map((r) => {
                const isLens = r.id === lensId;
                const isTarget = canAssign && dragModel != null;
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={`ds-ub-rcard${isLens ? " on" : ""}${
                      r.served ? " served" : ""
                    }${r.assignedModel ? " has" : ""}${isTarget ? " target" : ""}${
                      isTarget && r.id === dropRoomId ? " over" : ""
                    }`}
                    aria-pressed={isLens}
                    onClick={() => onLens?.(r.id)}
                    onDragOver={(e) => {
                      if (!isTarget) return;
                      /* preventDefault is what MAKES this a drop target —
                         without it the browser refuses the drop silently */
                      e.preventDefault();
                      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
                      setDropRoomId(r.id);
                    }}
                    onDragLeave={() =>
                      setDropRoomId((cur) => (cur === r.id ? null : cur))
                    }
                    onDrop={(e) => {
                      if (!isTarget) return;
                      e.preventDefault();
                      const model = e.dataTransfer?.getData("text/plain") || dragModel;
                      const opt = options.find((o) => o.idu.model === model);
                      setDragModel(null);
                      setDropRoomId(null);
                      const choice = opt ? choiceFor(opt) : null;
                      if (choice) onAssign!(choice, r.id);
                    }}
                    title={
                      r.loadKw != null
                        ? `${r.name} — needs ≈${r.loadKw.toFixed(1)} kW`
                        : `${r.name} — calibrate the floor to size it`
                    }
                  >
                    <span className="ds-ub-rcname">
                      {r.name}
                      {r.served && <Icon name="check" size={11} />}
                    </span>
                    <span className="ds-ub-rcfig">
                      {r.areaM2 != null && <b>{r.areaM2.toFixed(1)} m²</b>}
                      {r.loadKw != null && <i>{r.loadKw.toFixed(1)} kW</i>}
                    </span>
                    {/* the slot is the affordance: empty and dashed it reads
                        as somewhere a unit goes, with no caption saying so */}
                    <span className="ds-ub-rcslot">
                      {r.assignedModel ?? ""}
                    </span>
                    {/* the outdoor it runs to — a room's pairing is only
                        half-told by its indoor head */}
                    {r.assignedModel && r.oduModel && (
                      <span className="ds-ub-rcodu">
                        <i>{r.oduShared ? "shared outdoor" : "outdoor"}</i>
                        {r.oduModel}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </aside>
        )}
      </div>

      {compare.length > 0 && (
        <div className="ds-ub-cmpbar">
          <div className="ds-ub-cmpchips">
            <span className="ds-ub-cmplabel">Compare</span>
            {compare.map((c) => (
              <span key={c.key} className="ds-ub-cmpchip">
                {c.option.idu.model}
                <button
                  aria-label={`Remove ${c.option.idu.model} from comparison`}
                  onClick={() =>
                    setCompare((cur) => cur.filter((x) => x.key !== c.key))
                  }
                >
                  <Icon name="x" size={11} />
                </button>
              </span>
            ))}
          </div>
          <button className="ds-ub-cmpclear" onClick={endCompare}>
            Clear
          </button>
          <button
            className="ds-ub-cmpgo"
            disabled={compare.length < 2}
            onClick={() => setComparing(true)}
          >
            Compare {compare.length}
          </button>
        </div>
      )}
    </div>
  );

  const compareOverlay = comparing && (
    <CompareOverlay
      entries={compare}
      onAdd={chooseEntry}
      onRemove={(key) => setCompare((cur) => cur.filter((x) => x.key !== key))}
      onClose={() => setComparing(false)}
    />
  );

  if (embedded) {
    return (
      <>
        {panel}
        {compareOverlay}
      </>
    );
  }
  return createPortal(
    <div className="ds-ub-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      {panel}
      {compareOverlay}
    </div>,
    document.body
  );
}

/* supply-phase pill — 1φ neutral, 3φ amber so a three-phase unit is never
   mistaken for the common single-phase case */
function PhaseBadge({ phase }: { phase: Phase }) {
  return (
    <span
      className={`ds-ub-phase${phase === "3" ? " p3" : ""}`}
      title={phase === "3" ? "Three phase" : "Single phase"}
    >
      {phase === "3" ? "3φ" : "1φ"}
    </span>
  );
}

/* outdoor pairing picker — the qualifying outdoor units for one indoor model,
   radio semantics, each with its phase badge, capacity and max run */
function OduPicker({
  option,
  pickedModel,
  onPick,
}: {
  option: UnitOption;
  pickedModel: string;
  onPick: (oduModel: string) => void;
}) {
  return (
    <div
      className="ds-ub-odupick"
      role="radiogroup"
      aria-label={`Outdoor unit for ${option.idu.model}`}
    >
      {option.pairs.map((p) => {
        const on = p.odu.model === pickedModel;
        return (
          <button
            key={p.odu.model}
            role="radio"
            aria-checked={on}
            className={`ds-ub-oduopt${on ? " on" : ""}`}
            onClick={() => onPick(p.odu.model)}
          >
            <span className="ds-ub-oduname">
              <b>{p.odu.model}</b>
              <PhaseBadge phase={p.odu.phase} />
            </span>
            <span className="ds-ub-odumeta">
              {p.coolKw} / {p.heatKw} kW, max {p.pair.max_length_m} m
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* detail panel — the highlighted option's full spec sheet, every value
   attributed: Indoor unit / Outdoor unit / Pairing sections straight from the
   spec registry (single source of truth with the table + comparer) */
function DetailPanel({
  option,
  pair,
  loadKw,
  capacityKw,
  onPickOdu,
  onAdd,
  addLabel,
  addNote = null,
}: {
  option: UnitOption;
  /** null in per-room flow: the outdoor is the SYSTEM's, chosen once, so the
      sheet shows the indoor unit alone rather than half-filled pairing rows */
  pair: PairProposal | null;
  /** the load the flag is measured against — null under the full catalogue */
  loadKw: number | null;
  /** capacity the fit flag is measured on — the pairing's, or the head's own */
  capacityKw: number;
  onPickOdu: (oduModel: string) => void;
  onAdd: () => void;
  addLabel: string;
  addNote?: string | null;
}) {
  const rows = (group: SpecGroup) =>
    specsInGroup(group).map((s) => (
      <div key={s.id} className="ds-ub-drow">
        <span className="ds-ub-dlabel">{s.label}</span>
        <span className="ds-ub-dval">{s.cell(option, pair)}</span>
      </div>
    ));

  return (
    <div className="ds-ub-dwrap">
      <div className="ds-ub-dscroll">
        <div className="ds-ub-dhead">
          <b>{option.idu.model}</b>
          {option.bestFit && <em>Best fit</em>}
          {/* the flag follows the unit into the panel — the last screen before
              Add is where a wrong size most needs to still be saying so */}
          <FitChip fit={option.fit} loadKw={loadKw} capacityKw={capacityKw} />
          <span className="ds-ub-dseries">{option.idu.series}</span>
        </div>

        <section className="ds-ub-dsec">
          <h4 className="ds-ub-dsech">{SPEC_GROUP_LABELS.idu}</h4>
          {rows("idu")}
        </section>

        {pair && (
          <>
            <section className="ds-ub-dsec">
              <h4 className="ds-ub-dsech">
                {SPEC_GROUP_LABELS.odu}
                <PhaseBadge phase={pair.odu.phase} />
              </h4>
              <OduPicker option={option} pickedModel={pair.odu.model} onPick={onPickOdu} />
              {rows("odu")}
            </section>

            <section className="ds-ub-dsec">
              <h4 className="ds-ub-dsech">{SPEC_GROUP_LABELS.pair}</h4>
              {rows("pair")}
            </section>
          </>
        )}
      </div>

      <div className="ds-ub-addbar">
        {addNote && <p className="ds-ub-addnote">{addNote}</p>}
        <button
          className="ds-ub-addbtn"
          onClick={onAdd}
          title={pair ? `Add ${option.idu.model} + ${pair.odu.model}` : `Add ${option.idu.model}`}
        >
          {addLabel}
        </button>
      </div>
    </div>
  );
}

/* Comparison overlay — up to 3 units side by side, every spec as a row (the
   full superset, not just the visible columns) partitioned into Indoor unit /
   Outdoor unit / Pairing sections, best-in-row highlighted. Units can come
   from different brands. Portalled over the browser. */
function CompareOverlay({
  entries,
  onAdd,
  onRemove,
  onClose,
}: {
  entries: CompareEntry[];
  onAdd: (e: CompareEntry) => void;
  onRemove: (key: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* a per-room head has no pairing: the outdoor and pairing bands are drawn
     only while some column has one to read */
  const anyPair = entries.some((e) => e.pair != null);
  const specRow = (s: UnitSpec) => {
    const vals = entries.map((e) => (s.numeric ? s.numeric(e.option, e.pair) : null));
    const nums = vals.filter((v): v is number => v != null);
    const best =
      s.better && nums.length > 1
        ? s.better === "higher"
          ? Math.max(...nums)
          : Math.min(...nums)
        : null;
    return (
      <tr key={s.id}>
        <th className="ds-cmp-rowh">
          {s.label}
          {s.unit && <span className="ds-cmp-unit"> {s.unit}</span>}
        </th>
        {entries.map((e, i) => (
          <td key={e.key} className={best != null && vals[i] === best ? "best" : ""}>
            {s.cell(e.option, e.pair)}
          </td>
        ))}
      </tr>
    );
  };

  const groupBand = (label: string) => (
    <tr className="ds-cmp-group">
      <td colSpan={entries.length + 1}>{label}</td>
    </tr>
  );

  return createPortal(
    <div
      className="ds-cmp-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="ds-cmp" role="dialog" aria-modal="true" aria-label="Compare units">
        <header className="ds-cmp-head">
          <b>Compare units</b>
          <button className="ds-ub-close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="ds-cmp-scroll">
          <table className="ds-cmp-table">
            <thead>
              <tr>
                <th />
                {entries.map((e) => (
                  <th key={e.key}>
                    <div className="ds-cmp-model">{e.option.idu.model}</div>
                    <div className="ds-cmp-brand">{e.brand}</div>
                    <button
                      className="ds-cmp-rm"
                      onClick={() => onRemove(e.key)}
                      aria-label={`Remove ${e.option.idu.model}`}
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groupBand(SPEC_GROUP_LABELS.idu)}
              {specsInGroup("idu").map(specRow)}

              {anyPair && (
                <>
                  {groupBand(SPEC_GROUP_LABELS.odu)}
                  <tr>
                    <th className="ds-cmp-rowh">Model</th>
                    {entries.map((e) => (
                      <td key={e.key}>
                        {e.pair ? (
                          <>
                            <span className="ds-cmp-odumodel">{e.pair.odu.model}</span>{" "}
                            <PhaseBadge phase={e.pair.odu.phase} />
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    ))}
                  </tr>
                  {specsInGroup("odu").map(specRow)}

                  {groupBand(SPEC_GROUP_LABELS.pair)}
                  {specsInGroup("pair").map(specRow)}
                </>
              )}

              <tr className="ds-cmp-addrow">
                <th />
                {entries.map((e) => (
                  <td key={e.key}>
                    <button className="ds-ub-place" onClick={() => onAdd(e)}>
                      Add
                    </button>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* Columns menu — the installer picks which spec columns they want in front of
   them, grouped by what the value describes (indoor / outdoor / pairing); the
   choice persists per-device (see unit-specs.ts). */
function ColumnsMenu({
  specs,
  enabled,
  onToggle,
}: {
  specs: UnitSpec[];
  enabled: string[];
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="ds-ub-cols" ref={boxRef}>
      <button
        className="ds-ub-colsbtn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Choose which spec columns to show"
      >
        <Icon name="settings2" size={14} />
        Columns
        <Icon name="chevD" size={12} />
      </button>
      {open && (
        <div className="ds-ub-colsmenu" role="menu">
          <div className="ds-ub-colshead">Show columns</div>
          {(Object.keys(SPEC_GROUP_LABELS) as SpecGroup[]).map((g) => {
            const inGroup = specs.filter((s) => s.group === g);
            if (!inGroup.length) return null;
            return (
              <div key={g} className="ds-ub-colsgroup" role="group" aria-label={SPEC_GROUP_LABELS[g]}>
                <div className="ds-ub-colsghead">{SPEC_GROUP_LABELS[g]}</div>
                {inGroup.map((s) => (
                  <label key={s.id} className="ds-ub-colsitem">
                    <input
                      type="checkbox"
                      checked={enabled.includes(s.id)}
                      onChange={() => onToggle(s.id)}
                    />
                    <span className="ds-ub-colsname">{s.label}</span>
                    {s.unit && <span className="ds-ub-colsunit">{s.unit}</span>}
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
