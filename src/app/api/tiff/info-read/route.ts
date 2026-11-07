import { auth0 } from "@/lib/auth0";
import { markInfoRead, readInfoRead } from "@/lib/tiff/info-read-server";

/* Whether the signed-in person has pressed the little i on Tiff's arrow yet,
   anywhere (lib/tiff/info-read-server). GET reads it; POST marks it read.
   `read: null` is "not kept": the browser goes by its own memory. */

const headers = { "cache-control": "no-store" };

async function who(): Promise<string | null> {
  const session = await auth0.getSession();
  return (session?.user?.sub as string | undefined) ?? null;
}

export async function GET() {
  const sub = await who();
  if (!sub) return Response.json({ read: null }, { status: 401, headers });
  return Response.json({ read: await readInfoRead(sub) }, { headers });
}

export async function POST() {
  const sub = await who();
  if (!sub) return Response.json({ ok: false }, { status: 401, headers });
  return Response.json({ ok: await markInfoRead(sub) }, { headers });
}
