"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button, IconButton } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Fade } from "@/components/parts/fade";
import { TextInput } from "@/components/parts/field";
import { useFloat, useOutsidePress } from "@/components/parts/float";
import { Tick } from "@/components/parts/tick";
import { Tooltip } from "@/components/parts/tooltip";
import { Icon } from "@/components/shell/icon";
import { Waiting } from "@/components/ui/orb";
import { useDictation } from "@/components/notes/dictation";
import { fmtAud } from "@/lib/workboard/project-money";
import { splitSpokenList } from "@/lib/workboard/spoken-materials";
import { onShelves } from "@/lib/workboard/material-shelves";
import type { MaterialHit } from "@/app/api/workboard/material-search/route";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { groupChecklist, type JobChecklistItem } from "@/lib/workboard/all-jobs";
import { naiveInZone } from "@/lib/workboard/job-story";
import type { JobPicklistItem } from "@/app/actions/job-picklist";

/* MATERIALS — the job's own list, OURS AND WRITABLE: the van's pick list,
   ticked as it's loaded (Isaac, 25 October 2026; it was the Checklist).
   Every row anyone ever put on it was a material, so the To do kind left
   the screen; a job's tasks live on Visits. The data keeps its `kind`.

   The rows sit on the price book's own shelves, each shelf a box of its
   own, and the boxes flow down three columns with no gaps (his words:
   "you've kind of got random gaps … some sort of grid … to show the
   different sections"). Each shelf's icon is drawn in its hue's word value
   on his ruling (docs/design.md, "His rulings").

   A ticked row STAYS, its name greyed and stamped who and when, never
   hidden and never dimmed by opacity. The tick also lands in the diary via
   the story merge: the list shows the state, the diary keeps the story.
   ServiceM8's own checklist, when a job has one, is a box of grey ticks
   nobody can change here: the mirror is read-only. */

const clockOf = (naive: string | null): string | null => {
  const m = naive?.match(/[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const h24 = parseInt(m[1], 10);
  const mer = h24 >= 12 ? "pm" : "am";
  const h = h24 % 12 || 12;
  return `${h}:${m[2]}${mer}`;
};

/** "Alex Morozoff, 6:52am" on the day; "Alex Morozoff, Fri 14 Aug" after
    it. Any missing part just drops out. */
function tickStamp(item: JobPicklistItem, timezone: string | null, today: string | null): string | null {
  if (!item.pickedAt) return null;
  const at = naiveInZone(item.pickedAt, timezone);
  const when = at ? (at.slice(0, 10) === today ? clockOf(at) : fmtAuWeekdayDayMonth(at.slice(0, 10))) : null;
  return [item.pickedBy, when].filter(Boolean).join(", ") || null;
}

/** Where an open row came from: a tooltip, not a printed line per row. */
function provenanceOf(item: JobPicklistItem, timezone: string | null): string {
  const at = naiveInZone(item.addedAt, timezone);
  const day = at ? fmtAuWeekdayDayMonth(at.slice(0, 10)) : null;
  const who = item.designId !== null ? "Pushed from the design" : item.addedBy ? `Added by ${item.addedBy}` : "Added";
  return [who, day].filter(Boolean).join(", ");
}

const bookLine = (h: MaterialHit) => [h.code, h.supplier].filter(Boolean).join(", ");

function MaterialRow({
  item,
  timezone,
  today,
  manage,
  onTick,
  onRemove,
}: {
  item: JobPicklistItem;
  timezone: string | null;
  today: string | null;
  manage: boolean;
  onTick: (id: string, picked: boolean) => void;
  onRemove: (id: string) => void;
}) {
  const stamp = item.picked ? tickStamp(item, timezone, today) : null;
  const name = <b className="jm-name">{item.name}</b>;
  return (
    <li className={item.picked ? "jm-row jm-row--done" : "jm-row"}>
      <Tick
        className="jm-tick"
        checked={item.picked}
        aria-label={`Loaded: ${item.name}`}
        onChange={(on) => onTick(item.id, on)}
        label={
          <Fade className="jm-text">
            {item.picked ? name : <Tooltip label={provenanceOf(item, timezone)}>{name}</Tooltip>}
            {item.sub && <span className="jm-sub">{item.sub}</span>}
          </Fade>
        }
      />
      {stamp && <span className="jm-stamp">{stamp}</span>}
      {manage && (
        <Button kind="quiet" size={32} className="jm-remove" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item.id)}>
          Remove
        </Button>
      )}
      <span className="jm-qty">{item.qty}</span>
    </li>
  );
}

