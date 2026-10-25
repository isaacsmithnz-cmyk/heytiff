import { redirect } from "next/navigation";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { sectionsFor } from "@/lib/settings/sections";
import { settingsViewer } from "@/lib/settings/viewer";

/* SETTINGS (it was Admin). One page since 25 October 2026: the six sections
   down the left, so the address that used to be the menu opens the first
   section this viewer holds. The SECTION is admin+ — "Staff: Admin section
   hidden entirely" per docs/roles-and-permissions.md — and every admin holds
   Pay and holidays, so nobody who gets past the role lands nowhere.

   What the old menu also held has gone where it belongs: the templates and
   letters are what you send, Tax and EOFY is a view in Reports, and
   Knowledge from the field is the Library's. */
export default async function AdminPage(): Promise<never> {
  if (!hasMinRole(await getDbRole(), "admin")) redirect("/dashboard");
  const [first] = sectionsFor(await settingsViewer());
  redirect(first?.href ?? "/dashboard");
}
