import { ok, requireMobile } from "@/lib/mobile/auth";

/* THE NEWEST INSTALL OF THE PHONE APP (Isaac, 2 November 2026: "I want the boys
   to be able to update it without me having to send them the link"). A big
   version can't come as an update, so the app asks here and its Update button
   offers the file. Every business's phones share one app, so this is the same
   for all of them. A new build goes here once it has finished. */
const NEWEST = {
  android: {
    version: "1.0.8",
    url: "https://expo.dev/artifacts/eas/WBstxUPO-1IrOw-BoHK0QQmp55gmmcR1Gx30voTW3r4.apk",
  },
};

export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  return ok(NEWEST);
}
