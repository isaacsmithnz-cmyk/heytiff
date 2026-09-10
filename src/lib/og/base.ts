/* THE ABSOLUTE ROOT FOR PREVIEW LINKS.

   Open Graph images have to be absolute URLs, and Next composes them from
   `metadataBase`. The canonical host already lives in APP_BASE_URL — it is
   what proxy.ts redirects every other host to — so it is the base here too,
   and nowhere is a hostname typed twice. Unset or unparseable means
   undefined, and Next then falls back to the deployment's own URL rather
   than the build failing on a preview branch that never set the variable. */
export function metadataBaseFromEnv(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}
