"use server";

import { auth0 } from "@/lib/auth0";
import { openName } from "@/lib/tiff/moves";
import { openByName } from "@/lib/tiff/registry/screens";
import { viewerForUser } from "@/lib/tiff/registry/viewer";

export type OpenResult = { href: string; label: string; line: string } | null;

/** "Open up Isaac Smith": the one record called exactly that, opened with
    no model call, or null and the words go on as they would have
    (registry/screens' `openByName`). The viewer is read from the session,
    and gated as their screens are. */
export async function openRecordByName(words: string): Promise<OpenResult> {
  const name = typeof words === "string" ? openName(words) : null;
  if (!name) return null;
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;
  const viewer = await viewerForUser(orgId, userId);
  const opened = await openByName(viewer, name);
  return opened ? { href: opened.href, label: opened.label, line: opened.line } : null;
}
