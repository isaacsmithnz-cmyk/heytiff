import type { StaffProfile } from "../profile";
import { workRightsTile } from "../work-rights-summary";

/* The first tile on Summary's row of tickets. It ranks its state the way the
   directory's compliance chip does, and a citizen never waits for a check. */

const base: StaffProfile = {
  id: "p1",
  org_id: "o1",
  user_id: null,
  first_name: "Jordan",
  last_name: "Mills",
  full_name: null,
  preferred_name: null,
  phone: null,
  birthday: null,
  address: null,
  start_date: null,
  employment_type: null,
  job_title: null,
  status: "Active",
  state: null,
  photo_url: null,
  shirt_size: null,
  jacket_size: null,
  trousers_size: null,
  boot_size: null,
  boot_scale: null,
  emergency_name: null,
  emergency_phone: null,
  emergency_relationship: null,
  emergency_alt_phone: null,
  work_rights_status: null,
  visa_type: null,
  visa_expiry: null,
  hours_condition: null,
  vevo_checked_at: null,
  qualifications: null,
};

const TODAY = "2026-07-24";

describe("the work-rights tile", () => {
  it("is a required blank while nothing is recorded", () => {
    const t = workRightsTile(base, TODAY, 30);
    expect(t.unset).toBe(true);
    expect(t.title).toBe("Work rights");
    expect(t.foot).toEqual({ label: "Required", tone: "warn" });
  });

  it("reads a citizen as cleared, with no check to wait for", () => {
    const t = workRightsTile({ ...base, work_rights_status: "Australian citizen" }, TODAY, 30);
    expect(t.unset).toBe(false);
    expect(t.title).toBe("Australian citizen");
    expect(t.sub).toBe("No visa required");
    expect(t.foot).toEqual({ label: "Full working rights", tone: "ok" });
  });

  it("names the visa and its expiry, and the check that cleared it", () => {
    const t = workRightsTile(
      {
        ...base,
        work_rights_status: "Full working rights (visa)",
        visa_type: "482 TSS",
        visa_expiry: "2027-03-12",
        vevo_checked_at: "2026-02-01",
      },
      TODAY,
      30,
    );
    expect(t.sub).toBe("482 TSS, expires 12/03/2027");
    expect(t.foot).toEqual({ label: "Checked 01/02/2026", tone: "ok" });
  });

  it("warns on a visa nobody has checked", () => {
    const t = workRightsTile(
      { ...base, work_rights_status: "Full working rights (visa)", visa_type: "482 TSS" },
      TODAY,
      30,
    );
    expect(t.sub).toBe("482 TSS");
    expect(t.foot).toEqual({ label: "Not checked", tone: "warn" });
  });

  /* The ranking the compliance chip uses: a lapsed visa outranks one about to
     lapse, which outranks the missing check — a check on file does not make an
     expired visa fine. */
  it("ranks a visa's expiry above its check", () => {
    const soon = workRightsTile(
      {
        ...base,
        work_rights_status: "Full working rights (visa)",
        visa_type: "482 TSS",
        visa_expiry: "2026-08-07",
        vevo_checked_at: "2026-02-01",
      },
      TODAY,
      30,
    );
    expect(soon.foot).toEqual({ label: "Visa expires in 2 weeks", tone: "warn" });

    const gone = workRightsTile(
      {
        ...base,
        work_rights_status: "Full working rights (visa)",
        visa_expiry: "2026-07-10",
        vevo_checked_at: "2026-02-01",
      },
      TODAY,
      30,
    );
    expect(gone.foot.tone).toBe("bad");
    expect(gone.foot.label).toMatch(/^Visa expired/);
    expect(gone.sub).toBe("Visa, expires 10/07/2026");
  });

  it("says plainly when someone may not work", () => {
    const t = workRightsTile({ ...base, work_rights_status: "No working rights" }, TODAY, 30);
    expect(t.sub).toBeNull();
    expect(t.foot).toEqual({ label: "Not cleared to work", tone: "bad" });
  });
});
