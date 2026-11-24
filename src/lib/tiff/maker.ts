/* A MAKER THE COVER DOESN'T PRINT (Isaac, 24 November 2026: "fix the brand
   gap when the cover has no maker"). Mitsubishi Electric's SEZ installation
   manual carries its maker as a logo, a picture, so the cover's words named
   none and the manual sat under No brand. Its own pages name it, though:
   "MITSUBISHI ELECTRIC CORPORATION cannot be held responsible…" on page 10.

   So, only where nobody gave a brand and the cover named none:
   - the pages the first reading already holds are searched for the brands
     the business's Library knows, and one that is named clearly more than
     any other is taken;
   - else the title's model codes are looked up in the data books, and a
     code every match of which is one brand's gives that brand.
   Pure: the pages, the names and the packs are handed in. */

import type { DataPack } from "@/lib/studio/packs/schema";
import { modelWords } from "@/lib/library/pack-lookup";

const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** A brand's name as a pattern: whole words, any case, the gaps between its words optional ("Actron Air", "ActronAir"). */
function nameRe(name: string): RegExp {
  const words = name.trim().replace(/([a-z])([A-Z])/g, "$1 $2").split(/[\s-]+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![A-Za-z0-9])${words.join("[\\s-]*")}(?![A-Za-z0-9])`, "gi");
}

/** The brand the pages name clearly the most: named at least once, and at least twice as often as the next. A longer
    name is counted before a shorter one inside it ("Mitsubishi Heavy Industries" is not also "Mitsubishi"). Pure. */
export function makerFromPages(texts: readonly string[], names: readonly string[]): string | null {
  const known = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length);
  if (!known.length) return null;
  let text = texts.join("\n");
  const counts = new Map<string, number>();
  for (const name of known) {
    let n = 0;
    text = text.replace(nameRe(name), () => {
      n += 1;
      return " ";
    });
    if (n) counts.set(name, n);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  const [top, second] = ranked;
  return !second || top![1] >= second[1] * 2 ? top![0] : null;
}

/** The brand the data books give the title's model codes, when every unit a code starts is that one brand's, matched
    to the name the Library knows it by. Pure. */
export function makerFromModels(packs: readonly DataPack[], title: string, names: readonly string[]): string | null {
  const brands = new Set<string>();
  for (const word of modelWords(title)) {
    if (!/\d/.test(word)) continue;
    const q = squash(word);
    for (const pack of packs) {
      const brandName = (id: string) => pack.brands?.find((b) => b.id === id)?.name ?? id;
      for (const u of [...(pack.outdoor_units ?? []), ...(pack.indoor_units ?? [])] as { model?: string; brand?: string }[]) {
        if (u.model && u.brand && squash(u.model).startsWith(q)) brands.add(brandName(u.brand));
      }
    }
  }
  if (brands.size !== 1) return null;
  const brand = [...brands][0]!;
  return names.find((n) => squash(n) === squash(brand)) ?? brand;
}
