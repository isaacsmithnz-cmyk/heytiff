/* A UNIT LINE'S JOIN TO THE DESIGN, as quote_lines.design_unit keeps it
   (design-units.ts says what joins and why;
   docs/migrations/quote_line_design_unit.sql). Apart from design-units.ts
   so the line's own type reads it without the Studio's code. Pure. */

/** A unit line's join, as quote_lines.design_unit keeps it. */
export type LineJoin = {
  /** the design it's joined in */
  design: string;
  /** the design's units this line is, by allocation id */
  units: string[];
  /** the design hasn't got it, and a person said it's the quote's only */
  only?: true;
  /** what both said when they last agreed */
  model?: string;
  code?: string | null;
  /** the model the design is to take from the quote, for the Studio */
  take?: string;
  /** where the Studio puts a unit it takes: the design's system, or "new" */
  system?: string;
  /** the room a unit it takes goes in: the quote's words for it */
  room?: string;
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** A stored join made safe; null when there's none. */
export function joinOf(raw: unknown): LineJoin | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const design = str(r.design);
  if (!design) return null;
  const units = Array.isArray(r.units) ? [...new Set(r.units.filter((u): u is string => typeof u === "string" && !!u))] : [];
  return {
    design,
    units,
    ...(r.only === true ? { only: true as const } : {}),
    ...(str(r.model) ? { model: str(r.model) } : {}),
    ...("code" in r ? { code: str(r.code) ?? null } : {}),
    ...(str(r.take) ? { take: str(r.take) } : {}),
    ...(str(r.system) ? { system: str(r.system) } : {}),
    ...(str(r.room) ? { room: str(r.room) } : {}),
  };
}
