/** An address with ServiceM8's country left off its lines: every job is in
    the business's own country, so ", Australia" says nothing, and it pushed
    the street to its own line over "Australia" (Isaac, 20 November 2026,
    on a quote's head line: "i think its actually a bug"). Only the country
    as a part of its own, after a comma or alone on a line: "Perth, Western
    Australia" keeps its state. Pure, so the server's pages use it too (the
    quote's PDF). */
export function withoutCountry(where: string): string {
  return where.replace(/(?:^|,)[ \t]*Australia[ \t]*$/gim, "").trim();
}
