"use client";

import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { groupChecklist, type JobChecklistItem } from "@/lib/workboard/all-jobs";
import { naiveInZone } from "@/lib/workboard/job-story";
import type { JobPicklistItem } from "@/app/actions/job-picklist";

/* THE CHECKLIST — the job's own running list, OURS AND WRITABLE.

   Isaac's reframe: the crew may live on this platform more than ServiceM8 by
   the end, so this face cannot be a reading of somebody else's list. Two
   fixed sections — Materials (quantity-bearing; a Studio design push lands
   here) and To do (tickable work, typed at the composer) — with ServiceM8's
   mirrored items read-only at the foot, fading as usage moves over.

   A ticked row STAYS, greyed and stamped who-and-when — never hidden,
   never opacity-dimmed (colour does the de-emphasis; opacity on text is
   banned by the house). The tick also lands in the diary via the story
   merge: the list shows the state, the diary keeps the story. */

const clockOf = (naive: string | null): string | null => {
  const m = naive?.match(/[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const h24 = parseInt(m[1], 10);
  const mer = h24 >= 12 ? "pm" : "am";
  const h = h24 % 12 || 12;
  return `${h}:${m[2]}${mer}`;
};

/** "Jake Thompson · 11:52am Thu 14 Aug" — any missing part just drops out. */
function tickStamp(item: JobPicklistItem, timezone: string | null): string | null {
  if (!item.pickedAt) return null;
  const at = naiveInZone(item.pickedAt, timezone);
  const when = [clockOf(at), at ? fmtAuWeekdayDayMonth(at.slice(0, 10)) : null]
    .filter(Boolean)
    .join(" ");
  return [item.pickedBy, when].filter(Boolean).join(" · ") || null;
}

/** Where an open row came from — a tooltip, not a printed line per row. */
function provenanceOf(item: JobPicklistItem, timezone: string | null): string {
  const at = naiveInZone(item.addedAt, timezone);
  const day = at ? fmtAuWeekdayDayMonth(at.slice(0, 10)) : null;
  const who = item.designId !== null ? "Pushed from the design" : item.addedBy ? `Added by ${item.addedBy}` : "Added";
  return [who, day].filter(Boolean).join(" · ");
}

function ChecklistRow({
  item,
  timezone,
  manage,
  onTick,
  onRemove,
}: {
  item: JobPicklistItem;
  timezone: string | null;
  manage: boolean;
  onTick: (id: string, picked: boolean) => void;
  onRemove: (id: string) => void;
}) {
  const stamp = item.picked ? tickStamp(item, timezone) : null;
  return (
    <div
      className={`wb2-pkrow${item.picked ? " done" : ""}`}
      title={item.picked ? undefined : provenanceOf(item, timezone)}
    >
      <label className="wb2-pkbox">
        <input
          type="checkbox"
          checked={item.picked}
          aria-label={`Done: ${item.name}`}
          onChange={(e) => onTick(item.id, e.target.checked)}
        />
      </label>
      <span className="wb2-pkname">{item.name}</span>
      {item.sub && <em className="wb2-pksub">{item.sub}</em>}
      <span className="wb2-pkend">
        {item.kind === "material" && item.qty && <span className="wb2-pkqty">{item.qty}</span>}
        {stamp && <em className="wb2-pkstamp">{stamp}</em>}
        {manage && (
          <button
            className="wb2-pkdel"
            aria-label={`Remove ${item.name}`}
            onClick={() => onRemove(item.id)}
          >
            <Icon name="x" size={13} />
          </button>
        )}
      </span>
    </div>
  );
}

export function JobChecklistFace({
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
  /** Null until the checklist read lands. */
  items: JobPicklistItem[] | null;
  timezone: string | null;
  manage: boolean;
  /** The composer can only address a job the detail read has named. */
  ready: boolean;
  onTick: (id: string, picked: boolean) => void;
  onRemove: (id: string) => void;
  onAdd: (input: { kind: "material" | "todo"; name: string; qty: string }) => void;
}) {
  const [kind, setKind] = useState<"todo" | "material">("todo");
  const [text, setText] = useState("");
  const [qty, setQty] = useState("");

  const ours = items ?? [];
  const materials = ours.filter((i) => i.kind === "material");
  const todos = ours.filter((i) => i.kind === "todo");
  const open = ours.filter((i) => !i.picked).length + sm8.filter((c) => !c.done).length;
  const done = ours.length + sm8.length - open;
  const anything = ours.length + sm8.length > 0;

  const add = () => {
    const name = text.trim();
    if (!name || !ready) return;
    onAdd({ kind, name, qty: qty.trim() });
    setText("");
    setQty("");
  };

  return (
    <div className="wb2-jcck">
      <div className="wb2-jcdhead">
        <b>Checklist</b>
        {anything && <em>{`${open} open · ${done} done`}</em>}
      </div>

      <form
        className="wb2-ckadd"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <span className="wb2-ckseg" role="group" aria-label="What kind of row">
          <button
            type="button"
            className={kind === "todo" ? "on" : undefined}
            aria-pressed={kind === "todo"}
            onClick={() => setKind("todo")}
          >
            To do
          </button>
          <button
            type="button"
            className={kind === "material" ? "on" : undefined}
            aria-pressed={kind === "material"}
            onClick={() => setKind("material")}
          >
            Material
          </button>
        </span>
        <input
          className="wb2-fi"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add to the list…"
          aria-label="Add to the list"
        />
        {kind === "material" && (
          <input
            className="wb2-fi qty"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="Qty"
            aria-label="Quantity"
          />
        )}
        <button className="pbtn" type="submit" disabled={!text.trim() || !ready}>
          Add
        </button>
      </form>

      {materials.length > 0 && (
        <div className="wb2-jcsec">
          <span className="wb2-sect">Materials</span>
          {materials.map((item) => (
            <ChecklistRow
              key={item.id}
              item={item}
              timezone={timezone}
              manage={manage}
              onTick={onTick}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}

      {todos.length > 0 && (
        <div className="wb2-jcsec">
          <span className="wb2-sect">To do</span>
          {todos.map((item) => (
            <ChecklistRow
              key={item.id}
              item={item}
              timezone={timezone}
              manage={manage}
              onTick={onTick}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}

      {/* THEIRS, at the foot — the mirror is read-only by charter, so these
          rows have no checkbox to lie with. They keep their own sections. */}
      {sm8.length > 0 && (
        <div className="wb2-jcsec">
          <span className="wb2-sect">
            From ServiceM8 —{" "}
            {`${sm8.filter((c) => c.done).length} of ${sm8.length} done`}
          </span>
          {groupChecklist(sm8).map((group, gi) => (
            <div key={`${group.section ?? "-"}-${gi}`} className="wb2-ckgroup">
              {/* ServiceM8's default section is literally named "Checklist",
                  and under a head that already says so it read as a stutter
                  (#559's walk) — a REAL section name ("Rough-in") still
                  shows. */}
              {group.section && group.section.trim().toLowerCase() !== "checklist" && (
                <span className="wb2-sect wb2-cksec">{group.section}</span>
              )}
              {group.items.map((item, i) => (
                <div key={`${item.name}-${i}`} className={`wb2-ckrow${item.done ? " done" : ""}`}>
                  <i className="wb2-ckdot" aria-hidden />
                  <span className="wb2-ckname">{item.name}</span>
                  {item.itemType && item.itemType !== "Todo" && (
                    <i className="wb2-chip">{item.itemType}</i>
                  )}
                  <em>
                    {item.done
                      ? [item.doneBy, item.doneOn ? fmtAuWeekdayDayMonth(item.doneOn) : null]
                          .filter(Boolean)
                          .join(" · ") || "done"
                      : ""}
                  </em>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {!anything && (
        <p className="int-hint">
          {loading && items === null
            ? "Reading it from the mirror…"
            : "Nothing on the checklist yet — type the first row above."}
        </p>
      )}
    </div>
  );
}
