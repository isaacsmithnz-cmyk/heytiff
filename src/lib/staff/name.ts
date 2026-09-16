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

/* A NAME IS NEVER AN ADDRESS, whatever column or claim it arrived in.

   Auth0's `name` claim IS the sign-in address for any identity that never set
   a name — every fresh password sign-up — and `??` only steps past null, so
   code written as `claim ?? email.split("@")[0]` never reached its fallback
   and seeded cards with the whole address. The guard is on the VALUE, not the
   source: anything holding an `@` is refused. */
export function personName(v: unknown): string | null {
  const s = str(v);
  return !s || s.includes("@") ? null : s;
}

/* THE NAME A BRAND-NEW CARD IS SEEDED WITH, and there is exactly one rule for
   it. It lived twice — in ensureStaffCard, fixed, and in loadMyProfile's
   first-visit insert, which still had the `??` bug and would have written an
   address into first_name for any member who opened My profile before a card
   existed.

   In order of who decided it: what the org already calls the person (the name
   typed on their invitation), then a provider claim that is really a name,
   then the part of the address before the `@`. The last is a handle, not a
   name — kept because fifteen screens resolve a card through displayNameOf,
   and two nameless people would otherwise be two identical "Unnamed" rows in
   every picker. The first run is what replaces it with the real thing. */
export function seedNameFor(
  user: { name?: unknown; email?: string | null },
  knownAs?: unknown
): string | null {
  return personName(knownAs) ?? personName(user.name) ?? (user.email?.split("@")[0] || null);
}

/* WHETHER A STORED FIRST NAME COULD BE SOMEBODY'S NAME, for prefilling a form
   only. A seed from an address prefix can be `luke` — plausible, so offered
   back to be corrected — or `isaacsmithnz+test`, which is a handle and would
   sit in the box looking like a mistake the person has to delete before they
   can type. Letters, spaces, hyphens, apostrophes and full stops; nothing
   else. Never used to validate what someone TYPES — people's names are theirs. */
export function looksLikeAName(v: unknown): boolean {
  const s = str(v);
  return s.length > 0 && /^\p{L}[\p{L}\p{M}' .-]*$/u.test(s);
}

