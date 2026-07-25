import { heroHtml } from "../screens";
import { heroAction, licenceChip, sortChips } from "@/lib/dashboard/chips";

/* The hero reaches the DOM through dangerouslySetInnerHTML (home.tsx), so every
   value that came from a person has to be escaped on the way in — the same
   guarantee profile.test.ts and org-settings.test.ts make for their screens.

   The action band is the one that matters. `sub` is built from a chip's label
   and subject, and those are a licence type name, a vehicle's name or plate, a
   staff member's name or the insurer — all user-entered. A licence is
   self-service (addMyLicence is intrinsic), and a licence chip surfaces on the
   dashboard of everyone holding `team`, so an unescaped label would be stored
   XSS that one person could aim at their managers. */

const PAYLOAD = `<img src=x onerror="alert(1)">`;

describe("heroHtml — escaping", () => {
  it("escapes a licence type name carried into the action band", () => {
    const chip = licenceChip(
      { id: "lic-1", typeName: PAYLOAD, expiryDate: "2026-08-01" },
      { subject: "Isaac Smith", href: "/dashboard/profile", today: "2026-07-25" },
    );
    expect(chip).not.toBeNull();

    const html = heroHtml({
      greeting: "Good morning",
      firstName: "Isaac",
      date: "Fri 25 Jul",
      action: heroAction(sortChips([chip!]), "/dashboard/action-required"),
    });

    expect(html).not.toContain(PAYLOAD);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("escapes the subject — a vehicle name or plate is user-entered too", () => {
    const html = heroHtml({
      greeting: "Good morning",
      firstName: "Isaac",
      date: "Fri 25 Jul",
      action: {
        state: "bad",
        title: "1 thing needs your attention",
        sub: `Rego expired 4d ago · ${PAYLOAD}`,
        href: "/dashboard/action-required",
      },
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("escapes the viewer's own name in the greeting", () => {
    const html = heroHtml({
      greeting: "Good morning",
      firstName: `<script>alert(1)</script>`,
      date: "Fri 25 Jul",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("still renders the ordinary case unchanged", () => {
    const html = heroHtml({
      greeting: "Good morning",
      firstName: "Isaac",
      date: "Fri 25 Jul",
      action: {
        state: "ok",
        title: "All clear",
        sub: "Nothing due in the next 30 days",
        href: "/dashboard/action-required",
      },
    });
    expect(html).toContain("Good morning,");
    expect(html).toContain("<span>Isaac.</span>");
    expect(html).toContain("All clear");
    expect(html).toContain('href="/dashboard/action-required"');
  });
});
