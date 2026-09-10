/* THE MORNING RUN, with the expiring list (issue #640, piece 4).

   Two promises are pinned here and nowhere else, because they live in the
   orchestration rather than in a pure function:

   1. THE SWITCH IS HONOURED. A workspace with `expiry_email` off gets no
      letter for an expiry, however close it is. The bell still shows it.
   2. A PERSON SEES ONLY WHAT THEIR CAPABILITIES ALLOW. The bell scopes its
      chips by the session's capabilities; the run has no session, so it
      resolves them from the same membership row — and a staff member without
      `team` does not get a letter about the business's licence.

   The fake serves the four tables the run reads by `eq` only; the reads that
   already have their own tests are mocked at the module boundary. */

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
let updates: { table: string; patch: Row; ids: unknown[] }[] = [];

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const eq: [string, unknown][] = [];
      let patch: Row | null = null;
      let ids: unknown[] = [];
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self;
      chain.eq = (c: string, v: unknown) => {
        eq.push([c, v]);
        return chain;
      };
      chain.not = self;
      chain.is = self;
      chain.lte = self;
      chain.order = self;
      chain.in = (c: string, vals: unknown[]) => {
        if (patch) ids = vals;
        else eq.push([`in:${c}`, vals]);
        return chain;
      };
      chain.update = (p: Row) => {
        patch = p;
        return chain;
      };
      chain.then = (resolve: (v: unknown) => void) => {
        if (patch) {
          updates.push({ table, patch, ids });
          return resolve({ data: null, error: null });
        }
        let rows = tables[table] ?? [];
        for (const [c, v] of eq) {
          rows = c.startsWith("in:")
            ? rows.filter((r) => (v as unknown[]).includes(r[c.slice(3)]))
            : rows.filter((r) => r[c] === v);
        }
        return resolve({ data: rows, error: null });
      };
      return chain;
    },
  },
}));

const sendEmail = jest.fn(async () => ({ ok: true as const }));
jest.mock("@/lib/email/send", () => ({
  isEmailConfigured: () => true,
  sendEmail: (...args: unknown[]) => sendEmail(...(args as [])),
}));
jest.mock("@/lib/staff/query", () => ({
  emailsByUser: async (ids: string[]) => new Map(ids.map((id) => [id, `${id}@example.com`])),
}));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: async () => "Australia/Sydney" }));
jest.mock("@/lib/workboard/dates", () => ({ todayInZone: () => "2026-07-19" }));
jest.mock("../reminders", () => ({ remindAtFrom: () => "2026-07-19T13:59:00.000Z" }));

const compliance = jest.fn();
jest.mock("../query", () => ({ listStaffCompliance: (...a: unknown[]) => compliance(...a) }));
const vehicles = jest.fn();
jest.mock("@/lib/fleet/query", () => ({ listVehicles: (...a: unknown[]) => vehicles(...a) }));
const credentials = jest.fn();
const window = jest.fn();
jest.mock("@/lib/org/query", () => ({
  listOrgCredentials: (...a: unknown[]) => credentials(...a),
  orgExpiryWindow: (...a: unknown[]) => window(...a),
}));

import { sendReminderDigests } from "../reminder-mail";

const ORG = "org-1";
const owner = { staffId: "s-owner", name: "Isaac Smith", workRights: { status: null, visaType: null, visaExpiry: null, vevoCheckedAt: null }, licences: [] };
const staff = { staffId: "s-staff", name: "Jordan Mills", workRights: { status: null, visaType: null, visaExpiry: null, vevoCheckedAt: null }, licences: [] };

