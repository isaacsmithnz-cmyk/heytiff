/* THE MODEL ASKED ABOUT, FIRST (bug 75, Isaac, 23 November 2026: asked the
   pre-charged pipe length of a Daikin RZA60C2V1, Tiff's searches came back
   with Mitsubishi PUMY and PUHY pages only, and she said there was no Daikin
   manual in the Library. "Daikin RZA R32 Ducted" was there, read in full.
   Searched for the model codes alone it comes first; asked about "refrigerant
   charge" as well, the Mitsubishi pages, which say charge on every page,
   outscore it and push it off the list.)

   So when a question names a model, the documents about that model are
   searched on their own as well, and what they hold goes ahead of the rest.
   A document is about the model when its pages print the code, or its title
   starts the code ("Daikin RZA R32 Ducted" for RZA60C2V1). Pure. */

/** "RZA60C2V1", "FDYAN60AV1", "PUMY-SP140VKM": letters and digits together,
    five characters at least once squashed. A year or a kW figure is not one. */
export function modelCodes(text: string): string[] {
  const out = new Set<string>();
  for (const raw of String(text ?? "").split(/[^\p{L}\p{N}\-/]+/u)) {
    const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length < 5) continue;
    if ((code.match(/[A-Z]/g) ?? []).length < 2 || !/\d/.test(code)) continue;
    /* "R32", "12KW", "2026" are not models */
    if (/^\d+(KW|MM|M|KG|A|V|HZ|PA)?$/.test(code)) continue;
    out.add(code);
  }
  return [...out];
}

/** A title naming the model: a word of it, three characters and two letters
    at least, that starts one of the codes ("RZA" in "Daikin RZA R32 Ducted"). */
export function titleNamesModel(title: string, codes: readonly string[]): boolean {
  const words = String(title ?? "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((w) => w.length >= 3 && (w.match(/[A-Z]/g) ?? []).length >= 2);
  return words.some((w) => codes.some((c) => c.startsWith(w)));
}

/** The documents a model leg found, most hits first, at most `most`. */
export function topDocs(rows: readonly { documentId: string }[], most = 2): string[] {
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.documentId, (count.get(r.documentId) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, most).map(([d]) => d);
}

/** The model's own pages ahead, then the rest, each once. */
export function modelAhead<T extends { id: string }>(ahead: readonly T[], rest: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of [...ahead, ...rest]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}
