/* ONE JOB TO A SPOT (Isaac, 26 November 2026, at 3260 with the phone saying 3260A: "Why has the job got an A at the
   end of it? That's the invoice job"). ServiceM8's lettered job (3260A) is a copy made for an invoice, at the same
   address as its job; at a tie the phone named whichever came first. A lettered job goes when its own job is a
   place within SAME_SPOT_M of it, so the phone only ever says 3260. */
const SAME_SPOT_M = 30;
export function mainJobsOnly<T extends { number: string | null; lat: number | null; lng: number | null }>(places: T[]): T[] {
  const byNumber = new Map(places.filter((p) => p.number).map((p) => [p.number!.toUpperCase(), p]));
  return places.filter((p) => {
    const m = /^(\d+)[A-Z]$/i.exec(p.number?.trim() ?? "");
    const main = m ? byNumber.get(m[1]!) : undefined;
    return !main || main.lat === null || main.lng === null || p.lat === null || p.lng === null || metresApart(p as { lat: number; lng: number }, main as { lat: number; lng: number }) > SAME_SPOT_M;
  });
}

function metresApart(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const x = r(b.lng - a.lng) * Math.cos(r((a.lat + b.lat) / 2));
  const y = r(b.lat - a.lat);
  return Math.sqrt(x * x + y * y) * 6_371_000;
}
