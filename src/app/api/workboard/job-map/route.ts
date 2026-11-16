import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { mapAddress, mapShape, pinHue, staticMapUrl } from "@/lib/jobs/job-map";

/* A JOB'S MAP, the picture over its address on the Overview (lib/jobs/job-map).
   Fetched here so the key never reaches a browser (it can also look up
   places), for whoever may open the job (`workboard`), and only for a job in
   their own workspace. The browser keeps the picture for a day, so a job
   opened again that day asks Google for nothing. */

const DAY = 60 * 60 * 24;

export async function GET(req: Request) {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  if (!orgId || !(await can("workboard"))) return new Response(null, { status: 403 });
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return new Response(null, { status: 404 });
  const q = new URL(req.url).searchParams;
  const job = (q.get("job") ?? "").trim().slice(0, 80);
  if (!job) return new Response(null, { status: 400 });
  const { data } = await supabaseAdmin
    .from("sm8_jobs")
    .select("job_address, geo_city, geo_state, geo_postcode")
    .eq("org_id", orgId)
    .eq("uuid", job)
    .maybeSingle();
  const row = data as { job_address: string | null; geo_city: string | null; geo_state: string | null; geo_postcode: string | null } | null;
  if (!row) return new Response(null, { status: 404 });
  const geoLine = [row.geo_city, row.geo_state, row.geo_postcode].map((x) => x?.trim()).filter(Boolean).join(" ");
  const address = mapAddress({ address: row.job_address, geoLine });
  if (!address) return new Response(null, { status: 404 });
  const res = await fetch(staticMapUrl(address, pinHue(q.get("hue")), key, mapShape(q.get("shape")))).catch(() => null);
  if (!res?.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return new Response(null, { status: 502 });
  return new Response(await res.arrayBuffer(), {
    headers: { "content-type": res.headers.get("content-type") ?? "image/png", "cache-control": `private, max-age=${DAY}` },
  });
}
