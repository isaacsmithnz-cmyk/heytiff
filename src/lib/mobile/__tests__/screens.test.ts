import { phonePath } from "../screens";

/* Where Tiff's "take me there" opens on the phone: its own screen for the
   web's page, or nothing where the phone has none. */

it("opens a job on its phone screen", () => {
  expect(phonePath("/dashboard/jobs/5e9a01ac-cb60-4de7-ad65-243ddcca275d")).toBe("/job?id=5e9a01ac-cb60-4de7-ad65-243ddcca275d");
  expect(phonePath("/dashboard/jobs/abc?tab=quote")).toBe("/job?id=abc");
});

it("carries Jobs' search", () => {
  expect(phonePath("/dashboard/jobs?q=Railway%20Avenue")).toBe("/jobs?q=Railway%20Avenue");
});

it("maps the pages the phone has", () => {
  expect(phonePath("/dashboard")).toBe("/");
  expect(phonePath("/dashboard/my-timesheet")).toBe("/timesheet");
  expect(phonePath("/dashboard/my-leave")).toBe("/leave");
  expect(phonePath("/dashboard/profile")).toBe("/card");
  expect(phonePath("/dashboard/schedule")).toBe("/schedule");
});

it("opens nothing for a page the phone hasn't got", () => {
  expect(phonePath("/dashboard/admin/integrations/servicem8")).toBeNull();
  expect(phonePath("/dashboard/analytics")).toBeNull();
});

it("opens a Library document on the phone's manual screen, at its page", () => {
  expect(phonePath("/dashboard/tiff/library?doc=d-im&page=4")).toBe("/manual?id=d-im&page=4");
  expect(phonePath("/dashboard/tiff/library?doc=d-im")).toBe("/manual?id=d-im");
  expect(phonePath("/dashboard/tiff/library")).toBe("/library");
});
