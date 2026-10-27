"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Fade } from "@/components/parts/fade";
import { TextInput } from "@/components/parts/field";
import { Loading } from "@/components/parts/states";
import { Tick } from "@/components/parts/tick";
import { useToast } from "@/components/parts/toast";
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
import { dollars, Oops } from "./pb-bits";

/* RANGES THAT COME IN SIZES, opened from a group of the common install
   items on Price book › What prices each part (Isaac,
   2026-10-04: "you pick one item, say your Y 14-10-10, and Tiff finds the
   same range's other sizes in your price book for you to confirm once").

   A kit needs its parts at a size — an isolator for the outdoor's current,
   a bracket that holds it, a Ø250 damper, a Y from 14" into two 10" — so
   each is priced from the business's own range of it. A part's row opens
   its range: what's in it, and the price book's product lines of that
   kind, the ones on the most quotes first; Use on one lays out every size
   of it the book holds, each read off its name, ticked; Add puts the
   ticked ones in. A bracket can say the widest outdoor it takes (Isaac,
   2026-09-30: the 180 kg one doesn't fit a PUZ-ZM125). A size that can't
   be read off a name isn't offered: it's said, not guessed. */

const ROUTE = "/api/quoting/ranges";
const price = (cents: number | null) => (cents == null ? "No longer in the book" : dollars(cents));
const sizes = (n: number) => `${n} size${n === 1 ? "" : "s"}`;

type CandidatesAnswer = { ok: true; lines: CandidateLine[] } | { ok: false; reason: string };
type SaveAnswer = { ok: true; range: RangeView } | { ok: false; reason: string };

/** A range's items as the product lines they came from, each named by its
    plainest item's words: "Airloc smartfit y ins, AAD", its key sizes in it. */
function linesIn(items: readonly RangeItemView[]): { key: string; label: string; words: string; items: RangeItemView[] }[] {
  const out: { key: string; label: string; words: string; items: RangeItemView[] }[] = [];
  for (const i of items) {
    const line = out.find((l) => sameLine(l.items[0]!, i));
    if (line) line.items.push(i);
    else out.push({ key: `${i.supplierKey}|${i.code}`, label: "", words: "", items: [i] });
  }
  const words = (i: RangeItemView) => lineLabel(i.name) || i.name;
  return out.map((l) => {
    const plainest = [...l.items].sort((a, b) => words(a).length - words(b).length)[0]!;
    return { ...l, words: words(plainest), label: `${words(plainest)}, ${plainest.supplierName}` };
  });
}

const saveRefusal = (a: Extract<SaveAnswer, { ok: false }>) => a.reason;
/* worked out here, not in the try that asks: the compiler can't lower a value block inside one */
const withRange = (rs: RangeView[], range: RangeView) => rs.map((r) => (r.kind === range.kind ? range : r));

/** The business's ranges on the page, and a change to one saved: its items
    in, its items out, said in a toast. */
export function useRanges(initial: RangeView[]) {
  const toast = useToast();
  const [ranges, setRanges] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);

  const change = async (kind: RangeKind, add: { supplierKey: string; code: string; size: RangeSize }[], remove: { supplierKey: string; code: string }[], done: string) => {
    setBusy(true);
    setWrong(null);
    const body = JSON.stringify({ kind, add, remove });
    return withCleanup(async () => {
      try {
        const a = (await (await fetch(ROUTE, { method: "POST", headers: { "content-type": "application/json" }, body })).json()) as SaveAnswer;
        if (!a.ok) {
          setWrong(saveRefusal(a));
          return false;
        }
        setRanges((rs) => withRange(rs, a.range));
        toast({ text: done });
        return true;
      } catch {
        setWrong("The range couldn't be saved. Try again.");
        return false;
      }
    }, () => setBusy(false));
  };

  return { ranges, busy, wrong, setWrong, change };
}

export type RangesState = ReturnType<typeof useRanges>;

/** One range opened, its changes saved through the page's ranges. */
export function RangeDialog({ range, state, onClose }: { range: RangeView; state: RangesState; onClose: () => void }) {
  const label = RANGE_KINDS[range.kind].label;
  return (
    <RangePicker
      range={range}
      busy={state.busy}
      wrong={state.wrong}
      onAdd={(add) => state.change(range.kind, add, [], `${label}: ${sizes(add.length)} added`)}
      onRemove={(items) => void state.change(range.kind, [], items, `${label}: ${sizes(items.length)} taken out`)}
      onClose={() => {
        state.setWrong(null);
        onClose();
      }}
    />
  );
}

