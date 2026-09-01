# The sign-in screen and the mail

The Auth0 login widget and every letter Auth0 sends — verification, password
reset, the security notices — are designed in this repo and pushed to the
tenant by a script.

```bash
npm run auth0:brand -- --dry-run
```

renders all of it into `tmp/auth0-preview/` and changes nothing:

| file | what it is |
| --- | --- |
| `sign-in.html` | **the sign-in screen.** The page template verbatim, with a stand-in for Auth0's login prompt dressed in the real theme values |
| `sign-in-states.html` | the same, showing an error and a social button |
| seven `*.html` | the letters |
| `page-template.liquid` | what actually gets `PUT` |
| `theme.json` | what actually gets `PATCH`ed |

**Why `sign-in.html` exists at all.** Two of the three things this pushes are
invisible until they are live — the theme renders only inside Auth0's widget,
and the page template needs a custom domain before Auth0 will accept it. Without
a local preview the only way to review the sign-in design is to push it to the
real tenant and sign out, which is reviewing it in front of customers.

Read it for the design, not for Auth0's DOM: the page chrome is the template
verbatim and every colour, radius and font size is read from the theme object
that gets pushed, but the widget's *markup* is a stand-in — Auth0 draws that and
does not publish it. `src/lib/brand/auth0/preview.ts` says which is which.

```bash
npm run auth0:brand
```

writes it to the tenant.

## Why it isn't clicked into the dashboard

The sign-in page and the verification email are, for a lot of people, the
first HeyTiff they ever see and sometimes the only one they see that week.
Until now their design lived in Auth0's admin UI: unversioned, unreviewable,
undiffable, and one stray click from gone.

Everything the script pushes is generated from `src/lib/brand/auth0/`, which
reads the app's own palette, which is checked against `globals.css` and
`shell.css` by the test suite. A colour cannot drift on the sign-in screen
without a named test failure. See `src/lib/brand/auth0/palette.ts` for the
argument in full.

## What it pushes

| | endpoint | needs |
| --- | --- | --- |
| Widget theme — colours, radii, the Jakarta face, the logo | `PATCH /branding/themes/{id}` | `update:branding` |
| Logo, favicon, font, primary colour | `PATCH /branding` | `update:branding` |
| Seven email templates | `PATCH /email-templates/{name}` | `update:email_templates` |
| The page around the widget | `PUT /branding/templates/universal-login` | `update:branding` **and a custom domain** |

It also reads (`GET /branding/themes/default`, `GET /email-templates/{name}`),
so `read:branding` and `read:email_templates` are needed too.

### What it deliberately does not touch

- **`enabled`** on any template. *Which* letters Auth0 sends is behaviour, not
  dress. Turning the welcome mail on because it now looks good would put a
  message in customers' inboxes that nobody asked for.
- **`from`**. It belongs to the email provider and its verified domain.
  Setting it from here is how you make sending fail.
- **`resultUrl`, `urlLifetimeInSeconds`.** Where a link lands, and how long it
  lives. Both behaviour.

Only `subject`, `body` and `syntax` are written.

## The three things that have to be true first

### 1. The Management API grant

Auth0 dashboard → **Applications → APIs → Auth0 Management API → Machine to
Machine Applications** → find the application → **Authorized** → tick:

`read:branding`, `update:branding`, `read:email_templates`,
`update:email_templates`

This is the same grant [the sign-in-address change](./auth0-management-grant.md)
uses for `update:users`. If a scope is missing the script says which one, by
name, on the line that failed.

**Consider a separate application for this.** The scopes above let their
holder rewrite the login page and every verification email — which is
phishing every user, from the real domain, with valid links. That is a wider
blast radius than `update:users` (one account at a time). The web app has no
reason to hold them at runtime: it never repaints its own login page.

To split them, create a second Machine-to-Machine application in Auth0, give
*it* the four branding scopes (and leave `update:users` on the app), then put
its credentials in `.env.local` on one machine:

```
AUTH0_BRANDING_CLIENT_ID=...
AUTH0_BRANDING_CLIENT_SECRET=...
```

The script prefers those when present and prints which pair it used. Without
them it falls back to `AUTH0_CLIENT_ID` / `AUTH0_CLIENT_SECRET`, which works
and is the wider grant.

### 2. An email provider — or there are no branded emails at all

> Email template customization is not available when using the built-in email
> provider.
> — [Auth0](https://auth0.com/docs/customize/email/email-templates)

The tenant is on Auth0's built-in development provider, which is rate-limited,
not for production, and **cannot take a custom template**. Until a real one is
configured under **Branding → Email Provider**, the letters in this repo are
written, tested and unsendable, and the script reports that in those words
rather than as a failure.

This is the same gap that makes an invite a copied link rather than a message
(`app/actions/invite.ts`). One provider closes both.

### 3. A custom domain, for the page template only

> To use customized page templates, you must configure a Custom Domain for
> your tenant.
> — [Auth0](https://auth0.com/docs/customize/login-pages/universal-login/customize-templates)

**Everything else lands without one.** The theme — logo, every colour, the
real Jakarta face, radii, page ground — is not gated, so the sign-in widget
looks like HeyTiff on the default `*.auth0.com` domain today.

What the custom domain adds is `src/lib/brand/auth0/page-template.ts`: the
page *around* the widget, with the app's own light behind it. It is written
and tested already; the script attempts it and, on a tenant without a domain,
skips it with that reason on the line. Nothing else to do afterwards.

## The assets

`public/brand/` holds the four files Auth0 and every mail client fetch over
HTTPS from our own origin:

| file | used by |
| --- | --- |
| `heytiff-lockup.png` | the widget logo, and every email header |
| `heytiff-chevron.png` | the mark alone |
| `favicon.png` | the sign-in tab |
| `plus-jakarta-sans.woff2` | the widget's font, and Apple Mail's |

They are **not** the same set as `_design/brand/`, which is the kit — SVG
sources, print and mono variants, none of it served. The lockup PNG has the
Jakarta outlines baked in, because a mail client will not load a webfont for a
logo, and Gmail strips SVG entirely.

The font is a second copy of one the app already self-hosts through
`next/font`, deliberately: that copy sits at a content-hashed path that moves
with every build, and Auth0 stores the URL it is given and fetches it months
later.

`APP_BASE_URL` is what these URLs are built from, and the script refuses to
run against anything that is not `https://` — a preview or localhost origin
stored in the tenant does not fail now, it fails later, as a broken logo on a
screen nobody signed in to see.

## The seven letters, and the four that aren't here

Written: `verify_email`, `verify_email_by_code`, `reset_email`,
`reset_email_by_code`, `welcome_email`, `blocked_account`,
`stolen_credentials`.

Not written, on purpose: `user_invitation` (Auth0 Organizations invites —
HeyTiff issues its own), `enrollment_email` and `mfa_oob_code` (no MFA), and
the passwordless templates (no passwordless connection). Dressing a letter for
a flow that has never fired is how the next person concludes the flow exists.

**The Liquid variables are per-template and not interchangeable.** Auth0 gives
`url` to the verification link, the password-reset link and the blocked
account; `code` to the two by-code variants; `link` — a different name for the
same idea — to MFA enrolment; and *neither* to the welcome and breach letters,
whose buttons therefore point at the app's own front door. Getting this wrong
renders a button whose href is the literal text `{{ url }}`, and
`src/lib/brand/auth0/__tests__/emails.test.ts` fails if any template reaches
for a variable that is not its own.

## Reading the failures

Every line the script prints is either `✔ <what> — <outcome>` or
`✗ <what> — <what it needs>`. The three you should expect to see until the
steps above are done:

- *missing the `update:branding` scope* → the grant, step 1.
- *the tenant is still on Auth0's built-in email provider* → step 2.
- *skipped — the tenant has no custom domain* → step 3, and only the page
  template is affected.
