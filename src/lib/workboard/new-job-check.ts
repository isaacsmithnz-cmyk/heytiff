import { customerLine, oneLine, type CustomerHit } from "@/lib/customers/find";
import type { PlaceCheck } from "@/lib/address/place-check";

/* BEFORE "MAKE THE JOB IN SERVICEM8?" — pure (Isaac's first hands-free
   talk, 26 November 2026, on the phone).

   Three things went wrong in one breath. He asked her to see whether a
   client was already a customer, and she asked "Make the job in
   ServiceM8?" without looking. He said yes, and it failed: "The job wasn't
   made: Where is the job? Add the site's address." He said the address, and
   she offered the job at the suburb the transcriber misheard.

   So a new job is offered only once:
     · the client said has been looked up, and what was found is said
       (lib/customers/find), first;
     · there is a site address: none said, and she asks where, offering the
       address the customer was found at;
     · the address said is on the map (lib/address/place-check), and the
       job offered is at the place the map gives. One the map doesn't know
       is asked about once, offering the customer's address when there is
       one; said again, it stands as said. A map that didn't answer asks
       nothing: the job is made as said, as it always was.

   The note flow (actions/workboard-notes' `fileNote`) does the looking and
   asks what this says to ask; this decides. */

/** Her words when the map doesn't know an address: the marker a reply is
    known by, so one said again stands. */
export const NOT_ON_MAP = "on the map";

export type NewJobStep =
  /** something to ask before the job is offered: a reply answers it */
  | { kind: "ask"; question: string; lead: string }
  /** offer the job: at `address`, with what was found said first */
  | { kind: "offer"; address: string; lead: string };

/** Whether she has asked about this address on the map already, in these turns. */
export const mapAsked = (tiffSaid: readonly string[]): boolean => tiffSaid.some((t) => t.includes(`couldn't find`) && t.includes(NOT_ON_MAP));

/** The one address the customers found share, when they're one place. */
function onFile(hits: readonly CustomerHit[]): string {
  const places = [...new Set(hits.map((h) => oneLine(h.address)).filter(Boolean))];
  return places.length === 1 ? places[0]! : "";
}

/** What happens next for a new job: `client` and `address` as said, the
    customers found by that name (none looked for: null), and the map's word
    on the address (null when there's no address to check). */
export function newJobStep(
  job: { client: string; address: string },
  facts: { customers: readonly CustomerHit[] | null; place: PlaceCheck | null; askedOnMap: boolean },
): NewJobStep {
  const lead = job.client.trim() && facts.customers ? customerLine(job.client, facts.customers) : "";
  const known = facts.customers ? onFile(facts.customers) : "";
  const said = job.address.trim();

  if (!said) {
    return {
      kind: "ask",
      lead,
      question: known ? `Is the new job at ${known}, or somewhere else?` : "Where's the new job? Say the site's address, with the suburb.",
    };
  }
  const place = facts.place ?? { kind: "off" as const };
  if (place.kind === "found") return { kind: "offer", address: place.address, lead };
  if (place.kind === "none" && !facts.askedOnMap) {
    const offer = known && known.toLowerCase() !== said.toLowerCase() ? ` Is it ${known}?` : " What's the street number, street and suburb?";
    return { kind: "ask", lead, question: `I couldn't find ${said} ${NOT_ON_MAP}.${offer}` };
  }
  return { kind: "offer", address: said, lead };
}
