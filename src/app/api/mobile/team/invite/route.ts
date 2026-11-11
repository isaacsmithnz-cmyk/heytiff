import { createInvite, renewInvite, revokeInvite } from "@/app/actions/invite";
import { actAsPhoneUser, ok, requireMobile } from "@/lib/mobile/auth";
import { readTeam } from "@/lib/mobile/team";

/* AN INVITE FROM THE PHONE: to a person's card (POST {staffId, email, role}),
   sent again (POST {id, do: "renew"}) or cancelled (POST {id, do: "cancel"}).
   The web's own invites as the phone user, so its every guard holds: who
   may invite at which role, one open invite a card and an address, never to
   someone already here. The answer is the team as it now stands. */

const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request) {
  const ctx = await requireMobile(request, "team");
  if (ctx instanceof Response) return ctx;
  const body = (await request.json().catch(() => null)) as { staffId?: unknown; email?: unknown; role?: unknown; id?: unknown; do?: unknown } | null;
  if (!body) return no(400, "Who to?");
  const id = typeof body.id === "string" ? body.id.trim().slice(0, 80) : "";
  const r =
    id && (body.do === "renew" || body.do === "cancel")
      ? await actAsPhoneUser(ctx, () => (body.do === "renew" ? renewInvite(id) : revokeInvite(id)))
      : typeof body.staffId === "string" && typeof body.email === "string" && typeof body.role === "string"
        ? await actAsPhoneUser(ctx, () => createInvite({ email: body.email as string, role: body.role as string, staffProfileId: (body.staffId as string).trim().slice(0, 80) }))
        : null;
  if (!r) return no(400, "Who to?");
  if (!r.ok) return no(409, r.error);
  return ok(await readTeam(ctx));
}
