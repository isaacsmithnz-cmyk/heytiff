import { codeFeatures } from "./code-links";
import { letterFeatures, type LetterRule } from "./code-letters";

/* WHAT A UNIT HAS, IN ITS SUPPLIER'S OWN WORDS (Isaac, 2026-10-05: "I gave
   you those docs directly, not in the app upload" — the Mitsubishi letters
   were read by hand, so no other maker's units said anything).

   Every supplier already writes it on the item: AAD's "DAIKIN MULTI OUT
   6.8KW 4-PORT R32 DRED" and "MHI AVANTI HWS IND 2.5KW R/C INV WIFI",
   Mitsubishi's "Indoor Unit - wireless R/C with WiFi", Hisense's "MULTI
   B/HEAD IND 5.3KW W/PUMP". So a unit's features are read off its own
   description, whatever its brand, the day its price list or invoice goes
   in — no letter decoding, no API call. Only a unit's: "DAI D-MOBILE RA
   WIFI ADAPTER" and "WIRED CONTROLLER WI-FI" are accessories, not units
   with Wi-Fi. A maker's code letters (code-links.ts) say only what the
   description doesn't.

   Pure and browser-safe. */

const WIFI = /\bwi[-\s]?fi\b|\bwifi\b/i;
const DRED = /\bdred\b|demand\s*resp/i;
const PUMP = /\bdrain\s*pump\b|\bw\/\s*pump\b|\bwith\s*(?:a\s*)?pump\b/i;
/* a unit sold with a Wi-Fi adaptor, not one with Wi-Fi in it */
const WIFI_ADAPTOR = /wi[-\s]?fi\s*(?:adapt(?:o|e)r|module|kit|interface|dongle)|(?:adapt(?:o|e)r|module|interface|dongle)\s*(?:for\s*)?wi[-\s]?fi/i;
/* what makes an item an accessory: a part for a unit, not one */
const ACCESSORY = /\bacc\b|\baccessor|\badapt(?:o|e)r\b|\bcontroller\b|\bmodule\b|\bkit\b|\binterface\b|\bhub\b|\bsensor\b|\bthermostat\b|\bgateway\b|\bcable\b/i;
const CAPACITY = /\d+(?:\.\d+)?\s*kw\b/i;
const UNIT_WORDS = /\bindoor\b|\boutdoor\b|\bind\b|\bout\b|\bo\/u\b|\bunit\b|\bsplit\b|\bducted\b|\bcassette\b|\bbulkhead\b|\bb\/head\b|\bconsole\b|\bwindow\b|\bmulti\b|\bheat\s*pump\b/i;

/** Whether a description is a unit's: one with a capacity, or a unit's
    words and nothing that makes it a part for one. */
export function isUnitDescription(name: string): boolean {
  if (CAPACITY.test(name)) return true;
  return UNIT_WORDS.test(name) && !ACCESSORY.test(name);
}

export const FEATURE_WORDS = {
  wifi: "Wi-Fi built in",
  wifiAdaptor: "Wi-Fi adaptor included",
  dred: "Demand response (DRED) ready",
  drainPump: "Drain pump built in",
} as const;

/** What a unit's own description says it has, in a client's words; nothing
    for an accessory. */
export function descriptionFeatures(name: string): string[] {
  if (!isUnitDescription(name)) return [];
  const out: string[] = [];
  if (WIFI.test(name)) out.push(WIFI_ADAPTOR.test(name) ? FEATURE_WORDS.wifiAdaptor : FEATURE_WORDS.wifi);
  if (DRED.test(name)) out.push(FEATURE_WORDS.dred);
  if (PUMP.test(name)) out.push(FEATURE_WORDS.drainPump);
  return out;
}

/** A unit's features: what its description says, then what its maker's
    code letters say that the description doesn't — the business's own
    rules read from the maker's document (code-letters.ts), and the
    Mitsubishi letters written in by hand. */
export function unitFeatures(name: string, code: string, rules: readonly LetterRule[] = []): string[] {
  const said = descriptionFeatures(name);
  const wifiSaid = said.includes(FEATURE_WORDS.wifi) || said.includes(FEATURE_WORDS.wifiAdaptor);
  const same = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]/g, "") === b.toLowerCase().replace(/[^a-z0-9]/g, "");
  const out = [...said];
  for (const w of [...letterFeatures(code, rules), ...codeFeatures(code)]) {
    if (out.some((x) => same(x, w)) || (wifiSaid && /wi-?fi/i.test(w))) continue;
    out.push(w);
  }
  return out;
}
