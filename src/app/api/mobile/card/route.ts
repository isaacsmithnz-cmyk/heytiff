import { getStaff } from "@/lib/staff/query";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { orgExpiryWindow } from "@/lib/org/query";
import { getOwnVehicle } from "@/lib/fleet/query";
import { ok, requireMobile } from "@/lib/mobile/auth";
import { readBirthdaySharing, setBirthdaySharing } from "@/lib/team/birthday-sharing";
import { actAsPhoneUser, type MobileCtx } from "@/lib/mobile/auth";
import { EMERGENCY_RELATIONSHIPS } from "@/lib/staff/profile";

/* YOUR CARD for the phone: who you are on the team, as your own profile
   page reads it (getStaff), and the vehicle assigned to you. Your own card
   is yours to see, so it takes no capability, only a membership; and never
   anyone else's: the card is found by the token's own user in its own
   workspace, with no id handed in at all.

   No pay and no notes (getStaff's `pay` and `notes` stay off), so those
   columns are never even selected. */
/** A stored yyyy-mm-dd as the dd/mm/yyyy the box takes. */
const dmy = (iso: string | null): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;

  const staffId = await staffIdFor(ctx.orgId, ctx.userId);
  if (!staffId) return Response.json({ error: "There's no staff card for you here yet." }, { status: 404, headers: { "cache-control": "no-store" } });

  const expiry = await orgExpiryWindow(ctx.orgId);
  const [staff, vehicle, sharing] = await Promise.all([
    getStaff(ctx.orgId, staffId, { pay: false, notes: false }, expiry.warnDays),
    getOwnVehicle(ctx.orgId, staffId).catch(() => null),
    readBirthdaySharing(ctx.orgId, staffId),
  ]);
  if (!staff) return Response.json({ error: "There's no staff card for you here yet." }, { status: 404, headers: { "cache-control": "no-store" } });

  const p = staff.profile;
  const text = (k: string) => (typeof p[k] === "string" && (p[k] as string).trim() ? (p[k] as string) : null);
  return ok({
    name: staff.row.name,
    initials: staff.row.initials,
    title: staff.row.role,
    employmentType: staff.row.employmentType,
    started: staff.row.started,
    years: staff.row.years,
    status: staff.row.status,
    compliance: staff.row.compliance,
    email: staff.row.email || null,
    phone: text("phone"),
    birthday: text("birthday"),
    ...sharing,
    state: text("state"),
    emergency: text("emergency_name")
      ? {
          name: text("emergency_name"),
          relationship: text("emergency_relationship"),
          phone: text("emergency_phone"),
          altPhone: text("emergency_alt_phone"),
        }
      : null,
    licences: staff.licences,
    /* WHAT YOU CAN CHANGE, as the boxes hold it (bug 101, 25 November 2026:
       "staff should be able to edit their own"): each group's Edit opens
       these, and POST saves them back through your own profile's save. */
    edit: {
      first_name: text("first_name") ?? "",
      last_name: text("last_name") ?? "",
      preferred_name: text("preferred_name") ?? "",
      birthday: dmy(text("birthday")),
      phone: text("phone") ?? "",
      address: text("address") ?? "",
      emergency_name: text("emergency_name") ?? "",
      emergency_relationship: text("emergency_relationship") ?? "",
      emergency_phone: text("emergency_phone") ?? "",
      emergency_alt_phone: text("emergency_alt_phone") ?? "",
    },
    relationships: [...EMERGENCY_RELATIONSHIPS],
    address: text("address"),
    preferredName: text("preferred_name"),
    vehicle: vehicle
      ? { name: vehicle.name || null, make: vehicle.make, model: vehicle.model, plate: vehicle.plate, plateState: vehicle.plateState }
      : null,
  });
}

/* YOUR BIRTHDAY TICKS (Isaac, 6 November 2026: "Staff have to opt in, tick to
   share bday, tick to share age"): Share my birthday and Share my age, each
   saving itself; your own card's alone. */
export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const staffId = await staffIdFor(ctx.orgId, ctx.userId);
  if (!staffId) return Response.json({ error: "There's no staff card for you here yet." }, { status: 404, headers: { "cache-control": "no-store" } });
  const body = (await request.json().catch(() => null)) as { shareBirthday?: unknown; shareAge?: unknown; group?: unknown; fields?: unknown } | null;
  if (typeof body?.group === "string") return saveGroup(ctx, body.group, body.fields);
  const change = {
    ...(typeof body?.shareBirthday === "boolean" ? { shareBirthday: body.shareBirthday } : {}),
    ...(typeof body?.shareAge === "boolean" ? { shareAge: body.shareAge } : {}),
  };
  if (!Object.keys(change).length) return Response.json({ error: "Nothing to change." }, { status: 400, headers: { "cache-control": "no-store" } });
  const saved = await setBirthdaySharing(ctx.orgId, staffId, change);
  return saved ? ok(saved) : Response.json({ error: "Couldn't save that." }, { status: 500, headers: { "cache-control": "no-store" } });
}

/* A GROUP OF YOUR OWN DETAILS, saved as your profile's own save saves it
   (saveMyProfileSection, run as you), and only the boxes the phone's group
   shows: a start date or an employment type is the business's to set, even
   where the web's own form reaches it. */
const GROUPS = {
  details: { section: "personal", keys: ["first_name", "last_name", "preferred_name", "birthday"] },
  contact: { section: "personal", keys: ["phone", "address"] },
  emergency: { section: "emergency", keys: ["emergency_name", "emergency_relationship", "emergency_phone", "emergency_alt_phone"] },
} as const;

async function saveGroup(ctx: MobileCtx, group: string, fields: unknown) {
  const g = Object.hasOwn(GROUPS, group) ? GROUPS[group as keyof typeof GROUPS] : null;
  if (!g) return Response.json({ error: "Nothing to change." }, { status: 400, headers: { "cache-control": "no-store" } });
  const from = (fields ?? {}) as Record<string, unknown>;
  const picked: Record<string, string> = {};
  for (const k of g.keys) if (typeof from[k] === "string") picked[k] = (from[k] as string).trim();
  if (group === "details" && (picked.first_name === "" || picked.last_name === "")) {
    return Response.json({ error: "Add your first and last name.", fields: ["first_name", "last_name"] }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  // loaded on the save alone: the profile actions bring the web's session
  // client with them, which this route's reads never need
  const { saveMyProfileSection } = await import("@/app/actions/profile");
  const r = await actAsPhoneUser(ctx, () => saveMyProfileSection(g.section, picked));
  if (!r.ok) return Response.json({ error: r.error, fields: r.fields }, { status: 400, headers: { "cache-control": "no-store" } });
  return ok({ ok: true });
}
