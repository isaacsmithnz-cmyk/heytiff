import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { can, getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles";
import { getPaySettings } from "@/lib/timepay/query";
import { loadHolidayManager } from "@/lib/timepay/leave-page";
import { getConnectionView } from "@/lib/integrations/store";
import { savePaySettings } from "@/app/actions/timepay";
import {
  adoptEmploymentType,
  adoptPayBasis,
  adoptWage,
  checkPayRates,
  getLinkingData,
  linkEmployee,
  unlinkEmployee,
} from "@/app/actions/xero-links";
import { PayScreen } from "@/components/settings/pay-screen";

/* Settings › Pay and holidays (v2, 25 October 2026): what was Time & Pay's
   settings gear, as a section of its own.

   The gear's gates, unchanged: it opened for `financials` or an admin, so
   this does. The pay rules and Xero payroll matching need `financials`
   (they decide how pay is worked out, and whose pay is whose); the public
   holidays need admin+, the calendar's own gate in actions/holidays. Each
   read is asked for only by someone who will see it, and the Xero grant
   only behind `financials`, as Team's Time & Pay asks it. */

export default async function PayPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const orgId = session.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const [role, canPay] = await Promise.all([getDbRole(), can("financials")]);
  const canHolidays = hasMinRole(role, "admin");
  if (!canPay && !canHolidays) redirect("/dashboard");

  const [pay, connection, holidays] = await Promise.all([
    canPay ? getPaySettings(orgId) : null,
    canPay ? getConnectionView(orgId, "xero") : null,
    canHolidays ? loadHolidayManager() : null,
  ]);

  return (
    <PayScreen
      pay={pay && { settings: pay.settings, configured: pay.configured, onSave: savePaySettings }}
      holidays={canHolidays ? { initial: holidays } : null}
      xero={
        canPay && connection?.status === "connected"
          ? {
              load: getLinkingData,
              onLink: linkEmployee,
              onUnlink: unlinkEmployee,
              onAdoptEmployment: adoptEmploymentType,
              onAdoptBasis: adoptPayBasis,
              onCheckPay: checkPayRates,
              onAdoptWage: adoptWage,
            }
          : null
      }
    />
  );
}
