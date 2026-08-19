/* Public live-link pack trim. The full merged pack is licensed catalogue
   data — hundreds of rows the read-only viewer has no use for. What the link
   needs is exactly: the indoor/outdoor units a design places or pins, the
   pair rows joining them, the multi rules for the outdoors it shares, and the
   brand's own name. Everything else ships empty.
   Pure — jest pins that referenced models survive and bulk never leaks.

   TWO SECTIONS THAT LOOK LIKE BULK AND ARE NOT. The live link now serves the
   design SHEET, and the sheet is the same document the owner reads — so a
   section dropped here does not simplify the customer's copy, it makes the two
   copies disagree about the same job:

   - `brands` is one row carrying a public trading name. Without it the sheet
     printed the SLUG: a customer read "mitsubishi-electric" where the owner
     read "Mitsubishi Electric".
   - `multi_rules` carries the additional-charge rule for a shared outdoor.
     Without it a multi's refrigerant top-up vanished from the customer's
     materials while staying on the owner's — a line item that exists on one
     copy of a document and not the other. Filtered to the outdoors this
     design actually shares, so the other rules stay home. */

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
  out.brands = pack.brands.filter((b) =>
    doc.systems.some((s) => s.brand === b.id)
  );
  out.indoor_units = pack.indoor_units.filter((u) => keep.has(u.model));
  out.outdoor_units = pack.outdoor_units.filter((u) => keep.has(u.model));
  out.pair_tables = pack.pair_tables.filter(
    (p) => keep.has(p.idu_model) && keep.has(p.odu_model)
  );
  out.multi_rules = pack.multi_rules.filter((r) =>
    keep.has(r.odu_model_ref)
  );
  return out;
}
