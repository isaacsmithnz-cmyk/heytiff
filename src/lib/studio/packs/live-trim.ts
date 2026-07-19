/* Public live-link pack trim. The full merged pack is licensed catalogue
   data — hundreds of rows the read-only viewer has no use for. The sim and
   the canvas render need exactly: the indoor/outdoor units a design places
   or pins, and the pair rows joining them. Everything else ships empty.
   Pure — jest pins that referenced models survive and bulk never leaks. */

import type { DesignDocument } from "../document";
import { emptyPack, type DataPack } from "./schema";

/** every unit model the doc references: placed objects + per-system pair
    picks + per-room multi picks */
export function referencedModels(doc: DesignDocument): Set<string> {
  const models = new Set<string>();
  const eat = (v: unknown) => {
    if (typeof v === "string" && v) models.add(v);
  };
  for (const o of doc.objects) if (o.type === "unit") eat(o.props.model);
  for (const s of doc.systems) {
    eat(s.settings.pairIdu);
    eat(s.settings.pairOdu);
    const multi = s.settings.multiIdus;
    if (multi && typeof multi === "object" && !Array.isArray(multi))
      for (const v of Object.values(multi as Record<string, unknown>)) eat(v);
    eat(s.settings.multiOdu);
  }
  return models;
}

export function trimPackForLive(
  pack: DataPack,
  doc: DesignDocument
): DataPack {
  const keep = referencedModels(doc);
  const out = emptyPack(pack.meta);
  out.indoor_units = pack.indoor_units.filter((u) => keep.has(u.model));
  out.outdoor_units = pack.outdoor_units.filter((u) => keep.has(u.model));
  out.pair_tables = pack.pair_tables.filter(
    (p) => keep.has(p.idu_model) && keep.has(p.odu_model)
  );
  return out;
}
