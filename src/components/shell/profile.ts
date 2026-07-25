/* The v3 design's FORM VOCABULARY, as HTML strings.

   What used to live here — profileHtml(), a 380-line renderer that built the
   whole staff card as one escaped string for dangerouslySetInnerHTML — is
   gone. The staff card is React now (components/profile/), which is what let
   the active section and each card's edit state become state instead of DOM
   classes a server re-render could wipe.

   What remains is the shared field/input/select vocabulary and the escaping
   that goes with it, because ONE screen still renders as a string: the
   Organisation settings page (components/shell/org-settings.ts, driven by
   ProfileBehaviors). When that screen is converted this module goes with it —
   nothing else imports it except lib/fleet/query.ts, for a type. */

import { iconSvg } from "./icon";
import { escapeHtml as esc } from "@/lib/format/html";
import type { VehicleWithFacts } from "@/components/fleet/logic";

/* Icons the shared set doesn't carry. Everything else falls through to
   ICON_PATHS, which is where the staff card's glyphs now live. */
const EX: Record<string, string> = {
  cam:
    '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
};

const exSvg = (n: string, s?: number, w?: number) =>
  `<svg class="i" width="${s || 20}" height="${s || 20}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w || 2}" stroke-linecap="round" stroke-linejoin="round">${EX[n] || ""}</svg>`;
const ic = (n: string, s?: number, w?: number) => (EX[n] ? exSvg(n, s, w) : iconSvg(n, s, w));

/** Profile-aware icon (EX set + shared fallback) — used by ProfileBehaviors. */
export function profileIcon(n: string, s?: number, w?: number): string {
  return ic(n, s, w);
}

// ---- field helpers ----

/* Values reach the DOM through dangerouslySetInnerHTML, so everything the user
   typed MUST be escaped here.

   The implementation lives in lib/format/html.ts so nothing grows a second
   escaper that handles one character fewer; this alias keeps the short name
   the call sites below (and org-settings.ts) already use. */
export { esc };

export const field = (label: string, inner: string, opts: { req?: boolean; help?: string } = {}) =>
  `<div class="field"><label>${label}${opts.req ? ' <span class="req">*</span>' : ""}</label>${inner}${opts.help ? `<span class="help">${opts.help}</span>` : ""}</div>`;
export const input = (name: string, ph?: string, type?: string, value?: string | null) =>
  `<input class="inp" name="${name}" type="${type || "text"}" placeholder="${esc(ph)}" value="${esc(value)}">`;
export const selectP = (name: string, ph: string, opts: readonly string[], value?: string | null) =>
  `<div class="selwrap"><select class="inp" name="${name}"><option value=""${!value ? " selected" : ""}>${esc(ph)}</option>${opts
    .map((o) => `<option${o === value ? " selected" : ""}>${esc(o)}</option>`)
    .join("")}</select><span class="chev">${ic("chev", 16)}</span></div>`;
export const textarea = (name: string, ph: string, value?: string | null, style?: string) =>
  `<textarea class="inp" name="${name}" placeholder="${esc(ph)}"${style ? ` style="${style}"` : ""}>${esc(value)}</textarea>`;

/* The Assigned-vehicle join, resolved by the caller (lib/fleet/query.ts) —
   kept here because that module imports the type from this path. It moves to
   components/profile/types.ts's copy when this file goes. */
export type AssignedVehicle = {
  vehicle: VehicleWithFacts;
  openIssues: number;
  lastFuel: { litres?: number; when: string } | null;
};
