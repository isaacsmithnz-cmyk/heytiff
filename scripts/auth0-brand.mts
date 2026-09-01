/* Push the HeyTiff look into the Auth0 tenant.

     npm run auth0:brand -- --dry-run    render everything, change nothing
     npm run auth0:brand                 write it to the tenant

   WHY A SCRIPT AND NOT THE DASHBOARD. The sign-in page and the mail are the
   first and often only HeyTiff a person sees, and until now their design
   lived in a vendor's admin UI: unversioned, unreviewable, undiffable, and
   lost the moment somebody clicked something. Everything this pushes is
   generated from `src/lib/brand/auth0/`, which is generated from the app's
   own palette, which is checked against the app's own stylesheets by the
   test suite. A colour cannot drift here without a red test.

   THIS IS NOT PART OF THE APP. It runs from a terminal, on purpose. The
   running web app has no business repainting its own login page, and the
   scopes below are exactly the ones you would want an attacker not to have.

   ── CREDENTIALS, AND THE CHOICE WORTH MAKING ──────────────────────────────

   It reads AUTH0_BRANDING_CLIENT_ID / _SECRET if they are set, and falls
   back to the app's own AUTH0_CLIENT_ID / _SECRET if they are not. It always
   prints which pair it used, because the difference matters:

     the app's own pair    Nothing new to create. But the grant is attached
                           to the application that serves prod, so a server
                           compromise can rewrite every verification email
                           and the login page — phishing every user from the
                           real domain, with a valid link. That is a wider
                           blast radius than `update:users` (one account at a
                           time) already carries.

     a dedicated M2M app   One extra application in the tenant and two env
                           vars on ONE laptop. The running app never holds
                           branding scopes at all.

   The fallback exists so this works on day one; the dedicated pair is what
   it should end up on. docs/auth0-branding.md has the five-minute version.

   ── WHAT IT DOES NOT TOUCH ────────────────────────────────────────────────

   `enabled`   Which letters Auth0 sends is BEHAVIOUR, not dress. Turning on
               the welcome mail because it now looks nice would be a change
               nobody asked for, arriving in customers' inboxes.
   `from`      Belongs to the tenant's email provider and its verified
               domain. Setting it from here is how you make sending fail.
   `resultUrl` / `urlLifetimeInSeconds`  Where a link lands and how long it
               lives. Both behaviour.

   Only `subject`, `body` and `syntax` are written. */

import { brandAssets, BRAND_FILES } from "../src/lib/brand/auth0/assets.ts";
import { heytiffTheme, heytiffBranding } from "../src/lib/brand/auth0/theme.ts";
import { heytiffEmailTemplates } from "../src/lib/brand/auth0/templates.ts";
import { heytiffPageTemplate } from "../src/lib/brand/auth0/page-template.ts";
import { signInPreview, signInStatesPreview } from "../src/lib/brand/auth0/preview.ts";
import { PROMPT_TEXT, PROMPT_LANGUAGE } from "../src/lib/brand/auth0/prompts.ts";
import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";

const DRY = process.argv.includes("--dry-run");
const OUT = "tmp/auth0-preview";

/* ── environment ────────────────────────────────────────────────────────── */

const DOMAIN = req("AUTH0_DOMAIN");
const BASE_URL = req("APP_BASE_URL");
const usingDedicated = Boolean(
  process.env.AUTH0_BRANDING_CLIENT_ID && process.env.AUTH0_BRANDING_CLIENT_SECRET,
);
const CLIENT_ID = usingDedicated
  ? process.env.AUTH0_BRANDING_CLIENT_ID!
  : req("AUTH0_CLIENT_ID");
const CLIENT_SECRET = usingDedicated
  ? process.env.AUTH0_BRANDING_CLIENT_SECRET!
  : req("AUTH0_CLIENT_SECRET");

function req(name: string): string {
  const v = process.env[name];
  if (!v) {
    fail(
      `${name} is not set. This script reads .env.local — check the variable is in it.`,
    );
  }
  return v!;
}

/* APP_BASE_URL is stored INSIDE the tenant, in every logo and font URL Auth0
   will fetch for months. A localhost or preview origin here does not fail
   now — it fails later, as a broken logo on a screen nobody signed in to
   see, long after anyone remembers running this. */
if (!DRY && !/^https:\/\//.test(BASE_URL)) {
  fail(
    `APP_BASE_URL is "${BASE_URL}". Auth0 stores these URLs and fetches them from its own servers, so it must be the public https origin. Use --dry-run to render locally instead.`,
  );
}

/* ── what gets pushed ───────────────────────────────────────────────────── */

const assets = brandAssets(BASE_URL);
const theme = heytiffTheme(assets);
const branding = heytiffBranding(assets);
const emails = heytiffEmailTemplates(assets, BASE_URL);
const pageTemplate = heytiffPageTemplate(assets);

