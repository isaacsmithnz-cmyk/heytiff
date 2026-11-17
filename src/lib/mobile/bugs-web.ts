import { getDbRole, requireOrg } from "@/lib/permissions-server";
import type { BugCtx } from "./bugs";

/* The website's door to the bugs folder (lib/mobile/bugs): the session says
   which workspace and who, and the membership row, read fresh, says the
   role: anyone in the workspace, as on the phone. */

const NO_STORE = { "cache-control": "no-store" };

export const bugReply = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

export async function webBugCtx(): Promise<BugCtx | Response> {
  let orgId: string;
  let userId: string;
  try {
    ({ orgId, userId } = await requireOrg());
  } catch {
    return bugReply({ error: "Sign in again to save a bug." }, 401);
  }
  return { orgId, userId, role: await getDbRole() };
}
