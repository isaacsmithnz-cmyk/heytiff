/* Extraction watch-list — auto-derived signals (pure).

   The universal table is fed ONLY by uploaded-and-extracted files (hard rule:
   never internet research). Questions the extracted data can't answer are not
   filled in — they surface here as "what the next extraction must look out
   for", computed from the pack itself:

   1. Declared-but-unextracted sources: meta.sources entries that no row in any
      section cites in its provenance — a book was named but never mined (e.g.
      the PUMY-SP data book: declared, zero rows).
   2. Unmatched rule references: compatibility whitelist families that match no
      indoor model (engine-consistent prefix matching, multi.ts), and
      branch-box part refs that resolve to no part row — extraction typos or
      missing sections to verify against the book pages cited by the rule.
   3. Multi rules with no combination rule: per-unit limits only, so the pack
      can't say whether a SET of indoor units is legal. Signals 1 and 2 can't
      see this — the book IS cited, the families DO match; what went missing is
      the whole-set bound the book prints (a combination table for ME, a ratio
      band or total-kW cap — connected_capacity — for brands that publish one
      instead).
   4. Multi limits the brand records on some outdoors and not others: the
      height between indoor units, a head count, a connected total. Absent is
      safe — nothing is checked — and for a brand that never prints one it is
      the book's own answer (ME takes one head; its guide prints no height
      between indoor units), so a pack where NO row carries a limit is never
      flagged. A row missing what its siblings carry is: the same book, or
      its sibling, printed it.

   Manual watch items (staff-entered, pack_watchlist table) are the IO side —
   see hq-watchlist actions. */

import {
  PACK_SECTIONS,
  type CompatibilityRule,
  type DataPack,
  type Provenance,
} from "@/lib/studio/packs/schema";

export interface WatchSignal {
  kind:
    | "unextracted-source"
    | "unmatched-family"
    | "dangling-part-ref"
    | "no-combination-rule"
    | "unrecorded-multi-limit";
  title: string;
  detail: string;
}

function rowProvenance(row: unknown): Provenance | null {
  const p = (row as { provenance?: Provenance }).provenance;
  return p && typeof p.source === "string" ? p : null;
}

/** Sources declared in meta.json that zero rows cite — declared, never mined. */
export function unextractedSources(pack: DataPack): WatchSignal[] {
  const sources = pack.meta.sources ?? [];
  if (sources.length === 0) return [];

  const cited = new Set<string>();
  for (const section of PACK_SECTIONS) {
    for (const row of pack[section] as unknown[]) {
      const p = rowProvenance(row);
      if (p) cited.add(p.source);
    }
  }
  // a rule block may cite a different book from its row — a combination table
  // is routinely published apart from the rest of the rule, and that citation
  // is what makes its book "mined"
  for (const rule of pack.multi_rules) {
    for (const block of rule.compatibility ?? []) {
      const p = "provenance" in block ? rowProvenance(block) : null;
      if (p) cited.add(p.source);
    }
  }

  return sources
    .filter((s) => !cited.has(s.title))
    .map((s) => ({
      kind: "unextracted-source" as const,
      title: s.title,
      detail: `Declared as a pack source${s.edition ? ` (${s.edition})` : ""} but no data has been extracted from it yet.`,
    }));
}

/** Rule references that resolve to nothing in the extracted data. */
export function unmatchedRuleReferences(pack: DataPack): WatchSignal[] {
  const out: WatchSignal[] = [];
  const partModels = new Set(pack.parts.map((p) => p.model));

  for (const rule of pack.multi_rules) {
    const cite = rowProvenance(rule);
    const where = cite
      ? `${cite.source}${cite.page ? ` p.${cite.page}` : ""}`
      : "its source book";

    for (const block of rule.compatibility ?? []) {
      if (block.method !== "family_whitelist_with_limits") continue;
      for (const family of block.families) {
        // engine-consistent membership: families are printed model prefixes
        const matches = pack.indoor_units.some((u) => u.model.startsWith(family));
        if (!matches && !out.some((s) => s.kind === "unmatched-family" && s.title === family)) {
          out.push({
            kind: "unmatched-family",
            title: family,
            detail: `Whitelisted by ${rule.odu_model_ref} but no indoor model matches — verify against ${where} on the next extraction.`,
          });
        }
      }
    }

    for (const ref of rule.branch_box_refs ?? []) {
      if (!partModels.has(ref) && !out.some((s) => s.kind === "dangling-part-ref" && s.title === ref)) {
        out.push({
          kind: "dangling-part-ref",
          title: ref,
          detail: `Referenced as a branch box by ${rule.odu_model_ref} but no part row exists — extract it from ${where}.`,
        });
      }
    }
  }
  return out;
}

