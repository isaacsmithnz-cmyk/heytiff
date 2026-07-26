import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { XeroScreen } from "@/components/integrations/xero-screen";
import { getConnectionView } from "@/lib/integrations/store";
import { tokenKey } from "@/lib/integrations/secrets";
import { xeroConfig } from "@/lib/integrations/xero";
import { connectMessage } from "@/lib/integrations/outcome";

/* The Xero connection screen. Owner-only, matching the routes it links to.

   Two booleans cross to the client, never the values behind them: whether the
   Xero app credentials exist, and whether a token key exists. Same posture as
   the Organisation screen's `addressLookup` — the client needs to know a thing
   is configured, and nothing more.

   The `?connected` / `?error` query is turned into a sentence HERE, from a
   fixed table, so the page never renders text an arbitrary URL supplied. */

export default async function XeroIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (!hasMinRole(await getDbRole(), "owner")) redirect("/dashboard");

  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const connection = await getConnectionView(session.orgId as string, "xero");
  const errorText = connectMessage(one(params.error));

  const notice = errorText
    ? ({ kind: "error", text: errorText } as const)
    : one(params.connected) === "1"
      ? ({ kind: "ok", text: "Xero is connected." } as const)
      : null;

  return (
    <XeroScreen
      connection={connection}
      configured={xeroConfig() !== null}
      sealed={tokenKey() !== null}
      notice={notice}
    />
  );
}