/* ── the Management API, minimally ──────────────────────────────────────── */

let token: string | null = null;

async function mgmt(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown; text: string }> {
  if (!token) {
    const res = await fetch(`https://${DOMAIN}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        audience: `https://${DOMAIN}/api/v2/`,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      fail(
        res.status === 401 || res.status === 403
          ? `Auth0 refused the client credentials (${res.status}).\n` +
              `  The application is not authorised for the Management API, or the\n` +
              `  scopes below are not ticked. See docs/auth0-branding.md.\n  ${detail}`
          : `Could not mint a Management API token (${res.status}). ${detail}`,
      );
    }
    token = ((await res.json()) as { access_token: string }).access_token;
  }

  const res = await fetch(`https://${DOMAIN}/api/v2${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 204s and html error pages */
  }
  return { status: res.status, json, text };
}

/** Every failure Auth0 returns for a missing scope reads the same way, and
    the fix is always the same sentence. Said once, with the scope named. */
function scopeHint(scope: string, status: number, text: string): string {
  if (status === 401 || status === 403) {
    return `missing the \`${scope}\` scope — tick it on the Management API grant (docs/auth0-branding.md)`;
  }
  return `${status} ${text.slice(0, 200)}`;
}

/* ── steps ──────────────────────────────────────────────────────────────── */

const results: { step: string; outcome: string; ok: boolean }[] = [];
const record = (step: string, ok: boolean, outcome: string) => {
  results.push({ step, outcome, ok });
  console.log(`  ${ok ? "✔" : "✗"} ${step} — ${outcome}`);
};

async function pushTheme() {
  const found = await mgmt("GET", "/branding/themes/default");

  if (found.status === 200) {
    const themeId = (found.json as { themeId?: string }).themeId;
    if (!themeId) return record("theme", false, "no themeId in the response");
    const res = await mgmt("PATCH", `/branding/themes/${themeId}`, theme);
    return record(
      "theme",
      res.status === 200,
      res.status === 200 ? `updated ${themeId}` : scopeHint("update:branding", res.status, res.text),
    );
  }

  /* 404 is Auth0's "this tenant has never had a theme", not an error. */
  if (found.status === 404) {
    const res = await mgmt("POST", "/branding/themes", theme);
    return record(
      "theme",
      res.status === 201 || res.status === 200,
      res.status < 300 ? "created" : scopeHint("update:branding", res.status, res.text),
    );
  }

  record("theme", false, scopeHint("read:branding", found.status, found.text));
}

/* The widget's words. Separate from the theme because Auth0 keys them by
   prompt and language, and separate from the page template because they land
   on a free tenant. */
async function pushPromptText() {
  for (const [prompt, text] of Object.entries(PROMPT_TEXT)) {
    /* PUT, and Auth0's own note is that it "replaces all existing
       configuration data" for this prompt and language — so what is sent is
       the whole of what we want customised, and every key left out falls
       back to Auth0's default on purpose. */
    const res = await mgmt(
      "PUT",
      `/prompts/${prompt}/custom-text/${PROMPT_LANGUAGE}`,
      text,
    );
    record(
      `prompt text ${prompt}`,
      res.status === 200 || res.status === 204,
      res.status < 300
        ? `updated (${PROMPT_LANGUAGE})`
        : scopeHint("update:prompts", res.status, res.text),
    );
  }
}

async function pushBranding() {
  const res = await mgmt("PATCH", "/branding", branding);
  record(
    "branding (logo, favicon, font)",
    res.status === 200,
    res.status === 200 ? "updated" : scopeHint("update:branding", res.status, res.text),
  );
}

async function pushEmails() {
  for (const t of emails) {
    const existing = await mgmt("GET", `/email-templates/${t.template}`);

    if (existing.status === 200) {
      const res = await mgmt("PATCH", `/email-templates/${t.template}`, {
        subject: t.subject,
        body: t.body,
        syntax: "liquid",
      });
      record(
        `email ${t.template}`,
        res.status === 200,
        res.status === 200
          ? `updated${(existing.json as { enabled?: boolean }).enabled === false ? " (still disabled — enablement untouched)" : ""}`
          : emailHint(res.status, res.text),
      );
      continue;
    }

    /* AUTH0 DOES NOT SEED THESE. A tenant that has never had a template
       saved answers 404 here and sends Auth0's own default mail instead —
       which is the state this tenant is in, so a 404 is normal, not damage.

       Creating one needs `from` AND `enabled`, and `enabled` is the reason
       this script will not do it unprompted: the letters differ in whether
       Auth0 sends them by default (the welcome mail is off), so a blanket
       `enabled: true` would start sending mail nobody asked for and a
       blanket false would silence a verification people depend on. Saving
       each once in the dashboard makes that decision explicitly, and
       everything after that is this script's to keep current. */
    if (existing.status === 404) {
      record(
        `email ${t.template}`,
        false,
        "not in the tenant yet — Auth0 is sending its own default. Open it once in Branding → Email Templates and save (that sets the `from` and the on/off decision, both of which are yours), then re-run and the HeyTiff body lands.",
      );
      continue;
    }

    record(`email ${t.template}`, false, scopeHint("read:email_templates", existing.status, existing.text));
  }
}

