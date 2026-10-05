"use client";

import { useEffect, useState } from "react";
import {
  RANGE_KINDS,
  lineLabel,
  sameLine,
  type CandidateItem,
  type CandidateLine,
  type RangeItemView,
  type RangeKind,
  type RangeSize,
  type RangeView,
} from "@/lib/quotes/ranges";
import { withCleanup } from "@/lib/ui/with-cleanup";

/* RANGES THAT COME IN SIZES (Isaac, 2026-10-04: "you pick one item, say
   your Y 14-10-10, and Tiff finds the same range's other sizes in your
   price book for you to confirm once").

   A kit needs its parts at a size — an isolator for the outdoor's current,
   a bracket that holds it, a Ø250 damper, a Y from 14" into two 10" — so
   each is priced from the business's own range of it. Choose opens the
   price book's product lines of that kind, the ones on the most quotes
   first; pressing one lays out every size of it the book holds, each
   read off its name, ticked; Add puts the ticked ones in. A bracket can
   say the widest outdoor it takes (Isaac, 2026-09-30: the 180 kg one
   doesn't fit a PUZ-ZM125). A size that can't be read off a name isn't
   offered: it's said, not guessed. */

const ROUTE = "/api/quoting/ranges";
const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });
const dollars = (cents: number | null) => (cents == null ? "No longer in the book" : money.format(cents / 100));
const sizes = (n: number) => `${n} size${n === 1 ? "" : "s"}`;

type CandidatesAnswer = { ok: true; lines: CandidateLine[] } | { ok: false; reason: string };
type SaveAnswer = { ok: true; range: RangeView } | { ok: false; reason: string };

/** A range's items as the product lines they came from, each named by its
    plainest item's words: "Airloc smartfit y ins, AAD", its key sizes in it. */
function linesIn(items: readonly RangeItemView[]): { key: string; label: string; items: RangeItemView[] }[] {
  const out: { key: string; label: string; items: RangeItemView[] }[] = [];
  for (const i of items) {
    const line = out.find((l) => sameLine(l.items[0]!, i));
    if (line) line.items.push(i);
    else out.push({ key: `${i.supplierKey}|${i.code}`, label: "", items: [i] });
  }
  const words = (i: RangeItemView) => lineLabel(i.name) || i.name;
  return out.map((l) => {
    const plainest = [...l.items].sort((a, b) => words(a).length - words(b).length)[0]!;
    return { ...l, label: `${words(plainest)}, ${plainest.supplierName}` };
  });
}

const saveRefusal = (a: Extract<SaveAnswer, { ok: false }>) => a.reason;
/* worked out here, not in the try that asks: the compiler can't lower a value block inside one */
const withRange = (rs: RangeView[], range: RangeView) => rs.map((r) => (r.kind === range.kind ? range : r));

