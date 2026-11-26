import "server-only";
import { loadMyProfile } from "@/app/actions/profile";
import { looksLikeAName } from "@/lib/staff/name";
import { formatAuDate, todayInAu } from "@/lib/au-dates";
import { EMERGENCY_RELATIONSHIPS } from "@/lib/staff/profile";
import { ONBOARDING_LICENCES } from "@/lib/staff/onboarding-licences";
import { saveFirstRunStep, inviteFirstRunTeam, finishFirstRun } from "@/app/actions/first-run";
import { addMyLicence } from "@/app/actions/profile";
import { readStaffLicenceDocument } from "@/app/actions/staff-licence-ai";
import type { FirstRunActions } from "@/components/first-run/first-run";

/* What both first runs (/welcome for a new business's owner, /welcome/details
   for someone joining one) hand the screen: your card's draft as the boxes
   hold it, the lists, and the actions, each the web's own. */

const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function firstRunCommon() {
  const p = (await loadMyProfile()) as unknown as Record<string, unknown>;
  const nameish = (v: unknown) => (looksLikeAName(v) ? str(v) : "");
  const actions: FirstRunActions = {
    save: saveFirstRunStep,
    team: inviteFirstRunTeam,
    finish: finishFirstRun,
    readLicence: readStaffLicenceDocument,
    addLicence: addMyLicence,
  };
  return {
    staffId: str(p.id) || null,
    initialDetails: {
      first_name: nameish(p.first_name),
      last_name: nameish(p.last_name),
      preferred_name: str(p.preferred_name),
      birthday: p.birthday ? formatAuDate(str(p.birthday)) : "",
      phone: str(p.phone),
      address: str(p.address),
      emergency_name: str(p.emergency_name),
      emergency_relationship: str(p.emergency_relationship),
      emergency_phone: str(p.emergency_phone),
    },
    relationships: [...EMERGENCY_RELATIONSHIPS],
    licenceKinds: [...ONBOARDING_LICENCES],
    today: todayInAu(),
    addressLookup: Boolean(process.env.GOOGLE_MAPS_API_KEY),
    actions,
  };
}
