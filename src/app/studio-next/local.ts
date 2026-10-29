/* THE STUDIO'S OWN SECTION FOR TRYING THE NEXT FLOW (Isaac, 29 October 2026:
   "write the code locally in your own section to test out the new flow").

   Development only: every route here answers 404 unless `next dev` serves
   it, so nothing of it reaches go.hey-tiff.com. It runs the real Studio with
   designs kept in this browser, plans stored where the app stores them and
   Tiff's reader behind it, without a sign-in, for one workspace. */
export const LOCAL_ORG = "91e33ca2-4847-408d-8ec5-c7cc0fa7a576";
export const PLANS_BUCKET = "studio-plans";
export const isLocal = () => process.env.NODE_ENV === "development";
export const notHere = () => new Response("Not found", { status: 404 });