/* ── combination rule: does a block bound the SET, or only each unit? ──
   `family_whitelist_with_limits` never does, `max_count` included: a count is
   not a capacity. Six 3.5 kW heads on a 12 kW MXZ pass its count and its
   per-port cap at 175% connected, which is precisely what the book's
   combination table exists to answer.

   NO `default` arm, deliberately: when a new compatibility method lands
   (#727 — the kW-based limits other brands publish), TypeScript fails this
   function until somebody decides which side it falls on. */
function boundsTheSet(block: CompatibilityRule): boolean {
  switch (block.method) {
    case "explicit_combination_table":
    case "capacity_combination_table":
      return true; // the book lists the approved sets outright
    case "index_ratio_band":
      return true; // connected index vs outdoor, with a max count
    case "family_whitelist_with_limits":
      return false; // per-unit family, capacity, index and per-port bounds only
    case "connected_capacity":
      return block.max != null; // a total-kW cap — the form other brands print instead of a table
    case "head_count":
      return false; // a count is not a capacity
    case "max_matching":
    case "excluded_combinations":
      return false; // the book's exceptions to its table, never the bound itself
  }
}

/** Multi rules whose blocks bound each unit but never the set. */
export function unboundedMultiRules(pack: DataPack): WatchSignal[] {
  const out: WatchSignal[] = [];

  for (const rule of pack.multi_rules) {
    // an EMPTY compatibility is the validator's finding ("compatibility
    // empty"), not a watch item — this signal is about a rule that looks
    // complete and isn't
    const blocks = rule.compatibility ?? [];
    if (blocks.length === 0 || blocks.some(boundsTheSet)) continue;

    const cite = rowProvenance(rule);
    const where = cite
      ? `${cite.source}${cite.page ? ` p.${cite.page}` : ""}`
      : "its source book";

    out.push({
      kind: "no-combination-rule",
      title: rule.odu_model_ref,
      detail: `Only per-unit limits are encoded, so nothing checks whether a set of indoor units is approved — extract the combination table (or the ratio band, for a book that prints one instead) from ${where}.`,
    });
  }
  return out;
}

/** the per-outdoor multi limits signal 4 compares across a pack's rows */
const MULTI_LIMITS: { label: string; has: (r: DataPack["multi_rules"][number]) => boolean }[] = [
  { label: "a height limit between indoor units", has: (r) => r.max_lift_idu_idu_m != null },
  { label: "a head count", has: (r) => (r.compatibility ?? []).some((b) => b.method === "head_count") },
  { label: "a connected capacity", has: (r) => (r.compatibility ?? []).some((b) => b.method === "connected_capacity") },
];

/** Multi rules missing a limit their sibling rows carry (signal 4). */
export function unrecordedMultiLimits(pack: DataPack): WatchSignal[] {
  const out: WatchSignal[] = [];
  for (const rule of pack.multi_rules) {
    const missing = MULTI_LIMITS.filter((l) => !l.has(rule) && pack.multi_rules.some(l.has));
    if (!missing.length) continue;
    const cite = rowProvenance(rule);
    const where = cite ? `${cite.source}${cite.page ? ` p.${cite.page}` : ""}` : "its source book";
    const what = missing.map((l) => l.label).join(", ");
    out.push({
      kind: "unrecorded-multi-limit",
      title: rule.odu_model_ref,
      detail: `Other multi outdoors in this pack record ${what}; this one doesn't, so nothing checks it — extract it from ${where}, or confirm the book prints none.`,
    });
  }
  return out;
}

/** All auto signals for a pack. */
export function packWatchSignals(pack: DataPack): WatchSignal[] {
  return [
    ...unextractedSources(pack),
    ...unmatchedRuleReferences(pack),
    ...unboundedMultiRules(pack),
    ...unrecordedMultiLimits(pack),
  ];
}
