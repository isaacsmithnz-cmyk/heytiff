/* Every way one of these letters can be wrong without looking wrong.

   AN EMAIL IS UNTESTABLE ONCE SENT. There is no console, no re-render, and
   the audience is a customer at 6am. The failure modes worth guarding are
   the silent ones: a button whose href is the literal text `{{ url }}`
   because that template's variable is actually called `link`; an SVG logo
   Gmail strips to nothing; a monospace face nobody noticed. Each is asserted
   below against the per-template variable table Auth0 publishes.

   To see this fail: swap `{{ url }}` for `{{ link }}` in any template, or
   put a `font-family: monospace` on the code block. */

import { heytiffEmailTemplates, type TemplateName } from "../templates";
import { brandAssets } from "../assets";
import { BRAND } from "../palette";

const BASE = "https://app.example.com";
const assets = brandAssets(BASE);
const templates = heytiffEmailTemplates(assets, BASE);
const byName = new Map(templates.map((t) => [t.template, t]));

const get = (name: TemplateName) => {
  const t = byName.get(name);
  if (!t) throw new Error(`no template ${name}`);
  return t;
};

/* Auth0's published per-template variables. `url` and `link` are NOT
   interchangeable, and Welcome / Password Breach are given neither.
   https://auth0.com/docs/customize/email/email-templates/supported-liquid-syntax */
const VARIABLE: Record<TemplateName, "url" | "code" | null> = {
  verify_email: "url",
  verify_email_by_code: "code",
  reset_email: "url",
  reset_email_by_code: "code",
  blocked_account: "url",
  welcome_email: null,
  stolen_credentials: null,
};

describe("each letter uses its own Liquid variable and no other", () => {
  it.each(Object.keys(VARIABLE) as TemplateName[])("%s", (name) => {
    const { body } = get(name);
    const wanted = VARIABLE[name];

    if (wanted) expect(body).toContain(`{{ ${wanted} }}`);

    // The three that do not belong to this template. `link` is the trap:
    // it is a real Auth0 variable, for MFA enrolment, and renders as literal
    // text everywhere else.
    for (const other of ["url", "code", "link"] as const) {
      if (other === wanted) continue;
      expect(body).not.toContain(`{{ ${other} }}`);
    }
  });

  it("the two with no link variable point at the app's own door", () => {
    for (const name of ["welcome_email", "stolen_credentials"] as const) {
      expect(get(name).body).toContain(`${BASE}/auth/login`);
    }
  });

  it("blocked_account names where the attempt came from", () => {
    const { body } = get("blocked_account");
    for (const v of ["user.city", "user.country", "user.source_ip"]) {
      expect(body).toContain(`{{ ${v} }}`);
    }
  });
});

