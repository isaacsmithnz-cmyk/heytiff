import { supabaseAdmin } from "@/lib/supabase-server";
import { displayNameOf } from "@/lib/staff/name";

/* Dashboard reads. Org-scoped throughout, like every other query module.

   These feed the pure chip derivations in ./chips. They carry no wages and no
   fleet valuations — an expiry chip needs a name, a date and a licence type,
   nothing more — so there is no money projection to guard here. The capability
   scoping (whose rows to read at all) lives one layer up, in ./page-data. */

export type WorkRights = {
  status: string | null;
  visaType: string | null;
  visaExpiry: string | null;
  verifiedAt: string | null;
};

export type Licence = { id: string; typeName: string; expiryDate: string | null };

export type StaffCompliance = {
  staffId: string;
  name: string;
  workRights: WorkRights;
  licences: Licence[];
};


/** Licences for a set of staff, grouped by staff_profile_id. */
async function licencesByStaff(orgId: string, staffIds: string[]): Promise<Map<string, Licence[]>> {
  const out = new Map<string, Licence[]>();
  if (staffIds.length === 0) return out;
  const { data } = await supabaseAdmin
    .from("staff_licences")
    .select("id, staff_profile_id, type_name, expiry_date")
    .eq("org_id", orgId)
    .in("staff_profile_id", staffIds);
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const sid = r.staff_profile_id as string;
    const list = out.get(sid) ?? [];
    list.push({
      id: r.id as string,
      typeName: r.type_name as string,
      expiryDate: (r.expiry_date as string) ?? null,
    });
    out.set(sid, list);
  }
  return out;
}

/* Compliance sources — work rights plus licences — with the person's name
   attached so a chip can say whose expiry it is.

   With `staffId` set it reads exactly that one person (the *self* lens, which
   includes an inactive card — it's still your own). Without it, it reads the
   ACTIVE roster only: an offboarded person's expiring licence isn't a task for
   anyone, so it must not appear in the team's action list. */
export async function listStaffCompliance(
  orgId: string,
  staffId?: string,
): Promise<StaffCompliance[]> {
  let q = supabaseAdmin
    .from("staff_profiles")
    .select(
      "id, first_name, last_name, full_name, preferred_name, work_rights_status, visa_type, visa_expiry, work_rights_verified_at",
    )
    .eq("org_id", orgId);
  q = staffId ? q.eq("id", staffId) : q.eq("status", "Active");
  const { data } = await q;

  const rows = (data ?? []) as Record<string, unknown>[];
  const licences = await licencesByStaff(orgId, rows.map((r) => r.id as string));

  return rows.map((r) => ({
    staffId: r.id as string,
    name: displayNameOf(r),
    workRights: {
      status: (r.work_rights_status as string) ?? null,
      visaType: (r.visa_type as string) ?? null,
      visaExpiry: (r.visa_expiry as string) ?? null,
      verifiedAt: (r.work_rights_verified_at as string) ?? null,
    },
    licences: licences.get(r.id as string) ?? [],
  }));
}

/* The business's own insurance, for the org-insurance chip.

   It used to be two columns on `organizations`. It's a row in org_credentials
   now (a business can hold public liability AND professional indemnity AND
   workers comp), so the chip takes the SOONEST expiry — the one actually about
   to lapse — and names its insurer, falling back to the policy's own name. */
export async function orgInsurance(
  orgId: string,
): Promise<{ insurer: string | null; insuranceExpiry: string | null }> {
  const { data } = await supabaseAdmin
    .from("org_credentials")
    .select("name, issuer, expiry_date")
    .eq("org_id", orgId)
    .eq("kind", "insurance")
    .not("expiry_date", "is", null)
    .order("expiry_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return { insurer: null, insuranceExpiry: null };
  const issuer = ((data.issuer as string) ?? "").trim();
  return {
    insurer: issuer || ((data.name as string) ?? null),
    insuranceExpiry: (data.expiry_date as string) ?? null,
  };
}
