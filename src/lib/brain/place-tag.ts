/* THE PLACE TAG NEVER REACHES THE PAGE (walked 24 October 2026). Tiff is
   told where you are in a `<where-they-are>` block inside your message
   (./ask), and told never to write one herself. She did once: an answer
   opened with a made-up `<where-they-are> Screen: Design — … </where-they-are>`
   and the Conversations page drew it. Every answer's words pass through
   here before they are drawn or kept: a whole block goes, and so does one
   still arriving, so a stream never flashes half a tag. Pure. */

const WHOLE = /<where-they-are>[\s\S]*?<\/where-they-are>\s*/gi;
const ARRIVING = /<where-they-are>[\s\S]*$/i;
/** the tag's own name still coming in, at the very end of a stream */
const OPENING = /<w(h(e(r(e(-(t(h(e(y(-(a(r(e)?)?)?)?)?)?)?)?)?)?)?)?)?$/i;

export function withoutPlaceTag(text: string): string {
  if (typeof text !== "string" || !text.includes("<")) return text;
  return text.replace(WHOLE, "").replace(ARRIVING, "").replace(OPENING, "").replace(/^\s+/, "");
}
