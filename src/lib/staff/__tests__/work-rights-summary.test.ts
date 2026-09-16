import type { StaffProfile } from "../profile";
import { workRightsLine } from "../work-rights-summary";

/* THE STANDING LINE on Summary — the sentence that says whether this person
   can be sent to a job. It was a tile in the row of tickets until 2026-09-16.

   The lead carries the rank and the rest carries the evidence, each with its
   own tone, because a person on a valid visa IS cleared to work: the warning
   belongs on the visa, not on the word "cleared". The ranking is the
   directory's compliance chip (derive.ts) — a lapsed visa outranks one about
   to lapse, which outranks a visa nobody has checked — and a citizen never
   waits for a check that can never come. */

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

describe("the standing line", () => {
  it("states the gap, and nothing else, while nothing is recorded", () => {
    const l = workRightsLine(base, TODAY, 30);
    expect(l.unset).toBe(true);
    expect(l.lead).toBe("Right to work not recorded");
    expect(l.leadTone).toBe("warn");
    // there is no clearance to state and no evidence to give
    expect(l.rest).toBeNull();
  });

  it("reads a citizen as cleared, with no check to wait for", () => {
    const l = workRightsLine({ ...base, work_rights_status: "Australian citizen" }, TODAY, 30);
    expect(l.unset).toBe(false);
    expect(l.lead).toBe("Cleared to work");
    expect(l.leadTone).toBe("ok");
    expect(l.rest).toBe("Australian citizen, no visa required.");
    expect(l.restTone).toBe("mute");
  });

  it("names the visa and its expiry, and the check that cleared it", () => {
    const l = workRightsLine(
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
    expect(l.lead).toBe("Cleared to work");
    expect(l.rest).toBe("482 TSS, expires 12/03/2027, checked 01/02/2026.");
    expect(l.restTone).toBe("mute");
  });

  it("warns on the visa, not on the clearance, when nobody has checked it", () => {
    const l = workRightsLine(
      { ...base, work_rights_status: "Full working rights (visa)", visa_type: "482 TSS" },
      TODAY,
      30,
    );
    // they may work today; the missing check is what wants attention
    expect(l.lead).toBe("Cleared to work");
    expect(l.leadTone).toBe("ok");
    expect(l.rest).toBe("482 TSS, not checked.");
    expect(l.restTone).toBe("warn");
  });

  /* The ranking the compliance chip uses: a lapsed visa outranks one about to
     lapse, which outranks the missing check — a check on file does not make an
     expired visa fine. A lapse is also the one case that changes the LEAD:
     everything else on this branch is somebody who may work today. */
  it("ranks a visa's expiry above its check", () => {
    const soon = workRightsLine(
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
    expect(soon.lead).toBe("Cleared to work");
    expect(soon.rest).toBe("482 TSS expires in 2 weeks.");
    expect(soon.restTone).toBe("warn");

    const gone = workRightsLine(
      {
        ...base,
        work_rights_status: "Full working rights (visa)",
        visa_expiry: "2026-07-10",
        vevo_checked_at: "2026-02-01",
      },
      TODAY,
      30,
    );
    expect(gone.lead).toBe("Not cleared to work");
    expect(gone.leadTone).toBe("bad");
    expect(gone.rest).toMatch(/^Visa expired/);
    expect(gone.restTone).toBe("bad");
  });

  it("says plainly when someone may not work", () => {
    const l = workRightsLine({ ...base, work_rights_status: "No working rights" }, TODAY, 30);
    expect(l.lead).toBe("Not cleared to work");
    expect(l.leadTone).toBe("bad");
    expect(l.rest).toBe("No working rights on file.");
  });
});