beforeEach(() => {
  sendEmail.mockClear();
  updates = [];
  tables = {
    tasks: [],
    organizations: [{ id: ORG, expiry_email: true }],
    memberships: [
      { org_id: ORG, user_id: "u-owner", role: "owner", permissions: null },
      { org_id: ORG, user_id: "u-staff", role: "staff", permissions: null },
    ],
    staff_profiles: [
      { id: "s-owner", org_id: ORG, user_id: "u-owner", first_name: "Isaac" },
      { id: "s-staff", org_id: ORG, user_id: "u-staff", first_name: "Jordan" },
    ],
  };
  compliance.mockResolvedValue([owner, staff]);
  vehicles.mockResolvedValue({ vehicles: [] });
  // the business's ARC authorisation, ten days out — inside a 30-day window
  credentials.mockResolvedValue([
    { id: "arc", kind: "licence", name: "ARC refrigerant trading authorisation", issuer: null, expiryDate: "2026-07-29", number: null, color: null },
  ]);
  window.mockResolvedValue({ warnDays: 30, email: true });
});

it("a business licence inside the window reaches the owner, and only the owner", async () => {
  const run = await sendReminderDigests("https://go.hey-tiff.com");

  expect(sendEmail).toHaveBeenCalledTimes(1);
  const [{ to, subject, html }] = sendEmail.mock.calls[0] as unknown as [{ to: string; subject: string; html: string }];
  expect(to).toBe("u-owner@example.com");
  expect(subject).toBe("Expiring: ARC refrigerant trading authorisation expires in 10 days");
  expect(html).toContain("Hi Isaac —");
  expect(run).toMatchObject({ orgs: 1, people: 1, sent: 1, expiries: 1, tasks: 0 });
  // nothing to stamp: an expiry is a status, not a reminder
  expect(updates).toEqual([]);
});

it("honours the switch — off, and the same expiry sends nothing", async () => {
  window.mockResolvedValue({ warnDays: 30, email: false });
  const run = await sendReminderDigests("https://go.hey-tiff.com");
  expect(sendEmail).not.toHaveBeenCalled();
  expect(run).toMatchObject({ orgs: 0, sent: 0, expiries: 0 });
});

it("honours the window — the same expiry outside a 7-day window sends nothing", async () => {
  window.mockResolvedValue({ warnDays: 7, email: true });
  await sendReminderDigests("https://go.hey-tiff.com");
  expect(sendEmail).not.toHaveBeenCalled();
});

it("a staff member's own expiring ticket reaches them, without the business's papers", async () => {
  compliance.mockResolvedValue([
    owner,
    { ...staff, licences: [{ id: "wc", typeName: "White Card", expiryDate: "2026-07-25" }] },
  ]);
  await sendReminderDigests("https://go.hey-tiff.com");

  const calls = (sendEmail.mock.calls as unknown as [{ to: string; subject: string; html: string }][]).map((c) => c[0]);
  const jordan = calls.find((c) => c.to === "u-staff@example.com");
  expect(jordan).toBeDefined();
  expect(jordan!.subject).toBe("Expiring: White Card expires in 6 days");
  expect(jordan!.html).not.toContain("ARC refrigerant");
  // the owner's letter carries both: the ticket (team) and the business's paper
  const isaac = calls.find((c) => c.to === "u-owner@example.com");
  expect(isaac!.subject).toMatch(/^2 things expiring/);
});

it("reminders and expiries share one letter, and only the reminders are stamped", async () => {
  tables.tasks = [
    { id: "t1", org_id: ORG, assigned_to: "s-owner", title: "Call Smith & Sons", detail: null, remind_at: "2026-07-19T00:00:00.000Z", status: "open" },
  ];
  const run = await sendReminderDigests("https://go.hey-tiff.com");
  expect(sendEmail).toHaveBeenCalledTimes(1);
  const [{ subject }] = sendEmail.mock.calls[0] as unknown as [{ subject: string }];
  expect(subject).toMatch(/^1 reminder and 1 expiry for /);
  expect(run).toMatchObject({ tasks: 1, expiries: 1 });
  expect(updates).toEqual([{ table: "tasks", patch: expect.objectContaining({ reminder_emailed_at: expect.any(String) }), ids: ["t1"] }]);
});

it("a workspace with the switch on but nothing expiring and no reminders sends nothing", async () => {
  credentials.mockResolvedValue([]);
  const run = await sendReminderDigests("https://go.hey-tiff.com");
  expect(sendEmail).not.toHaveBeenCalled();
  expect(run.orgs).toBe(0);
});
