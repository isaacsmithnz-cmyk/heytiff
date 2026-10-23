/* Two retired pages read their own address only to send it on: `?v=` and
   `?screen=` on Assets, and `?job=`, `?visit=` and `?q=` on the Workboard
   (the old-code audit, 23 October 2026: it is a redirect for saved links). */

const redirect = jest.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
jest.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

jest.mock("@/lib/permissions-server", () => ({ can: jest.fn(async () => true) }));

import { can } from "@/lib/permissions-server";
import AssetsPage from "../assets/page";
import WorkboardPage from "../workboard/page";

type Search = Record<string, string | string[] | undefined>;

/* Assets is retired (the v2 audit, 20 October 2026): its doors land on the
   vehicle's own page, or on Team's Vehicles view. */
describe("Assets sends its doors to the vehicle's own page", () => {
  const assets = (search: Search) => AssetsPage({ searchParams: Promise.resolve(search) });

  it("opens a named vehicle on its page, on Service for the old Log service door", async () => {
    await expect(assets({ v: "v1", screen: "rego" })).rejects.toThrow("REDIRECT:/dashboard/vehicles/v1");
    await expect(assets({ v: "v1", screen: "add:service" })).rejects.toThrow("REDIRECT:/dashboard/vehicles/v1?tab=service");
  });

  it("lands on Team's Vehicles without one vehicle named", async () => {
    await expect(assets({})).rejects.toThrow("REDIRECT:/dashboard/team?view=vehicles");
    await expect(assets({ v: ["v1", "v2"] })).rejects.toThrow("REDIRECT:/dashboard/team?view=vehicles");
  });

  it("still sends someone without the register to their own vehicle", async () => {
    (can as jest.Mock).mockResolvedValueOnce(false);
    await expect(assets({ v: "v1" })).rejects.toThrow("REDIRECT:/dashboard/my-vehicle");
  });
});

describe("the Workboard sends each saved link to its v2 home", () => {
  const workboard = (search: Search) => WorkboardPage({ searchParams: Promise.resolve(search) as never });

  it("opens a job on its own page, on its Quote section when the old face named it", async () => {
    await expect(workboard({ job: "j-7" })).rejects.toThrow("REDIRECT:/dashboard/jobs/j-7");
    await expect(workboard({ job: "j-7", face: "quote" })).rejects.toThrow("REDIRECT:/dashboard/jobs/j-7?tab=quote");
  });

  it("opens a visit's sheet over Jobs, and a job named beside it wins", async () => {
    await expect(workboard({ visit: "vis-1" })).rejects.toThrow("REDIRECT:/dashboard/jobs?open=visit.vis-1");
    await expect(workboard({ job: "j-7", visit: "vis-1" })).rejects.toThrow("REDIRECT:/dashboard/jobs/j-7");
  });

  it("searches Jobs for a client, and lands on Jobs otherwise", async () => {
    await expect(workboard({ q: "Meridian" })).rejects.toThrow("REDIRECT:/dashboard/jobs?q=Meridian");
    await expect(workboard({})).rejects.toThrow("REDIRECT:/dashboard/jobs");
    await expect(workboard({ visit: ["vis-1", "vis-2"] })).rejects.toThrow("REDIRECT:/dashboard/jobs");
  });

  it("sends someone without the board Home", async () => {
    (can as jest.Mock).mockResolvedValueOnce(false);
    await expect(workboard({ visit: "vis-1" })).rejects.toThrow("REDIRECT:/dashboard");
  });
});
