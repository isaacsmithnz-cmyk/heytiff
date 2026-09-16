import { deriveCompliance } from "../derive";
import { workRightsChips } from "@/lib/dashboard/chips";
import { NO_VISA_STATUSES, WORK_RIGHTS, isNoVisa } from "../work-rights";

/* THE SECOND WARNING NOBODY COULD CLEAR.

   `verified-column.test.ts` guards the first one: both compliance readers used
   to read a column nothing wrote. This is the same failure with a different
   cause, found live on the owner's own card — his Work rights tab read
   "Australian citizen" while the directory chip beside it read "Work rights
   unverified".

   A citizen has no visa, so there is no entitlement record to check against.
   The check the chip was asking for cannot be performed, will never come back,
   and no action available anywhere in the app clears it. The list of statuses
   that means "no visa" already existed — the FORM uses it to hide the visa
   fields — it just was not consulted by either reader.

   BOTH READERS ARE TESTED IN ONE FILE ON PURPOSE. The rule is implemented
   twice: `deriveCompliance` feeds the Team directory, `workRightsChips` feeds
   Home and the topbar bell. Two copies of one rule is how this bug got in, so
   they are pinned against the same table of cases and must agree. */

const TODAY = "2026-08-16";
const ctx = { subject: "Marcus Chen", href: "/dashboard/team/x", today: TODAY, warnDays: 30 };

const facts = (over: Partial<Parameters<typeof deriveCompliance>[1]> = {}) => ({
  status: null,
  visaType: null,
  visaExpiry: null,
  vevoCheckedAt: null,
  ...over,
});

/** Did the directory chip raise the unverified warning? */
const directoryWarns = (status: string | null, vevoCheckedAt: string | null = null) =>
  deriveCompliance([], facts({ status, vevoCheckedAt }), 30, new Date(`${TODAY}T00:00:00`)).label ===
  "Work rights unverified";

/** Did Home / the bell raise it? */
const dashboardWarns = (status: string | null, vevoCheckedAt: string | null = null) =>
  workRightsChips({ staffId: "s1", status, visaType: null, visaExpiry: null, vevoCheckedAt }, ctx).some(
    (c) => c.key.startsWith("work-rights-unverified"),
  );

describe("a status with no visa behind it is never 'unverified'", () => {
  it.each(NO_VISA_STATUSES)("%s raises nothing on either surface", (status) => {
    expect(directoryWarns(status)).toBe(false);
    expect(dashboardWarns(status)).toBe(false);
  });

  it.each(NO_VISA_STATUSES)("%s stays clear even with no check date ever recorded", (status) => {
    // the whole point: there is no date to record, so absence is not a finding
    expect(directoryWarns(status, null)).toBe(false);
    expect(dashboardWarns(status, null)).toBe(false);
  });
});

/* "NO WORKING RIGHTS" IS NOT PAPERWORK OUTSTANDING. Recording it IS the
   answer to the check, so every rule asking "has the check been done" passed
   the person — and with licences in date the directory called them
   "Compliant" while the staff card's own tile said "Not cleared to work".
   Nothing reached the bell at all. It is its own finding now, on both
   surfaces, checked or not. */
describe("a recorded 'no working rights' is a finding in itself", () => {
  const notCleared = (status: string, checked: string | null = null) =>
    deriveCompliance([], facts({ status, vevoCheckedAt: checked }), 30, new Date(`${TODAY}T00:00:00`));
  const chipsFor = (status: string, checked: string | null = null) =>
    workRightsChips({ staffId: "s1", status, visaType: null, visaExpiry: null, vevoCheckedAt: checked }, ctx);

  it.each([null, "2026-02-14"])("says so in the directory, checked date %s", (checked) => {
    expect(notCleared("No working rights", checked)).toMatchObject({
      label: "Not cleared to work",
      state: "bad",
    });
  });

  it.each([null, "2026-02-14"])("raises it on Home and the bell, checked date %s", (checked) => {
    const chips = chipsFor("No working rights", checked);
    expect(chips.map((c) => [c.label, c.state])).toContainEqual(["Not cleared to work", "bad"]);
    // and not twice about one person's right to work
    expect(chips.some((c) => c.key.startsWith("work-rights-unverified"))).toBe(false);
  });

  it("leaves every other status alone", () => {
    for (const status of WORK_RIGHTS.filter((s) => s !== "No working rights")) {
      expect(notCleared(status).label).not.toBe("Not cleared to work");
      expect(chipsFor(status).some((c) => c.key.startsWith("work-rights-none"))).toBe(false);
    }
  });
});

describe("a status that DOES have a visa behind it still has to be checked", () => {
  /* "No working rights" leaves this group: its check is answered, and what is
     recorded is the problem — see the describe above. */
  const visaStatuses = WORK_RIGHTS.filter((s) => !isNoVisa(s) && s !== "No working rights");

  it("covers every remaining status — the exemption is two entries, not a hole", () => {
    expect(visaStatuses).toEqual([
      "Full working rights (visa)",
      "Conditional working rights (visa)",
    ]);
  });

  it.each(visaStatuses)("%s with no check date warns on both surfaces", (status) => {
    expect(directoryWarns(status)).toBe(true);
    expect(dashboardWarns(status)).toBe(true);
  });

  it.each(visaStatuses)("%s with a check date recorded clears on both surfaces", (status) => {
    expect(directoryWarns(status, "2026-02-14")).toBe(false);
    expect(dashboardWarns(status, "2026-02-14")).toBe(false);
  });
});

describe("the two readers cannot drift apart", () => {
  /* The failure mode this file exists for is one surface telling somebody about
     a problem the other says they do not have. Every status, both check
     states, both readers, one assertion. */
  it("agrees on every status, checked and unchecked", () => {
    for (const status of WORK_RIGHTS) {
      for (const checked of [null, "2026-02-14"]) {
        expect({ status, checked, dir: directoryWarns(status, checked) }).toEqual({
          status,
          checked,
          dir: dashboardWarns(status, checked),
        });
      }
    }
  });

  it("says nothing at all about someone with no status recorded", () => {
    expect(directoryWarns(null)).toBe(false);
    expect(dashboardWarns(null)).toBe(false);
  });
});
