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
| The widget's wording | `PUT /prompts/{login,signup}/custom-text/en` | `update:prompts` |
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
`update:email_templates`, `update:prompts`

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
written, tested and unsendable.

This is the same gap that makes an invite a copied link rather than a message
(`app/actions/invite.ts`). One provider closes both.

**Auth0 does not seed the templates, either.** A tenant that has never saved
one answers `GET /email-templates/{name}` with a 404 and sends Auth0's own
default mail — which is this tenant's state today. Creating one over the API
needs a `from` address *and* an `enabled` decision, and the script refuses to
make the second one: the letters differ in whether Auth0 sends them by
default (the welcome mail is off), so a blanket `enabled: true` would start
sending mail nobody asked for and a blanket `false` would silence a
verification people depend on.

So each template gets opened once in **Branding → Email Templates** and
saved — that one action sets the `from` and the on/off decision, both of which
are yours. Every push after that is this script's to keep current.

### 3. A paid plan, for the page template only

Auth0 documents the gate as a custom domain:

> To use customized page templates, you must configure a Custom Domain for
> your tenant.
> — [Auth0](https://auth0.com/docs/customize/login-pages/universal-login/customize-templates)

**In practice the plan answers first.** A free tenant cannot buy a custom
domain, so it never gets as far as saying so — `PUT
/branding/templates/universal-login` returns:

```
402 {"statusCode":402,"error":"Payment Required",
     "message":"A paid subscription is required for this feature."}
```

Confirmed against the live tenant on 2026-09-01.

**Everything else lands without either.** The theme — logo, every colour, the
real Jakarta face, radii, page ground — is not gated, and is what makes the
widget look like HeyTiff on the default `*.auth0.com` domain. That part is
**live now**.

What the paid tier adds is `src/lib/brand/auth0/page-template.ts`: the page
*around* the widget, with the app's own light behind it. Written and tested
already; the script attempts it every run and skips with the reason on the
line. Nothing else to do afterwards.

## The sentence under the logo

The first live push left the widget reading:

> Log in to **dev-zuqpsxjwzz45pr0u** to continue to Heytiff.

That is Auth0's own default, `Log in to ${companyName} to continue to
${clientName}.` — where `companyName` is the tenant's **Friendly Name**
(never set, so it falls back to the raw tenant id) and `clientName` is the
**application's name** (spelled `Heytiff`).

**Two ways to fix it, and this repo takes the second.** Setting the tenant's
Friendly Name in the dashboard would make the sentence read correctly and
leave Auth0 owning it — a value typed into an admin UI, invisible from here,
still phrased in Auth0's voice. Overriding the prompt text moves the sentence
into `src/lib/brand/auth0/prompts.ts`, where it is reviewed and versioned like
every other string on the sign-in screen. That is the argument for the whole
directory, so it holds here too.

It also fixes a **second, invisible copy of the same bug**: `logoAltText`
defaults to `${companyName}`, so the logo's alternative text — what a screen
reader announces, and the only HeyTiff anyone gets if the image fails — was
reading the tenant id too.

### Why the line does not say "HeyTiff"

Correcting both fields would have produced *"Sign in to HeyTiff to continue to
HeyTiff"*, and the doubling — not the tenant id — is what makes that sentence
read badly. Even the single-mention version, *"Sign in to HeyTiff."*, is the
screen saying the same thing twice: the lockup is 40px above it, in the
brand's own letters.

So the logo says **who** and the line says **what**:

> **Welcome**
> Sign in to continue.

"Sign in", not Auth0's "Log in", because that is the verb the app uses
everywhere else — the front door, the profile's *sign-in address*, the invite
copy. One flow should not disagree with itself about what the user is doing.

### The tab title, and why it *does* say HeyTiff

The browser tab read `Log in | Heytiff` — the `pageTitle` key, whose default is
also templated on `${clientName}`, so it carried the application's misspelled
name.

Setting it to **`Sign in to HeyTiff`** is not a contradiction of the rule
above. The subtitle sits directly beneath a lockup that has already said
HeyTiff in the brand's own letters; a tab title sits in a strip of a dozen
other tabs with nothing beside it, and one reading only "Sign in" is one
nobody can find. Same rule — *say it where nothing else is saying it* — with
the opposite answer.

This is also why the **application does not need renaming** to fix what people
see. Its name is only visible through `${clientName}`, and every place that
reached the sign-in screen is now written here instead.

**Only the three wrong keys are sent.** The PUT "replaces all existing
configuration data" for that prompt and language, and every key left out falls
back to Auth0's default — which is what is wanted for `title`, `buttonText`
and `forgotPasswordText`, all of which were already right. Restating them
would be ten strings to keep in step with a vendor's copy for the sake of
three.

### `update:clients` is deliberately NOT in the grant

Renaming the application itself needs `update:clients`, and that scope also
rewrites an application's **callback and logout URLs**. On the credentials the
production web server holds, that is a redirect-URI hijack waiting to happen:
point `callbacks` at another origin and authorization codes go there instead.
Trading that for a cosmetic rename is a bad deal, so the rename — if it is
still wanted for the Auth0 dashboard's own listing — is a ten-second field in
**Applications → Settings → Name**, done by a human.

### The same sentence on the sign-up screen

Until an invitation started landing people on Auth0's sign-up tab, nobody ever
saw that screen, and it still read `Sign Up to dev-zuqpsxjwzz45pr0u to continue
to Heytiff.` — the identical fault, plus a tab title of `Sign up | Heytiff` and
a logo announced as the tenant id. `signup` is now written alongside `login`.

**A wrong key name is the failure mode to design against.** Auth0's request
schema is `additionalProperties: true`: a misspelled key is accepted, the
script prints `✔ prompt text signup — updated (en)`, and the screen does not
change. So the names are not written from memory. They came off Auth0's own
published table — the current source, `auth0/docs-v2`, cross-checked against
the legacy `auth0/docs` per-prompt markdown and a JSON fixture in
`auth0/auth0-cli`. Note that Auth0's *rendered* table silently drops
`pageTitle` from every screen: its default value contains an unescaped `|`,
which splits the row into three cells in a two-column table and the third is
discarded. Read the markdown source, not the page.

**And check the screen, not the response.** The sign-up screen is public and
unauthenticated, so the push is falsifiable in one command — the transaction
cookie matters, `curl -L` alone gets a 400:

```bash
curl -sL -c /tmp/j -b /tmp/j -A Mozilla \
  "https://$AUTH0_DOMAIN/authorize?client_id=$AUTH0_CLIENT_ID&response_type=code\
&redirect_uri=$APP_BASE_URL/auth/callback&scope=openid&screen_hint=signup&state=x&nonce=x" \
  | grep -o '<title>[^<]*</title>\|Create your account[^<]*'
```

A key that did nothing leaves the old sentence standing where a diff of the
request body cannot see it. The grant has `update:prompts` but **not**
`read:prompts`, so the API cannot be asked what it stored — the page is the
only way to know, and it is the better one, because it is what a person sees.

**Which sign-up screen renders depends on a tenant setting.** `signup` is the
classic one-page form and is what this tenant serves. Turning on
identifier-first swaps it for `signup-id` then `signup-password`, which carry
the same defaults under their own key sets and are deliberately not written —
text pushed to a screen that does not render is text nobody can check.

`reset-password` is still unwritten. It is one prompt spanning five screens
that a single PUT replaces together, so every screen wanted has to go in one
call — and unlike `signup` it has never been looked at, so there is nothing yet
to say is wrong with it. Reaching it needs a real password-reset transaction,
which sends a real letter.

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
