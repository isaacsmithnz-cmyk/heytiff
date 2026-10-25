import { hasMinRole } from "@/lib/roles";
import { can, getDbRole } from "@/lib/permissions-server";
import { sectionsFor, type SettingsSection, type SettingsViewer } from "./sections";

/** Who's looking, for the side list and the index: three reads, all cached
    for the request, so the page under them pays nothing for asking again. */
export async function settingsViewer(): Promise<SettingsViewer> {
  const [role, canFinancials, canJobMoney] = await Promise.all([getDbRole(), can("financials"), can("workboard_money")]);
  return { isAdmin: hasMinRole(role, "admin"), isOwner: hasMinRole(role, "owner"), canFinancials, canJobMoney };
}

/** The sections, as the client list wants them: no functions cross. */
export async function settingsSectionsForViewer(): Promise<Pick<SettingsSection, "key" | "label" | "href" | "under">[]> {
  return sectionsFor(await settingsViewer()).map(({ key, label, href, under }) => ({ key, label, href, under }));
}
