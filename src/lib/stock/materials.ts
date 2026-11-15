import type { EquipmentRow } from "./stock";

/* A JOB'S MATERIALS AND STOCK, as one list (Isaac, 14 November 2026, mock F:
   "one list with Stock's word"; 15 November: the quote's units on it too,
   "Yes, add them"). Pure: the web's Materials (job-materials-face) and the
   phone's /api/mobile/jobs/[id]/materials match the same way. */

type Listed = { name?: string; sub: string };

const bare = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, "").toLowerCase();

/** Whether a list's row is this unit or control: its model, as the row keeps it. */
export function sameModel(item: Listed, r: EquipmentRow): boolean {
  const model = bare(item.sub);
  return r.group !== "duct" && !!model && (bare(r.detail) === model || bare(r.detail).endsWith(model) || bare(r.title) === model);
}

/** Stock's word for a material: the unit or control whose model it is. */
export function stockWordOf(item: Listed, stock: readonly EquipmentRow[] | null | undefined): EquipmentRow["word"] {
  if (!stock?.length) return null;
  return stock.find((r) => sameModel(item, r))?.word ?? null;
}

/** The quote's units and controls the list doesn't have: without them a job
    quoted but never given a pick list showed no units at all once the
    Overview's Equipment block went (on 2798, 3209, 3446 and 3516). */
export function quoteOnly(items: readonly Listed[], stock: readonly EquipmentRow[] | null | undefined): EquipmentRow[] {
  return (stock ?? []).filter((r) => r.group !== "duct" && !items.some((i) => sameModel(i, r)));
}

type ListRow = { id: string; name: string; sub: string; qty: string; kind: "material" | "todo"; picked: boolean; pickedBy: string | null; pickedAt: string | null };

/** One row of the job's one list, as the phone draws it: a row on the list
    (`id`), or a unit or control only the quote has (`id` null; ticked, it
    goes on the list ticked). `word` is Stock's, on a row not yet loaded. */
export type JobMaterial = {
  id: string | null;
  key: string;
  name: string;
  sub: string;
  qty: string;
  picked: boolean;
  by: string | null;
  at: string | null;
  word: EquipmentRow["word"];
};

/** The job's materials with the quote's units and controls: equipment first
    (the list's own, then the quote's), then everything else in the list's order. */
export function jobMaterials(items: readonly ListRow[], stock: readonly EquipmentRow[] | null | undefined): JobMaterial[] {
  const mats = items.filter((i) => i.kind === "material");
  const isKit = (i: ListRow) => (stock ?? []).some((r) => sameModel(i, r));
  const row = (i: ListRow): JobMaterial => ({ id: i.id, key: i.id, name: i.name, sub: i.sub, qty: i.qty, picked: i.picked, by: i.pickedBy, at: i.pickedAt, word: i.picked ? null : stockWordOf(i, stock) });
  const quote = quoteOnly(mats, stock).map((r): JobMaterial => ({ id: null, key: `q-${r.key}`, name: r.title, sub: r.detail, qty: String(r.qty), picked: false, by: null, at: null, word: r.word }));
  return [...mats.filter(isKit).map(row), ...quote, ...mats.filter((i) => !isKit(i)).map(row)];
}