/** A range's items as the product lines they came from, in their words:
    "Vortex flexible duct". */
export const rangeLines = (items: readonly RangeItemView[]) => linesIn(items).map((l) => l.words);

type Proposed = CandidateItem & { supplierKey: string; supplierName: string };

/** One range opened: what's in it, and the price book's lines to add from. */
function RangePicker({
  range,
  busy,
  wrong,
  onAdd,
  onRemove,
  onClose,
}: {
  range: RangeView;
  busy: boolean;
  wrong: string | null;
  onAdd: (add: { supplierKey: string; code: string; size: RangeSize }[]) => Promise<boolean>;
  onRemove: (items: { supplierKey: string; code: string }[]) => void;
  onClose: () => void;
}) {
  const kind = range.kind;
  const k = RANGE_KINDS[kind];
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
    <Dialog
      heading={k.label}
      width={720}
      onClose={onClose}
      foot={
        <Button kind="second" size={36} onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="st2-pb-dlg">
        {wrong && <Oops>{wrong}</Oops>}
        {inRange.length > 0 && (
          <ul className="st2-pb-rows" aria-label={`Your range of ${k.noun}`}>
            {inRange.map((l) => (
              <li key={l.key} className="st2-pb-grid st2-pb-lines">
                <span className="st2-pb-name">
                  <b>{l.label}</b>
                  <span className="st2-pb-line">
                    <Fade>{l.items.map((i) => i.words).join(", ")}</Fade>
                  </span>
                </span>
                <Button kind="second" size={32} disabled={busy} onClick={() => onRemove(l.items.map((i) => ({ supplierKey: i.supplierKey, code: i.code })))}>
                  Take it out
                </Button>
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
          <Oops>{failed}</Oops>
        ) : lines == null ? (
          <Loading what="Reading your price book" />
        ) : lines.length === 0 ? (
          <p className="st2-pb-said">{`Nothing in your price book reads as ${k.noun} with a size in its name.`}</p>
        ) : (
          <section aria-label={`${k.label} in your price book`}>
            <h3 className="st2-pb-sub">In your price book</h3>
            <ul className="st2-pb-rows" aria-label={`${k.label} in your price book`}>
              {lines.map((l) => {
                const sized = l.items.filter((i) => i.size).length;
                return (
                  <li key={l.key} className="st2-pb-grid st2-pb-lines">
                    <span className="st2-pb-name">
                      <b>{`${l.label}, ${l.supplierName}`}</b>
                      <span className="st2-pb-line">{[sizes(sized), l.quotes ? `on ${l.quotes} quote${l.quotes === 1 ? "" : "s"}` : null].filter(Boolean).join(", ")}</span>
                    </span>
                    <Button kind="second" size={32} disabled={busy} onClick={() => propose(l)}>
                      Use this line
                    </Button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </Dialog>
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
    <section aria-label={label}>
      <h3 className="st2-pb-sub">{label}</h3>
      <div className="st2-pb-ledgerwrap">
        <table className="st2-pb-ledger">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">In the range</span>
              </th>
              <th scope="col">Size</th>
              <th scope="col">Item</th>
              {brackets && <th scope="col">Outdoors up to, mm wide</th>}
              <th scope="col" className="st2-pb-num">
                Buy
              </th>
            </tr>
          </thead>
          <tbody>
            {sized.map((i) => (
              <tr key={i.code}>
                <td>
                  <Tick label={<span className="sr-only">{`${i.words}, ${i.code}`}</span>} checked={on.has(i.code)} disabled={busy} onChange={() => toggle(i.code)} />
                </td>
                <td className="st2-pb-code">{i.words}</td>
                <td>
                  {i.name}
                  <span className="st2-pb-line">{i.code}</span>
                </td>
                {brackets && (
                  <td>
                    <TextInput
                      size={32}
                      inputMode="numeric"
                      value={widths[i.code] ?? ""}
                      disabled={busy}
                      onChange={(e) => setWidths((w) => ({ ...w, [i.code]: e.target.value }))}
                      aria-label={`Widest outdoor ${i.code} takes, mm`}
                    />
                  </td>
                )}
                <td className="st2-pb-num">{price(i.buyCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unread.length > 0 && <p className="st2-pb-said">{`No size in the name, so not offered: ${unread.map((i) => i.name).join("; ")}.`}</p>}
      <div className="st2-pb-foot">
        <Button kind="second" size={36} disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          kind="main"
          size={36}
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
        </Button>
      </div>
    </section>
  );
}
