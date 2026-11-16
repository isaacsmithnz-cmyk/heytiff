import { getDbRole, requireOrg } from "@/lib/permissions-server";
import type { BugCtx } from "./bugs";

/* The website's door to the bugs folder (lib/mobile/bugs): the session says
   which workspace, and the membership row, read fresh, says the role, so a
   bug is the owner's alone here as on the phone. */

const NO_STORE = { "cache-control": "no-store" };

export const bugReply = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

export async function webBugCtx(): Promise<BugCtx | Response> {
  let orgId: string;
  try {
    ({ orgId } = await requireOrg());
  } catch {
    return bugReply({ error: "Sign in again to save a bug." }, 401);
  }
  return { orgId, role: await getDbRole() };
}