describe("what mail clients actually render", () => {
  it.each(templates.map((t) => t.template))("%s survives Gmail", (name) => {
    const { body } = get(name);

    // Gmail strips SVG entirely — a logo that is one renders as nothing.
    expect(body).not.toMatch(/<svg/i);
    expect(body).not.toMatch(/\.svg\b/i);

    // Layout is tables. A flex or grid container collapses in Outlook.
    expect(body).not.toMatch(/display:\s*(flex|grid)/i);
    expect(body).toContain("<table");

    // The mark is a PNG on our own https origin.
    expect(body).toContain(assets.chevron);
  });

  it.each(templates.map((t) => t.template))(
    "%s asks the client not to invert it — where asking works",
    (name) => {
      // HeyTiff has no dark half (globals.css). Apple Mail and Outlook.com
      // honour these and leave the letter alone.
      //
      // GMAIL ON ANDROID DOES NOT, and an earlier version of this comment
      // claimed otherwise. It force-inverts regardless, which is why the
      // header no longer depends on an image that cannot follow — see the
      // wordmark test below. These stay because they still work everywhere
      // else, not because they are a defence.
      const { body } = get(name);
      expect(body).toContain('name="color-scheme" content="light"');
      expect(body).toContain('name="supported-color-schemes" content="light"');
    },
  );

  it.each(templates.map((t) => t.template))(
    "%s survives a client that force-inverts the card",
    (name) => {
      const { body } = get(name);

      // THE WORDMARK MUST BE TEXT. As part of the logo PNG its ink "Hey"
      // vanished on Gmail Android's near-black card, because that client
      // inverts the page and not the images on it. Caught on a real phone.
      expect(body).toContain(">Hey</span>");
      expect(body).toContain(">Tiff</span>");

      // ...and the image beside it must be the gradient mark, which reads on
      // white and near-black alike — never the full lockup, whose wordmark
      // is baked ink.
      expect(body).toContain(assets.chevron);
      expect(body).not.toContain(assets.lockup);

      // THE BUTTON NEEDS AN EDGE. Gmail leaves this ink fill roughly alone
      // while darkening the card around it, so without a border it is
      // black-on-black and reads only by its label. A mid-tone survives the
      // inversion, which is why it is `--q` and not white or ink.
      if (/background-color:#0A0B10/.test(body)) {
        expect(body).toMatch(
          new RegExp(`background-color:${BRAND.ink};\\s*border:1px solid ${BRAND.quiet}`),
        );
      }
    },
  );

  it.each(templates.map((t) => t.template))("%s narrows on a phone", (name) => {
    // The `width="560"` attribute Outlook needs is what runs the card off a
    // 375px screen; only an !important override in the media query beats it.
    // Caught in the preview at mobile width, where the letter was clipped.
    const { body } = get(name);
    expect(body).toMatch(
      /@media only screen and \(max-width: 600px\) \{\s*\.ht-card \{[^}]*width:\s*100% !important/,
    );
  });

  it.each(templates.map((t) => t.template))("%s uses Jakarta and no mono", (name) => {
    const { body } = get(name);
    expect(body).toContain("'Plus Jakarta Sans'");
    // The app-wide ban. A verification code is where it always creeps back in.
    expect(body).not.toMatch(/monospace|Courier|Menlo|Consolas|JetBrains/i);
  });

  it("the codes are separated by tracking, not by a face", () => {
    for (const name of ["verify_email_by_code", "reset_email_by_code"] as const) {
      expect(get(name).body).toMatch(/letter-spacing:\s*0\.2\d*em/);
    }
  });
});

describe("the copy", () => {
  it("gives every letter a subject that names the product", () => {
    for (const t of templates) {
      expect(t.subject).toMatch(/HeyTiff/);
      expect(t.subject.length).toBeLessThanOrEqual(60);
      // No sentence-ending punctuation, no shouting — subjects are labels.
      expect(t.subject).not.toMatch(/[!.]$/);
    }
  });

  it("gives every letter a preview line that is not the subject again", () => {
    for (const t of templates) {
      expect(t.body).toMatch(/mso-hide:all/);
      expect(t.body).not.toContain(`>${t.subject}<`);
    }
  });

  it("prints the raw link for a one-time token, and only then", () => {
    // Corporate filters strip buttons, and a single-use link cannot be
    // retyped — so that letter is a dead end without the URL beside it. The
    // two whose button just opens the app get no such line: repeating the
    // front door's address under "Open HeyTiff" is the caption the house
    // rule deletes.
    for (const t of templates) {
      const href = t.body.match(/<a href="([^"]+)" style="display:inline-block/)?.[1];
      if (!href) continue;
      if (href.includes("{{")) {
        expect(t.body).toContain("Or paste this into your browser");
        expect(t.body.split(href).length - 1).toBeGreaterThanOrEqual(2);
      } else {
        expect(t.body).not.toContain("Or paste this into your browser");
        expect(t.body.split(href).length - 1).toBe(1);
      }
    }
  });

  it("never says HeyTiff was breached, in the one about a breach", () => {
    expect(get("stolen_credentials").body).toContain("HeyTiff was not breached");
  });
});

describe("the palette reaches the mail", () => {
  it("paints the card and the ground from the app's tokens", () => {
    for (const t of templates) {
      expect(t.body).toContain(BRAND.surface); // page ground
      expect(t.body).toContain(BRAND.line); // card hairline
      expect(t.body).toContain(BRAND.ink); // heading + button
      expect(t.body).toContain(BRAND.body); // body copy
      expect(t.body).toContain(BRAND.quiet); // footnotes
    }
  });

  it("uses no colour that is not in the palette", () => {
    const allowed = new Set(
      [...Object.values(BRAND), "#FFFFFF"].map((c) => c.toUpperCase()),
    );
    const strays = templates.flatMap((t) =>
      [...t.body.matchAll(/#[0-9a-fA-F]{6}\b/g)]
        .map((m) => m[0].toUpperCase())
        .filter((hex) => !allowed.has(hex))
        .map((hex) => `${t.template}: ${hex}`),
    );
    expect([...new Set(strays)]).toEqual([]);
  });
});

describe("only the flows that exist", () => {
  it("does not dress a letter HeyTiff never sends", () => {
    // user_invitation belongs to Auth0 Organizations; HeyTiff issues its own
    // invites as a copied link. MFA is not enabled. See templates.ts.
    const names = templates.map((t) => t.template);
    expect(names).not.toContain("user_invitation" as TemplateName);
    expect(names).not.toContain("enrollment_email" as TemplateName);
    expect(names).not.toContain("mfa_oob_code" as TemplateName);
  });
});