export function RangesGroup({ initial }: { initial: RangeView[] }) {
  const [ranges, setRanges] = useState(initial);
  const [open, setOpen] = useState<RangeKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const change = async (kind: RangeKind, add: { supplierKey: string; code: string; size: RangeSize }[], remove: { supplierKey: string; code: string }[], done: string) => {
    setBusy(true);
    setNote(null);
    const body = JSON.stringify({ kind, add, remove });
    return withCleanup(async () => {
      try {
        const a = (await (await fetch(ROUTE, { method: "POST", headers: { "content-type": "application/json" }, body })).json()) as SaveAnswer;
        if (!a.ok) {
          setNote({ tone: "bad", text: saveRefusal(a) });
          return false;
        }
        setRanges((rs) => withRange(rs, a.range));
        setNote({ tone: "ok", text: done });
        return true;
      } catch {
        setNote({ tone: "bad", text: "The range couldn't be saved. Try again." });
        return false;
      }
    }, () => setBusy(false));
  };

  return (
    <section className="qs-group">
      <h2 className="qs-h">Ranges that come in sizes</h2>
      {note && <div className={`int-note ${note.tone}`}>{note.text}</div>}
      <div className="qs-table" role="table" aria-label="Ranges that come in sizes">
        <div className="qs-row qsr-row qs-headrow" role="row">
          <span role="columnheader">Part</span>
          <span role="columnheader">Your range</span>
          <span role="columnheader">Sizes</span>
          <span role="columnheader" />
        </div>
        {ranges.map((r) => {
          const k = RANGE_KINDS[r.kind];
          const lines = linesIn(r.items);
          const isOpen = open === r.kind;
          return (
            <div key={r.kind} role="rowgroup">
              <div className={`qs-row qsr-row${isOpen ? " on" : ""}`} role="row">
                <span role="cell" className="qs-item">
                  <b>{k.label}</b>
                  <em>{k.by}</em>
                </span>
                <span role="cell" className="qs-item">
                  {lines.length ? lines.map((l) => l.label).join("; ") : <em className="qs-none">Not chosen</em>}
                </span>
                <span role="cell">{r.items.length ? sizes(r.items.length) : ""}</span>
                <span role="cell" className="qs-act">
                  <button type="button" className="pbtn ghost sm" disabled={busy} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.kind)}>
                    {isOpen ? "Close" : r.items.length ? "Change" : "Choose"}
                  </button>
                </span>
              </div>
              {isOpen && (
                <RangePicker
                  range={r}
                  busy={busy}
                  onAdd={(add) => change(r.kind, add, [], `${k.label}: ${sizes(add.length)} added`)}
                  onRemove={(items) => void change(r.kind, [], items, `${k.label}: ${sizes(items.length)} taken out`)}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

type Proposed = CandidateItem & { supplierKey: string; supplierName: string };

/** One range opened: what's in it, and the price book's lines to add from. */
function RangePicker({
  range,
  busy,
  onAdd,
  onRemove,
}: {
  range: RangeView;
  busy: boolean;
  onAdd: (add: { supplierKey: string; code: string; size: RangeSize }[]) => Promise<boolean>;
  onRemove: (items: { supplierKey: string; code: string }[]) => void;
}) {
  const kind = range.kind;
  const [lines, setLines] = useState<CandidateLine[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{ label: string; items: Proposed[] } | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${ROUTE}?kind=${kind}`)
      .then((r) => r.json() as Promise<CandidatesAnswer>)
      .then((a) => {
        if (!live) return;
        if (a.ok) setLines(a.lines);
        else setFailed(a.reason);
      })
      .catch(() => {
        if (live) setFailed("The price book couldn't be read. Try again.");
      });
    return () => {
      live = false;
    };
  }, [kind]);

  /* every size of the line pressed: its supplier's items of one product line */
  const propose = (line: CandidateLine) => {
    const like = { supplierKey: line.supplierKey, name: line.items[0]!.name };
    const items = (lines ?? [])
      .filter((l) => l.supplierKey === line.supplierKey)
      .flatMap((l) => l.items.map((i) => ({ ...i, supplierKey: l.supplierKey, supplierName: l.supplierName })))
      .filter((i) => sameLine(like, { supplierKey: i.supplierKey, name: i.name }));
    setProposal({ label: `${line.label}, ${line.supplierName}`, items });
  };

  const inRange = linesIn(range.items);
  return (
    <div className="qs-pick" role="row">
      <div role="cell" className="qsr-pick">
        {inRange.length > 0 && (
          <ul className="qs-list">
            {inRange.map((l) => (
              <li key={l.key} className="qsr-line">
                <span className="qs-item">
                  {l.label}
                  <em>{l.items.map((i) => i.words).join(", ")}</em>
                </span>
                <button
                  type="button"
                  className="pbtn ghost sm"
                  disabled={busy}
                  onClick={() => onRemove(l.items.map((i) => ({ supplierKey: i.supplierKey, code: i.code })))}
                >
                  Take out
                </button>
              </li>
            ))}
          </ul>
        )}
        {proposal ? (
          <Proposal
            kind={kind}
            label={proposal.label}
            items={proposal.items}
            busy={busy}
            onCancel={() => setProposal(null)}
            onAdd={(add) =>
              void onAdd(add).then((ok) => {
                if (ok) setProposal(null);
              })
            }
          />
        ) : failed ? (
          <p className="qs-sub">{failed}</p>
        ) : lines == null ? (
          <p className="qs-sub">Reading your price book</p>
        ) : lines.length === 0 ? (
          <p className="qs-sub">{`Nothing in your price book reads as ${RANGE_KINDS[kind].noun} with a size in its name.`}</p>
        ) : (
          <ul className="qs-list" aria-label={`${RANGE_KINDS[kind].label} in your price book`}>
            {lines.map((l) => {
              const sized = l.items.filter((i) => i.size).length;
              return (
                <li key={l.key} className="qsr-line">
                  <span className="qs-item">
                    {`${l.label}, ${l.supplierName}`}
                    <em>{[sizes(sized), l.quotes ? `on ${l.quotes} quote${l.quotes === 1 ? "" : "s"}` : null].filter(Boolean).join(", ")}</em>
                  </span>
                  <button type="button" className="pbtn ghost sm" disabled={busy} onClick={() => propose(l)}>
                    Use
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Every size of one product line, ticked, for a person to confirm. */
function Proposal({
  kind,
  label,
  items,
  busy,
  onCancel,
  onAdd,
}: {
  kind: RangeKind;
  label: string;
  items: Proposed[];
  busy: boolean;
  onCancel: () => void;
  onAdd: (add: { supplierKey: string; code: string; size: RangeSize }[]) => void;
}) {
  const sized = items.filter((i): i is Proposed & { size: RangeSize } => i.size != null);
  const unread = items.filter((i) => i.size == null);
  const [on, setOn] = useState(() => new Set(sized.map((i) => i.code)));
  const [widths, setWidths] = useState<Record<string, string>>({});
  const brackets = kind === "wall_bracket";
  const picked = sized.filter((i) => on.has(i.code));
  const widthOf = (code: string) => {
    const n = Number(widths[code]);
    return widths[code]?.trim() && Number.isFinite(n) && n >= 200 && n <= 3000 ? n : null;
  };
  const toggle = (code: string) =>
    setOn((s) => {
      const next = new Set(s);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  return (
    <div className="qs-match qsr-proposal">
      <h3 className="qs-h">{label}</h3>
      <div className="pbi-wrap">
        <table className="pbi">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">In the range</span>
              </th>
              <th scope="col">Size</th>
              <th scope="col">Item</th>
              {brackets && <th scope="col">Outdoors up to, mm wide</th>}
              <th scope="col" className="pbi-num">
                Buy
              </th>
            </tr>
          </thead>
          <tbody>
            {sized.map((i) => (
              <tr key={i.code}>
                <td>
                  <input type="checkbox" checked={on.has(i.code)} disabled={busy} onChange={() => toggle(i.code)} aria-label={`${i.words}, ${i.code}`} />
                </td>
                <td className="pbi-code">{i.words}</td>
                <td>
                  {i.name}
                  <span className="qsr-code">{i.code}</span>
                </td>
                {brackets && (
                  <td>
                    <input
                      className="wb2-fi qsr-width"
                      inputMode="numeric"
                      value={widths[i.code] ?? ""}
                      disabled={busy}
                      onChange={(e) => setWidths((w) => ({ ...w, [i.code]: e.target.value }))}
                      aria-label={`Widest outdoor ${i.code} takes, mm`}
                    />
                  </td>
                )}
                <td className="pbi-num">{dollars(i.buyCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unread.length > 0 && <p className="qs-sub">{`No size in the name, so not offered: ${unread.map((i) => i.name).join("; ")}.`}</p>}
      <div className="wb2-jqacts">
        <button type="button" className="pbtn ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="pbtn primary"
          disabled={busy || picked.length === 0}
          onClick={() =>
            onAdd(
              picked.map((i) => ({
                supplierKey: i.supplierKey,
                code: i.code,
                size: brackets ? { ...i.size, maxWidthMm: widthOf(i.code) } : i.size,
              }))
            )
          }
        >
          {`Add ${sizes(picked.length)}`}
        </button>
      </div>
    </div>
  );
}
