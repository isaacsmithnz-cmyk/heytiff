/* The projects Urgent queue's generative rules, held still.

   Same law as the maintenance side: rows derive from facts, fire iff their
   rule matches, and clear by construction when the fact changes. The board's
   one rule — nothing appears twice — is enforced by folding every
   project-level finding into ONE row per project (worst wins, the rest ride
   as chips) while visit rows stay per-trip because they're actioned
   per-trip. */

import {
  sm8BookingMismatch,
} from "../project-rules";

// Thursday

describe("sm8BookingMismatch (show + chip, never auto-write)", () => {
  it("agrees, differs, or knows something we haven't placed", () => {
    expect(sm8BookingMismatch("2026-08-04", "2026-08-04 07:30:00")).toBe("none");
    expect(sm8BookingMismatch("2026-08-04", "2026-08-06 07:30:00")).toBe("differs");
    expect(sm8BookingMismatch(null, "2026-08-06 07:30:00")).toBe("diary_only");
    expect(sm8BookingMismatch(null, null)).toBe("none");
    expect(sm8BookingMismatch("2026-08-04", null)).toBe("none");
  });
});
