/* The one HTML escaper.

   Several screens build markup as strings and hand it to
   dangerouslySetInnerHTML — the staff card, the org settings form, the
   dashboard hero, and now the plate. Every value in those strings that a person
   typed has to be escaped on the way in, and the way that guarantee fails in
   practice is not "someone forgot to escape" but "someone wrote a SECOND
   escaper that handles one character fewer". So there is one, it lives in
   lib/ where anything may import it without dragging a component along, and
   components/shell/profile.ts re-exports it as `esc` for its existing callers.

   Quotes are escaped as well as angle brackets, because these strings put
   values inside attributes as often as between tags. */
export function escapeHtml(v: string | null | undefined): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
