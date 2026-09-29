/** Does a model match one of the pack's model patterns? A pattern is an
    exact model, or a prefix glob ending in `*` ("MSZ-*", "PUZ-ZM1*").
    Case-sensitive. A `*` anywhere but the end is not a glob the pack writes,
    and never matches. Accessories' `compatible_with` and a branch box's
    families both read this way. */
export function matchesModelGlob(model: string, pattern: string): boolean {
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return !prefix.includes("*") && model.startsWith(prefix);
  }
  return model === pattern;
}