/** A shelf's box: its icon in its colour, its name, its rows. */
function Shelf({ id, icon, hue, label, children }: { id: string; icon: string; hue: string; label: string; children: ReactNode }) {
  return (
    <section className="jm-box" aria-labelledby={id}>
      <h4 className="jm-head" id={id}>
        <span className={`jm-ic jm-ic--${hue}`} aria-hidden="true">
          <Icon name={icon} size={16} />
        </span>
        {label}
      </h4>
      <ul className="jm-rows">{children}</ul>
    </section>
  );
}

export function JobMaterialsFace({
  loading,
  sm8,
  items,
  timezone,
  manage,
  ready,
  onTick,
  onRemove,
  onAdd,
}: {
  /** True while the detail read is still out. */
  loading: boolean;
  sm8: readonly JobChecklistItem[];
  /** Null until the list's read lands. */
  items: JobPicklistItem[] | null;
  timezone: string | null;
  manage: boolean;
  /** The composer can only address a job the detail read has named. */
  ready: boolean;
  onTick: (id: string, picked: boolean) => void;
  onRemove: (id: string) => void;
  onAdd: (input: { kind: "material"; name: string; qty: string; sub?: string }) => void;
}) {
  const made = useId();
  /* the job's day, for a stamp's "6:52am" against "Fri 14 Aug" */
  const [now] = useState(() => new Date().toISOString());
  const today = naiveInZone(now, timezone)?.slice(0, 10) ?? null;
  const [text, setText] = useState("");
  const [qty, setQty] = useState("");

  /* MATERIALS FROM THE PRICE BOOK (Isaac, 2026-10-03): the business's own
     items in a white menu under the field as a material is typed; picking
     one keeps its code */
  const [sub, setSub] = useState("");
  const [hits, setHits] = useState<MaterialHit[]>([]);
  const [shut, setShut] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const query = !sub ? text.trim() : "";
  useEffect(() => {
    if (query.length < 3) return;
    let live = true;
    const t = setTimeout(() => {
      void searchMaterials(query).then((h) => {
        if (!live) return;
        setHits(h);
        setActive(-1);
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);
  const shownHits = query.length < 3 || shut === query ? [] : hits;
  const fieldRef = useRef<HTMLInputElement>(null);
  const pick = (h: MaterialHit) => {
    setText(h.name);
    setSub(bookLine(h));
    setHits([]);
    setActive(-1);
    fieldRef.current?.focus({ preventScroll: true });
  };
  const onFieldKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (shownHits.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a < 0 && step < 0 ? shownHits.length - 1 : (a + step + shownHits.length) % shownHits.length));
    } else if (e.key === "Enter" && active >= 0 && shownHits[active]) {
      e.preventDefault();
      pick(shownHits[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setShut(query);
    }
  };

  /* AND BY VOICE: a list said out loud becomes rows, each matched to the
     price book, and nothing is added until a person ticks them */
  const [spoken, setSpoken] = useState<{ name: string; qty: string; hit: MaterialHit | null; on: boolean }[] | null>(null);
  const [voiceErr, setVoiceErr] = useState<string | null>(null);
  const dict = useDictation({
    onTranscript: (said) => {
      setVoiceErr(null);
      const rows = splitSpokenList(said);
      if (rows.length === 0) return;
      void Promise.all(rows.map((r) => searchMaterials(r.name).then((h) => h[0] ?? null))).then((found) =>
        setSpoken(rows.map((r, i) => ({ ...r, hit: found[i] ?? null, on: true })))
      );
    },
    onError: setVoiceErr,
  });
  const chosen = (spoken ?? []).filter((r) => r.on).length;
  const addSpoken = () => {
    if (!spoken || !ready) return;
    for (const r of spoken.filter((x) => x.on)) {
      onAdd({ kind: "material", name: r.hit?.name ?? r.name, qty: r.qty, sub: r.hit ? bookLine(r.hit) : "" });
    }
    setSpoken(null);
  };

  const ours = items ?? [];
  const shelves = onShelves(ours);
  const anything = ours.length + sm8.length > 0;

  const add = () => {
    const name = text.trim();
    if (!name || !ready) return;
    onAdd({ kind: "material", name, qty: qty.trim(), sub });
    setText("");
    setQty("");
    setSub("");
    setHits([]);
  };

  return (
    <div className="jm">
      <h3 className="jm-title">Materials</h3>

      <form
        className="jm-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <span className="jm-find">
          <TextInput
            ref={fieldRef}
            size={32}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSub("");
            }}
            onKeyDown={onFieldKey}
            placeholder="Add a material"
            aria-label="Add a material"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={shownHits.length > 0}
            aria-controls={shownHits.length > 0 ? `${made}-book` : undefined}
            aria-activedescendant={active >= 0 && shownHits.length > 0 ? `${made}-hit${active}` : undefined}
          />
        </span>
        <TextInput size={32} className="jm-qtyin" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qty" aria-label="Quantity" />
        {dict.recording ? (
          <Button size={32} icon="mic" onClick={dict.stop} aria-label="Stop and read the list">
            Done
          </Button>
        ) : dict.transcribing ? (
          <Waiting note="Reading back what you said" className="jm-wait" />
        ) : (
          <IconButton glyph="mic" size={32} label="Say the materials" onClick={dict.start} disabled={!ready} />
        )}
        <Button type="submit" size={32} disabled={!text.trim() || !ready}>
          Add
        </Button>
      </form>
      {voiceErr && <p className="jm-err">{voiceErr}</p>}
      {shownHits.length > 0 && (
        <BookMenu
          id={`${made}-book`}
          optionId={(i) => `${made}-hit${i}`}
          anchor={fieldRef}
          hits={shownHits}
          active={active}
          onPoint={setActive}
          onPick={pick}
          onClose={() => setShut(query)}
        />
      )}

      {spoken && (
        <Dialog
          heading="From what you said"
          width={560}
          onClose={() => setSpoken(null)}
          foot={
            <>
              <Button onClick={() => setSpoken(null)}>Cancel</Button>
              <Button kind="main" disabled={!ready || chosen === 0} onClick={addSpoken}>
                {`Add ${chosen} to the list`}
              </Button>
            </>
          }
        >
          <ul className="jm-rows jm-said">
            {spoken.map((r, i) => (
              <li className="jm-row" key={i}>
                <Tick
                  className="jm-tick"
                  checked={r.on}
                  aria-label={`Add ${r.hit?.name ?? r.name}`}
                  onChange={(on) => setSpoken((cur) => (cur ?? []).map((x, k) => (k === i ? { ...x, on } : x)))}
                  label={
                    <Fade className="jm-text">
                      <b className="jm-name">{r.hit?.name ?? r.name}</b>
                      <span className="jm-sub">{r.hit ? bookLine(r.hit) : `"${r.name}", not in your price book`}</span>
                    </Fade>
                  }
                />
                <span className="jm-qty">{r.qty}</span>
              </li>
            ))}
          </ul>
        </Dialog>
      )}

      {anything && (
        <div className="jm-shelves">
          {shelves.map((s) => (
            <Shelf key={s.key} id={`${made}-${s.key}`} icon={s.icon} hue={s.hue} label={s.label}>
              {s.items.map((item) => (
                <MaterialRow key={item.id} item={item} timezone={timezone} today={today} manage={manage} onTick={onTick} onRemove={onRemove} />
              ))}
            </Shelf>
          ))}
          {/* THEIRS: the mirror is read-only by charter, so its ticks are
              grey and nobody can change them here */}
          {sm8.length > 0 && (
            <Shelf id={`${made}-sm8`} icon="servicem8" hue="grey" label="From ServiceM8">
              {groupChecklist(sm8).flatMap((group, gi) => [
                /* ServiceM8's default section is literally named
                   "Checklist"; a REAL section name ("Rough-in") still shows */
                ...(group.section && group.section.trim().toLowerCase() !== "checklist"
                  ? [
                      <li key={`s${gi}`} className="jm-part">
                        {group.section}
                      </li>,
                    ]
                  : []),
                ...group.items.map((item, i) => (
                  <li key={`${gi}-${i}`} className={item.done ? "jm-row jm-row--done" : "jm-row"}>
                    <span className={item.done ? "jm-ro jm-ro--on" : "jm-ro"} role="img" aria-label={item.done ? "Done" : "Not done"}>
                      {item.done && (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="m4 8.5 2.5 2.5L12 5.5" />
                        </svg>
                      )}
                    </span>
                    <Fade className="jm-text">
                      <b className="jm-name">{item.name}</b>
                      {item.itemType && item.itemType !== "Todo" && <span className="jm-sub">{item.itemType}</span>}
                    </Fade>
                    {item.done && (
                      <span className="jm-stamp">
                        {[item.doneBy, item.doneOn ? fmtAuWeekdayDayMonth(item.doneOn) : null].filter(Boolean).join(", ") || "Done"}
                      </span>
                    )}
                  </li>
                )),
              ])}
            </Shelf>
          )}
        </div>
      )}

      {!anything && <p className="jm-none">{loading && items === null ? "Reading the list from the mirror" : "No materials on this job yet."}</p>}
    </div>
  );
}

/* THE PRICE BOOK UNDER THE FIELD: the Menu's white panel, floated as the
   Menu floats, but the field keeps focus, because the person is still
   typing; the arrows and Enter go through the field. */
function BookMenu({
  id,
  optionId,
  anchor,
  hits,
  active,
  onPoint,
  onPick,
  onClose,
}: {
  id: string;
  optionId: (i: number) => string;
  anchor: RefObject<HTMLInputElement | null>;
  hits: MaterialHit[];
  active: number;
  onPoint: (i: number) => void;
  onPick: (h: MaterialHit) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const { style, overModal } = useFloat(anchor, panel, { matchWidth: true });
  useOutsidePress(anchor, panel, onClose);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={panel} className={`pt-menu jm-book${overModal ? " pt-menu--over-modal" : ""}`} style={style}>
      <ul className="pt-menu-list" id={id} role="listbox" aria-label="From your price book">
        {hits.map((h, i) => (
          <li
            key={`${h.code}|${h.supplier}`}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            className={i === active ? "pt-menu-item pt-menu-item--active" : "pt-menu-item"}
            onPointerMove={() => onPoint(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(h)}
          >
            <span className="pt-menu-words">
              <span className="pt-menu-label">{h.name}</span>
              {bookLine(h) && <span className="pt-menu-hint">{bookLine(h)}</span>}
            </span>
            {h.priceCents != null && <span className="pt-menu-count">{fmtAud(h.priceCents)}</span>}
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}

/** The business's own price-book items that match, or none. */
async function searchMaterials(q: string): Promise<MaterialHit[]> {
  try {
    const r = await fetch(`/api/workboard/material-search?q=${encodeURIComponent(q)}`);
    const a = (await r.json()) as { ok: boolean; hits?: MaterialHit[] };
    return a.ok ? (a.hits ?? []) : [];
  } catch {
    return [];
  }
}
