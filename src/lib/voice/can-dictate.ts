import { can } from "@/lib/permissions-server";
import type { Capability } from "@/lib/permissions";

/* WHO IS ALLOWED TO SPEAK TO THE APP.

   Both transcribe routes used to check `workboard` on their own, which was
   right while the workboard was the only screen with a microphone. It stopped
   being right the moment Tiff's ask bar got one: `tiff` is on by default for
   every role and `workboard` is not, so a perfectly ordinary user could see a
   mic on the assistant and get a 403 from it. The mic would look broken and
   the reason would be invisible.

   So the gate is now a list of the features that OFFER dictation, in one
   place, because it is about to keep growing — the global Tiff button puts a
   microphone on every screen, and when that lands this is the only function
   that has to change.

   IT IS STILL A GATE, not a formality. Both routes spend money per call
   (transcription on one, a minted realtime token on the other), and a route
   handler is reachable directly, so "signed in" alone was never the bar. */
const DICTATION_SURFACES: Capability[] = ["workboard", "tiff"];

/** True when this user has any feature that offers a microphone. */
export async function canDictate(): Promise<boolean> {
  const allowed = await Promise.all(DICTATION_SURFACES.map((c) => can(c)));
  return allowed.some(Boolean);
}
