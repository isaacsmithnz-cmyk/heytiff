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

   Manual watch items (staff-entered, pack_watchlist table) are the IO side —
   see hq-watchlist actions. */

import { PACK_SECTIONS, type DataPack, type Provenance } from "@/lib/studio/packs/schema";

export interface WatchSignal {
  kind: "unextracted-source" | "unmatched-family" | "dangling-part-ref";
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

/** All auto signals for a pack. */
export function packWatchSignals(pack: DataPack): WatchSignal[] {
  return [...unextractedSources(pack), ...unmatchedRuleReferences(pack)];
}
