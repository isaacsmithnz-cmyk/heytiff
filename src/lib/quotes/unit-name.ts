import { unitPartOf } from "./brands";

/* A UNIT LINE IS NAMED BY WHAT IT IS (Isaac, 2026-10-15, on 3231's quote:
   "it says two piece ducted unit, then [MITSUBISHI ELEC. DUCT OUT 10KW 1P
   R32]. That's like a line code from a supplier, which isn't correct. That
   needs to just be simplified to indoor unit, outdoor unit… if it's like a
   multi-system… indoor unit study, then model"): "Indoor unit" or "Outdoor
   unit", a multi's or a VRF's head with the room it serves, "Indoor unit,
   Study". The model is the line's code; the supplier's own words for the
   item are never its name. Lines kept before keep theirs. Pure. */

export type UnitRole = "indoor" | "outdoor";

const MAX_ROOM = 60;

/** A unit line's name: its role, and the room a head serves where it's given. */
export function unitLineName(role: UnitRole, room = ""): string {
  if (role === "outdoor") return "Outdoor unit";
  const r = room.replace(/\s+/g, " ").trim().slice(0, MAX_ROOM);
  return r ? `Indoor unit, ${r}` : "Indoor unit";
}

/** Whether a line's name is already a unit's by what it is. */
export const namedByRole = (name: string) => /^\s*(indoor|outdoor)\s+unit\b/i.test(name);

/** The room a unit line's words give after its role: "Indoor unit, Study"
    is the Study; nothing when they don't give one that way. */
export function roomIn(words: string): string {
  const m = /^\s*indoor\s+unit\s*([,:(–—-])(.*)$/i.exec(words);
  if (!m) return "";
  return (m[1] === "(" ? m[2]!.replace(/\)\s*$/, "") : m[2]!).trim();
}

/** Whether a unit is an indoor or an outdoor: what its maker's pack says
    where it holds the model, else the first of `words` that names one (the
    book's item and its code, then the line's own); null when none does, or
    when they sell it as a whole system in one item. */
export function unitRoleOf(pack: UnitRole | null, ...words: { name: string; code?: string | null }[]): UnitRole | null {
  if (pack) return pack;
  for (const w of words) {
    const part = unitPartOf(w.name, w.code ?? "");
    if (part === "indoor" || part === "outdoor") return part;
    if (part === "system") return null;
  }
  return null;
}

/** The name a unit line goes on with: by its role, with the room its words
    give; `otherwise` when nothing says which part it is. */
export function namedUnit(role: UnitRole | null, words: string, otherwise = words): string {
  return role ? unitLineName(role, roomIn(words)) : otherwise;
}
