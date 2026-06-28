"use client";

import { switchOrg } from "@/app/actions/switch-org";

interface Org {
  id: string;
  name: string;
}

export function OrgSwitcher({
  orgs,
  currentOrgId,
}: {
  orgs: Org[];
  currentOrgId: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <p className="text-xs text-zinc-400 mb-1">Switch organisation</p>
      {orgs.map((org) => (
        <form key={org.id} action={switchOrg}>
          <input type="hidden" name="orgId" value={org.id} />
          <button
            type="submit"
            disabled={org.id === currentOrgId}
            className="text-sm px-3 py-1 rounded border border-zinc-200 dark:border-zinc-700 disabled:opacity-40 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            {org.name}
            {org.id === currentOrgId ? " ✓" : ""}
          </button>
        </form>
      ))}
    </div>
  );
}
