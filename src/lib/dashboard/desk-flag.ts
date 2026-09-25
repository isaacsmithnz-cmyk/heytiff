import "server-only";
import { hasMinRole, type Role } from "@/lib/roles-shared";

/* THE NEW HOME'S SWITCH — `HOME_DESK`, off | owner | on.

   The new Home (the day bar, three tabs and the list) is built in pieces
   behind this, and the crew keep today's Home until Isaac has walked the
   new one in production — previews cannot sign in, so production is the
   only place it can be walked. `owner` shows it to the workspace's owner
   alone; `on` is the flip, for everyone; anything else, or nothing, is off.

   READ AT CALL TIME, ON THE SERVER. The Studio's flags are NEXT_PUBLIC_ and
   inlined at build, but this one needs the viewer's role, which only the
   server knows — so it stays a plain server variable, and a change to it
   takes a redeploy rather than a rebuild of the client. `server-only` makes
   a client import fail the build rather than quietly read "off" forever. */

export type DeskMode = "off" | "owner" | "on";

export function deskMode(): DeskMode {
  const v = (process.env.HOME_DESK ?? "").trim().toLowerCase();
  return v === "on" || v === "owner" ? v : "off";
}

/** Does this viewer get the new Home? */
export function deskOn(role: Role | null): boolean {
  const mode = deskMode();
  return mode === "on" || (mode === "owner" && hasMinRole(role, "owner"));
}