/** The one failure that is a tenant setting, not a mistake. */
function emailHint(status: number, text: string): string {
  if (/email provider/i.test(text)) {
    return "the tenant is still on Auth0's built-in email provider, which cannot take custom templates. Configure one under Branding → Email Provider first.";
  }
  return scopeHint("update:email_templates", status, text);
}

async function pushPageTemplate() {
  const res = await mgmt("PUT", "/branding/templates/universal-login", {
    template: pageTemplate,
  });
  if (res.status === 201 || res.status === 204 || res.status === 200) {
    return record("sign-in page template", true, "updated");
  }
  /* TWO PREREQUISITES, AND THE PLAN ONE ANSWERS FIRST. The documented gate is
     a custom domain — but a free tenant cannot buy one, so it never gets as
     far as saying so: it answers 402 on this endpoint. Both are
     configuration rather than bugs, and each names the thing that is
     actually missing. */
  if (res.status === 402) {
    return record(
      "sign-in page template",
      false,
      "skipped — page templates need a PAID Auth0 plan (402). Custom domains, which they also require, are part of the same paid tier. The theme above is live regardless, and is what makes the widget look like HeyTiff.",
    );
  }
  if (/custom domain/i.test(res.text)) {
    return record(
      "sign-in page template",
      false,
      "skipped — the tenant has no custom domain, and Auth0 gates page templates behind one. The theme above is live regardless.",
    );
  }
  record("sign-in page template", false, scopeHint("update:branding", res.status, res.text));
}

/* ── dry run ────────────────────────────────────────────────────────────── */

async function renderLocally() {
  await mkdir(OUT, { recursive: true });
  for (const t of emails) {
    await writeFile(join(OUT, `${t.template}.html`), t.body);
  }
  await writeFile(join(OUT, "page-template.liquid"), pageTemplate);
  /* The sign-in screen is otherwise unreviewable before it is live — the
     theme renders only inside Auth0's widget and the template needs a custom
     domain. Both are built from the very objects above, so the preview
     cannot drift from what gets pushed. See preview.ts for what is real in
     it and what is a stand-in. */
  await writeFile(join(OUT, "sign-in.html"), signInPreview(pageTemplate, theme, assets));
  await writeFile(
    join(OUT, "sign-in-states.html"),
    signInStatesPreview(pageTemplate, theme, assets),
  );
  await writeFile(
    join(OUT, "theme.json"),
    JSON.stringify({ theme, branding }, null, 2),
  );
  await writeFile(
    join(OUT, "subjects.txt"),
    emails.map((t) => `${t.template}\n  ${t.subject}\n`).join("\n"),
  );
  console.log(`\n  ${emails.length} letters, the sign-in screen and the theme → ${OUT}/`);
  console.log("  Open the .html files in a browser. sign-in.html is the page");
  console.log("  template with a stand-in for Auth0's widget — see preview.ts.\n");
}

/* ── go ─────────────────────────────────────────────────────────────────── */

async function main() {
  /* A logo URL that 404s is the failure mode nobody sees until a customer
     does, so the files are checked before anything is stored. */
  const missing: string[] = [];
  for (const f of BRAND_FILES) {
    try {
      await access(join("public/brand", f));
    } catch {
      missing.push(f);
    }
  }
  if (missing.length) {
    fail(
      `public/brand/ is missing ${missing.join(", ")}. Auth0 and every mail client fetch these over HTTPS; storing URLs to files that are not deployed puts a broken image on the sign-in screen.`,
    );
  }

  console.log(`\nHeyTiff → Auth0 (${DOMAIN})`);
  console.log(`  assets from ${BASE_URL}/brand/`);

  if (DRY) {
    console.log("  DRY RUN — nothing is written to the tenant\n");
    return renderLocally();
  }

  console.log(
    `  credentials: ${usingDedicated ? "AUTH0_BRANDING_CLIENT_ID (dedicated)" : "AUTH0_CLIENT_ID (the app's own — see the header of this file)"}\n`,
  );

  await pushTheme();
  await pushBranding();
  await pushPromptText();
  await pushEmails();
  await pushPageTemplate();

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n  ${results.length - failed.length}/${results.length} applied.${failed.length ? " The lines marked ✗ above say what each one needs." : ""}\n`,
  );
  if (failed.length) process.exitCode = 1;
}

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

await main();
