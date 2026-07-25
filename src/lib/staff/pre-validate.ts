/* Client-side pre-flight for a card save.

   The card runs the SAME pure builder the server action runs — buildPatch for
   your own card, buildAdminPatch for someone else's — and only calls the
   action if it comes back clean. That is not a security control (the action
   re-runs both, and its allowlists are the real gate): it is so a mistyped
   date is answered instantly, on the field, without a round trip that would
   otherwise re-render the card underneath what you were typing.

   Pure module: both builders are pure and client-importable by design. */

import { buildPatch, isSelfSection } from "./profile";
import { buildAdminPatch, isAdminSection } from "./admin-sections";

export type PreValidation = { error: string; fields: string[] };

const DATE_ERROR = "Check the date format — use dd/mm/yyyy.";
const NUMBER_ERROR = "Check the numbers — they should be plain figures.";
const SPLIT_ERROR = "The cost split has to add up to 100%.";

/** Null when the section would save cleanly; otherwise what to show and where.
    Messages match the actions' wording so the same mistake reads the same
    whether it was caught here or there. */
export function preValidate(
  mode: "self" | "admin",
  section: string,
  fields: Record<string, string>
): PreValidation | null {
  const entries = Object.entries(fields ?? {});

  if (mode === "self") {
    if (!isSelfSection(section)) return null;
    const { invalid } = buildPatch(section, entries);
    return invalid.length ? { error: DATE_ERROR, fields: invalid } : null;
  }

  // permissions writes memberships, not columns — it has no patch to build
  if (section === "permissions" || !isAdminSection(section)) return null;
  const { invalid } = buildAdminPatch(section, entries);
  if (!invalid.length) return null;
  if (invalid.includes("cost_split")) return { error: SPLIT_ERROR, fields: invalid };
  return {
    error: invalid.some((k) => k.includes("date") || k === "birthday") ? DATE_ERROR : NUMBER_ERROR,
    fields: invalid,
  };
}
