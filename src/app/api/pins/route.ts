import { auth0 } from "@/lib/auth0";
import { pinOf, refOf } from "@/lib/pins/pins";
import { dropPin, readPins, savePin, type PinOwner } from "@/lib/pins/pins-server";

/* The sidebar's Pinned (rule 6), for the person signed in: GET lists them,
   PUT pins one, DELETE lets one go. A pin names a record and keeps its
   title; opening it goes through the record's own door, which checks what
   you may see, so pinning needs a sign-in and a workspace and nothing more. */

async function owner(): Promise<PinOwner | Response> {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  const userSub = (session?.user?.sub as string | undefined) ?? null;
  if (!orgId || !userSub) return Response.json({ ok: false, reason: "Sign in again to pin it." }, { status: 401 });
  return { orgId, userSub };
}

export async function GET() {
  const o = await owner();
  if (o instanceof Response) return o;
  return Response.json({ ok: true, pins: await readPins(o) });
}

export async function PUT(req: Request) {
  const o = await owner();
  if (o instanceof Response) return o;
  const pin = pinOf(await req.json().catch(() => null));
  if (!pin) return Response.json({ ok: false, reason: "Nothing to pin." }, { status: 400 });
  const saved = await savePin(o, pin);
  return Response.json(saved ? { ok: true } : { ok: false, reason: "That didn't pin. Try it again." }, { status: saved ? 200 : 500 });
}

export async function DELETE(req: Request) {
  const o = await owner();
  if (o instanceof Response) return o;
  const ref = refOf(await req.json().catch(() => null));
  if (!ref) return Response.json({ ok: false, reason: "Nothing to unpin." }, { status: 400 });
  const dropped = await dropPin(o, ref);
  return Response.json(dropped ? { ok: true } : { ok: false, reason: "That didn't unpin. Try it again." }, { status: dropped ? 200 : 500 });
}
