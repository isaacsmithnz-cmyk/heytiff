import {
  REMINDER_LEADS,
  isReminderLead,
  leadLabel,
  reminderDetail,
  reminderDueDate,
  reminderTitle,
} from "../reminders";

/* The few facts the fleet adds to a task to make it a renewal reminder. The
   day is the one that matters: a reminder one day out is a reminder missed. */

describe("renewal reminders", () => {
  it("falls due the lead's days before the expiry, and on the day for zero", () => {
    expect(reminderDueDate("2027-09-29", 30)).toBe("2027-08-30");
    expect(reminderDueDate("2027-09-29", 14)).toBe("2027-09-15");
    expect(reminderDueDate("2027-09-29", 7)).toBe("2027-09-22");
    expect(reminderDueDate("2027-09-29", 0)).toBe("2027-09-29");
    expect(reminderDueDate("2027-03-01", 1)).toBe("2027-02-28"); // across a month end
  });

  it("offers the four leads and nothing else", () => {
    expect([...REMINDER_LEADS]).toEqual([30, 14, 7, 0]);
    expect(isReminderLead(14)).toBe(true);
    expect(isReminderLead(10)).toBe(false);
    expect(isReminderLead("30")).toBe(false);
    expect(leadLabel(30)).toBe("30 days before");
    expect(leadLabel(0)).toBe("On expiry");
  });

  it("titles the task for the vehicle, with the plate always", () => {
    expect(reminderTitle({ name: "WORK TRITON", plate: "YLI59V", make: "Mitsubishi", model: "Triton" }, "rego")).toBe(
      "Renew rego — WORK TRITON (YLI59V)",
    );
    // no fleet name: the make and model stand in
    expect(reminderTitle({ name: "", plate: "YLI59V", make: "Mitsubishi", model: "Triton" }, "ctp")).toBe(
      "Renew green slip — Mitsubishi Triton (YLI59V)",
    );
    // nothing but a plate: the plate, twice rather than a blank
    expect(reminderTitle({ name: " ", plate: "T77213", make: "", model: "" }, "insurance")).toBe(
      "Renew insurance — T77213 (T77213)",
    );
  });

  it("says when it expires and how much notice the chip gave", () => {
    expect(reminderDetail("2027-09-29", 30)).toBe("Expires 29 Sep 2027 · 30 days' notice");
    expect(reminderDetail("2027-09-29", 1)).toBe("Expires 29 Sep 2027 · 1 day's notice");
    expect(reminderDetail("2027-09-29", 0)).toBe("Expires 29 Sep 2027");
  });
});
