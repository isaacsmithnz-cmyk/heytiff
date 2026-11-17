import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { dayMapUrl } from "@/lib/jobs/job-map";
import { MAX_ZOOM, MIN_ZOOM } from "@/lib/dashboard/day-map";

/* HOME'S MAP, the picture under the pins (lib/dashboard/day-map): Google's
   static map of one view, a centre and a zoom, fetched here so the key never
   reaches a browser, for whoever may see the crew's bookings (`workboard`).
   It names no job and no address, only the view, so the browser keeps the
   picture a day and a view seen again asks Google for nothing. */

const DAY = 60 * 60 * 24;

export async function GET(req: Request) {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  if (!orgId || !(await can("workboard"))) return new Response(null, { status: 403 });
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return new Response(null, { status: 404 });
  const q = new URL(req.url).searchParams;
  const lat = Number(q.get("lat")), lng = Number(q.get("lng"));
  const zoom = Math.round(Number(q.get("z")));
  const w = Math.round(Number(q.get("w"))), h = Math.round(Number(q.get("h")));
  if (![lat, lng, zoom, w, h].every(Number.isFinite) || Math.abs(lat) > 85 || Math.abs(lng) > 180) return new Response(null, { status: 400 });
  if (zoom < MIN_ZOOM || zoom > MAX_ZOOM || w < 64 || w > 640 || h < 64 || h > 640) return new Response(null, { status: 400 });
  const res = await fetch(dayMapUrl({ lat, lng, zoom }, w, h, key)).catch(() => null);
  if (!res?.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return new Response(null, { status: 502 });
  return new Response(await res.arrayBuffer(), {
    headers: { "content-type": res.headers.get("content-type") ?? "image/png", "cache-control": `private, max-age=${DAY}` },
  });
}
