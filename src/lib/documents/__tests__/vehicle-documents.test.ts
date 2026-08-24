/**
 * @jest-environment node
 *
 * documentsForVehicles merges two owner columns into one paper trail: the
 * vehicle's own documents (vehicle_id) and its logs' dockets (vehicle_log_id,
 * mapped to a vehicle by the caller's log map). The mapping is the only logic
 * here, so it is what the fake exercises — including the docket whose log
 * belongs to nobody in the map, which must be dropped rather than misfiled.
 */

const rowsByColumn: Record<string, Record<string, unknown>[]> = {};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from() {
      let inColumn = "";
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: (col: string) => ((inColumn = col), chain),
        not: () => Promise.resolve({ data: rowsByColumn[inColumn] ?? [] }),
      };
      return chain;
    },
    storage: {
      from: () => ({
        createSignedUrls: async (refs: string[]) => ({
          data: refs.map((path) => ({ path, signedUrl: `signed:${path}` })),
        }),
      }),
    },
  },
}));

import { documentsForVehicles } from "../query";

function doc(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "d",
    kind: "purchase_invoice",
    storage_ref: "org/x",
    file_name: "f.pdf",
    mime_type: "application/pdf",
    size_bytes: 9,
    uploaded_by: "s1",
    created_at: "2026-08-01T00:00:00Z",
    notice_id: null,
    ...over,
  };
}

it("merges both owner columns under the vehicle, newest first, links signed", async () => {
  rowsByColumn.vehicle_id = [
    doc({ id: "inv", vehicle_id: "v1", storage_ref: "org/inv", created_at: "2026-08-01T00:00:00Z" }),
  ];
  rowsByColumn.vehicle_log_id = [
    doc({
      id: "docket",
      kind: "fuel_receipt",
      vehicle_log_id: "log-1",
      storage_ref: "org/docket",
      created_at: "2026-08-20T00:00:00Z",
    }),
    doc({ id: "orphan", kind: "fuel_receipt", vehicle_log_id: "log-unknown", storage_ref: "org/orphan" }),
  ];

  const out = await documentsForVehicles("org-1", ["v1"], new Map([["log-1", "v1"]]));

  const trail = out.get("v1") ?? [];
  expect(trail.map((d) => d.id)).toEqual(["docket", "inv"]); // newest first
  expect(trail[0].url).toBe("signed:org/docket");
  // the unmapped docket is dropped, not misfiled onto some other vehicle
  expect([...out.keys()]).toEqual(["v1"]);
});

it("asks nothing for an empty register", async () => {
  const out = await documentsForVehicles("org-1", [], new Map());
  expect(out.size).toBe(0);
});
