import { requireMobile } from "@/lib/mobile/auth";
import { addressLookup } from "@/lib/address/places-proxy";

/* The phone's door to the address proxy (lib/address/places-proxy): the same
   lookup as the web's, behind the phone's token instead of a session. The
   phone's Contact sheet finds a job's site and billing address with it as
   you type (Isaac, 17 November 2026, bug 26: "use google API for address
   look up as you type"). A deployment without a key answers 503
   `{ enabled: false }` and the phone's field stays a plain one. */
export async function POST(request: Request) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  return addressLookup(request);
}
