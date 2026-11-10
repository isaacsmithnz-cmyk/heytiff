import { requireOrg } from "@/lib/permissions-server";
import { workspacePeople } from "@/lib/staff/people-query";

/* The workspace's people by the words that name them, for the web's box to
   colour as they're typed or said (components/notes/use-people), as the
   phone's does from api/mobile/people (Isaac, 11 November 2026). Names only;
   any member may read it. */

const headers = { "cache-control": "no-store" };

export async function GET() {
  let orgId: string;
  try {
    ({ orgId } = await requireOrg());
  } catch {
    return Response.json({ people: [] }, { status: 401, headers });
  }
  return Response.json({ people: await workspacePeople(orgId) }, { headers });
}
