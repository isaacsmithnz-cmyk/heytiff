/**
 * @jest-environment node
 */

/* THE INDEX FIX (two-way phase 2). A connection's `missing` scopes count
   only the write kinds the deployment allows AND the owner has on, so with
   SM8_WRITES=1 the Integrations index never says "Reconnect to finish" for
   the notes permission nobody asks for. And the owner's per-kind column is
   read beside the rest — a database without it still reads as connected. */

import { makeFakeDb } from "./fixtures/sm8-fake-db";

const fake = makeFakeDb();
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (t: string) => fake.from(t) } }));

import { getConnectionView } from "../store";
import { SM8_SCOPE_LIST } from "../providers";

const GRANTED = `${SM8_SCOPE_LIST.join(" ")} manage_attachments`;

beforeEach(() => {
  fake.reset();
  fake.db.integration_connections = [
    {
      id: "c1",
      org_id: "org-1",
      provider: "servicem8",
      status: "connected",
      tenant_id: "vendor-1",
      tenant_name: "Acme Air",
      tenants: [],
      scopes: GRANTED,
      write_mode: "live",
      write_kinds: ["attachment", "note"],
      connected_by_user_id: null,
    },
  ];
  process.env.SM8_WRITES = "1";
});
afterAll(() => {
  delete process.env.SM8_WRITES;
});

describe("the ServiceM8 connection's view", () => {
  it("(F) with SM8_WRITES=1 a grant holding the files permission misses nothing — whatever the owner's notes switch", async () => {
    expect((await getConnectionView("org-1", "servicem8"))?.missing).toEqual([]);
  });

  it("misses the notes permission where notes are allowed and the owner has them on", async () => {
    process.env.SM8_WRITES = "attachment,note";
    expect((await getConnectionView("org-1", "servicem8"))?.missing).toEqual(["publish_job_notes"]);
    fake.db.integration_connections[0].write_kinds = ["attachment"];
    expect((await getConnectionView("org-1", "servicem8"))?.missing).toEqual([]);
  });

  it("(F) still reads the connection on a database without write_kinds", async () => {
    fake.missing.add("write_kinds");
    const view = await getConnectionView("org-1", "servicem8");
    expect(view).toMatchObject({ status: "connected", tenantName: "Acme Air", missing: [] });
  });
});
