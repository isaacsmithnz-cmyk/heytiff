import { escapeHtml } from "@/lib/format/html";

/* An Australian rego plate, rendered as one.

   A plate was styled four different ways across Fleet and the staff card, and
   in the detail modal it wasn't styled at all — it trailed the model name after
   a middot, which reads as part of the sentence rather than as an identifier.
   That matters more than it sounds: in a register of eight white Hiaces the
   plate is the ONLY thing that tells one row from another, so it has to be the
   thing the eye lands on, not a suffix.

   So it gets the shape of the object it names — a slab with a slight emboss,
   wide letter-spacing, the state tag set small behind a hairline the way a real
   AU plate carries it. Recognisable at a glance, and unmistakably a plate
   rather than a chip, a tag or a badge; nothing else in the app looks like it.

   NOT a mono font. The temptation is obvious and it is wrong twice over: real
   AU plates are set in a proportional grotesque, and mono is banned app-wide.
   The 800 weight and .14em tracking do the legibility work instead.

   `state` is optional because AU plates are only unique within a state and
   plenty of records simply don't have it recorded — an empty tag would be worse
   than none, so it is dropped entirely rather than rendered blank. */

export type PlateSize = "sm" | "md";

/* Uppercased here rather than left to `text-transform`, because a plate IS
   uppercase — someone typing "mkt482" into the add-vehicle form has entered
   MKT482, and the value should read that way anywhere it lands, including the
   places that only ever see the string. The CSS says it too, as a backstop. */
const norm = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

export function Plate({
  plate,
  state,
  size = "md",
}: {
  plate: string;
  /** State/territory, e.g. "VIC". Omitted from the render when absent. */
  state?: string | null;
  size?: PlateSize;
}) {
  const tag = norm(state);
  return (
    <span className={`au-plate${size === "sm" ? " sm" : ""}`}>
      {norm(plate)}
      {tag && <span className="st">{tag}</span>}
    </span>
  );
}

/* The HTML-string twin, for screens that compose markup rather than JSX
   (components/shell/screens.ts). Unlike the duration formatter's twin, THIS ONE
   ESCAPES: a plate and a state are typed by whoever added the vehicle, and the
   staff card they land on is read by that person's manager. Same guarantee
   screens-escaping.test.ts makes for the dashboard hero, tested the same way. */
export function plateHtml(plate: string, state?: string | null, size: PlateSize = "md"): string {
  const tag = norm(state);
  return (
    `<span class="au-plate${size === "sm" ? " sm" : ""}">${escapeHtml(norm(plate))}` +
    (tag ? `<span class="st">${escapeHtml(tag)}</span>` : "") +
    "</span>"
  );
}
