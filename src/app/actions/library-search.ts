"use server";

import { requireOrg } from "@/lib/permissions-server";
import { searchLibrary, type LibrarySearch } from "@/lib/mobile/library-search";

/* THE WEB LIBRARY'S ONE SEARCH, as the phone's (Isaac, 16 November 2026:
   "make library web version look more like mobile"): the manuals whose names
   say what was typed and the pages that say it, from the full-text index
   (lib/mobile/library-search). No model, nothing spent; asking Tiff is its
   own row. Reading the Library is the gate (`tiff`). */
export async function searchManuals(q: string): Promise<{ ok: true; found: LibrarySearch } | { ok: false; error: string }> {
  let orgId: string;
  try {
    ({ orgId } = await requireOrg("tiff"));
  } catch {
    return { ok: false, error: "The Library isn't open to you." };
  }
  try {
    return { ok: true, found: await searchLibrary(orgId, String(q ?? "").slice(0, 200)) };
  } catch {
    return { ok: false, error: "The manuals couldn't be searched just now. Try again in a moment." };
  }
}
