/* A person's name, in the two parts we actually store.

   `first_name` + `last_name` are the source of truth. `full_name` is KEPT, but
   only as a derived column — a dozen reads already name it — and the save paths
   rewrite it as "first last" every time either half changes.

   Nothing ever splits `full_name` back apart on save: "van der Berg", "Mary
   Anne" and single-word names all break that, and silently mangling someone's
   name is a worse bug than an extra column. The only split in the codebase is
   `splitName`, used once when seeding a brand-new card from an identity
   provider that gives us a single `name` claim — and the matching one-time
   backfill in the `staff_profiles_first_last_name` migration.

   Pure module: no server imports, so the renderer, the actions and the tests
   can all use it. */

export type NameParts = {
  first_name?: unknown;
  last_name?: unknown;
  full_name?: unknown;
  preferred_name?: unknown;
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** "first last", with either half allowed to be missing. */
export function composeFullName(first: unknown, last: unknown): string {
  return [str(first), str(last)].filter(Boolean).join(" ");
}

/* The person's stored name. Composed from the parts; the stored `full_name` is
   the fallback so a row written before the split still reads correctly. */
export function fullNameOf(row: NameParts): string {
  return composeFullName(row.first_name, row.last_name) || str(row.full_name);
}

/** What we CALL someone: their nickname if they set one, otherwise their name. */
export function displayNameOf(row: NameParts, fallback = "Unnamed"): string {
  return str(row.preferred_name) || fullNameOf(row) || fallback;
}

/* First name for a greeting. A preferred name IS the first name when it's set
   — that's the point of it. Falls back to the stored full name's first token
   for rows that predate the split. */
export function firstNameOf(row: NameParts): string {
  return (
    str(row.preferred_name) ||
    str(row.first_name) ||
    fullNameOf(row).split(/\s+/)[0] ||
    ""
  );
}

/* Best-effort split of a single free-text name, for SEEDING a new card only:
   first token -> first, remainder -> last. Never used on save — see the note at
   the top of this file. */
export function splitName(name: unknown): {
  first_name: string | null;
  last_name: string | null;
} {
  const s = str(name);
  if (!s) return { first_name: null, last_name: null };
  const i = s.search(/\s/);
  if (i < 0) return { first_name: s, last_name: null };
  return { first_name: s.slice(0, i), last_name: s.slice(i + 1).trim() || null };
}

/* Keep the derived `full_name` in step with a patch that touches either half of
   the name. `current` supplies the half the form didn't send, so a partial
   submission can't blank out someone's surname in `full_name`. A patch that
   touches neither half is returned untouched. */
export function withDerivedFullName<T extends Record<string, unknown>>(
  patch: T,
  current: NameParts = {}
): T {
  const hasFirst = Object.hasOwn(patch, "first_name");
  const hasLast = Object.hasOwn(patch, "last_name");
  if (!hasFirst && !hasLast) return patch;
  const first = hasFirst ? patch.first_name : current.first_name;
  const last = hasLast ? patch.last_name : current.last_name;
  return { ...patch, full_name: composeFullName(first, last) || null };
}
