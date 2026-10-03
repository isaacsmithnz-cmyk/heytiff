# Certificates on a job: plan

Status: built 2026-10-01, on branch `ccr-cbcfb7b2-v9vfy8`, steps 1 to 8 of the
build order. Phase 2 is not built. Where the build differs from this plan, "As
built" at the end says how and why. Everything decided is listed there too,
and so is what must be on file before the first certificate can be issued.

## Why

Builders ask for a "compliance certificate" once the job is done, so their
certifier can issue the Occupation Certificate. On 2026-10-01 job 1383
(74/10 Etham Ave, Darling Point, for Reed Developments) needed one. It was
put together by hand in a chat, from two kinds of fact:

- **What HeyTiff already holds:** the job's address, client and contact, the
  equipment in the work-done description, the team's licences, the business's
  ABN and insurance.
- **What the certifier asked for:** the builder had forwarded FutureCert's
  "Occupation Certificate: List of Requirements". Its item 9.1 said exactly
  what the mechanical certificate had to state.

Usually there is no list. The builder just asks for the certificate. So the
certificate has to stand on its own, and take the list into account when there
is one.

A certificate is the same kind of paper as a SWMS: HeyTiff writes it from
approved wording, a person fills in what only they know, and an issued version
never changes. It follows the SWMS build, piece for piece.

## What the certificate is

**Evidence, not a statutory certificate.** In NSW only a registered certifier
issues a "compliance certificate". Ours is documentary evidence the certifier
relies on to issue the Occupation Certificate (EP&A (Development Certification
and Fire Safety) Regulation 2021). NCC A5G3 accepts a certificate from an
appropriately qualified person as evidence of suitability. Evidence is only as
good as its facts, so the certificate is built from four things: who did the
work, what was installed and where, the test results, and the standards it was
done to.

**It proves the work was done correctly, and nothing more.** Isaac: "All we're
doing is sort of finding that the work has been done correctly." It does not
walk through standards the job isn't about. It does not describe features
(wi-fi, zones, grille styles), and it does not claim a measurement nobody
took.

**One certificate, covering air conditioning, ventilation or both.** The person
chooses, and the choice gives the certificate its title: "Air conditioning
compliance certificate", "Ventilation compliance certificate", or "Air
conditioning and ventilation compliance certificate". In the data it is one
type, `mechanical`. There is no type picker until a second kind of
certificate exists.

**NSW first.** The standards (AS/NZS 5149, AS 4254, AS 1668), the building
classes and the ARC licence are national. The contractor licence, BASIX, the
noise regulation and the Occupation Certificate process are NSW. v1 writes the
NSW version, and the state comes from the job's address, as the SWMS's
jurisdiction already does.

## What the person does

1. On the job's Documents face, **Create certificate** sits beside Create SWMS.
   It is offered on any job, not only a finished one. Job 279's own card is
   still a Work Order while its last claim, 279E, is complete. A certificate
   belongs to the job card, never to a claim.
2. The wizard opens with most of it already filled in (see Prefill). The
   person corrects, adds and confirms.
3. **Issue** freezes a version, prints it to PDF and files the PDF on the job.
4. The screen after Issue offers three buttons. Nothing happens on its own:
   - **Email to the builder.** This opens the existing email draft
     (`readEmailDraft`) with the builder's contact first and the certificate
     ticked. The subject is "Air conditioning compliance certificate:
     <address>". The message ends with one line: "If your certifier has sent a
     list of requirements, forward it and we'll match the certificate to it."
   - **Send to ServiceM8**, through the existing footer path (`job-sm8.ts`).
   - **Download PDF**, and on a phone the phone's own share sheet.

   The PDF is also an ordinary row on the Documents face, so all three stay
   available later from the footer.
5. If a certifier's list arrives later, attaching it and choosing **Reissue**
   makes version 2, matched to the list. Version 1 stays on file, as a SWMS
   revision does.

## The wizard

Five steps, each one screen: **What it covers, Equipment, Certifier's list,
Checks, Sign.** It is a screen, so it follows `docs/design.md`: ink and paper,
large options rather than chips, no hint text.

### 1. What it covers

Two questions, each a row of large options.

- **What are you certifying?** Air conditioning, Ventilation, or both. This
  sets the title, which tables the paper has, and which statements are
  offered.
- **What kind of building?** Isaac kept this on 2026-10-01, with the options
  worded so each one is true for its class:
  - House, townhouse or duplex (Class 1a)
  - Apartment building (Class 2)
  - Office (Class 5)
  - Shop, café or restaurant (Class 6)
  - Other or not sure (no class is printed)

  Nothing is preselected: the person picks one every time, and the
  certificate can't issue until they do. The option the address suggests
  says so on its second line ("The address suggests this"), with the reason
  above the options. An address can't settle it: a "2/15" unit can be a
  villa (Class 1a), and townhouses over a shared basement car park are
  Class 2. When the certifier's list states the class, the list wins.

  The building changes very little, on purpose. It is printed. It adds no
  statement and ticks nothing (Isaac, 2026-10-03: nothing goes on that wasn't
  needed). It only offers a reason when something asked for doesn't apply
  ("house: energy efficiency is set by the BASIX certificate").

### 2. Equipment

Filled in from the job (see Prefill), then corrected.

- **Air conditioning:** each outdoor unit, then its indoor units, with each
  row's location, model and capacity. Identical units in neighbouring rooms
  can share a row ("Bedrooms 1, 2, 3", "3 × PEFY-P32VMX-E1"). When a job has
  more than one outdoor unit, rows are grouped under the outdoor unit they
  run from. The total indoor capacity is calculated, never typed. Job 1383's
  job sheet said "29 kW" for units that add up to 19.8.
- **Ventilation:** each fan's location and model, and its airflow (see The fan
  list).
- **Serial numbers** are optional in v1, because nothing captures them yet.
  The paper shows a serial column only when at least one row has a serial.
  Phase 2 reads them off nameplate photos.
- **What else was installed**, as two ticks, each suggested from the quote:
  - ductwork, plenums or flexible duct
  - penetrations through fire-rated walls or floors (asks which fire-stopping
    product was used)

### 3. Certifier's list

Optional, and skipped with one button. See The certifier's list below. When a
list is attached, Tiff reads it, the person confirms what was read, and its
requirements join the Checks.

### 4. Checks

One card per statement the certificate will make (see What the certificate
says). Each card asks only the questions its statement needs.

- **Refrigerant tests**, per outdoor unit, typed and never assumed: the test
  pressure and how long it held, the vacuum reached in microns, the
  refrigerant, and the kg added. One set of figures can be applied to every
  circuit and then changed where one differs. Zero kg is a valid answer, and
  prints as "no additional charge needed for the pipe length installed".
- **A vacuum above 500 microns** needs the manufacturer's own figure. The
  statement then says it was evacuated to the manufacturer's figure.
- **Fire mode**, only when a certifier asks for it, is one of three answers,
  and the wording follows the answer:
  - *Individual room units, each rated at no more than 1000 L/s, not part of
    smoke control:* no shutdown is needed. The person confirms the ratings
    from the units' spec sheets. No airflow figure is printed for air
    conditioning.
  - *Shuts down on a fire signal:* the interface, and the date it was tested.
  - *Part of a smoke control system:* the wizard stops. That needs the
    mechanical engineer's certificate, not ours.
- **Requirements from the certifier's list** that matched nothing: each one is
  written by the person, or marked not applicable with a reason.

### 5. Sign

The signatory is whoever is issuing. Their role doesn't matter. What they hold
does: their own current **ARC licence** and **contractor licence**, read from
their staff card and printed on the certificate. Their signature is the one
stored on their staff card. Then they Issue.

## Other states (2026-10-03)

The wording is national except for how a state approves building work. The
form asks which state the job is in, read off the job's address (a version
saved before this is a NSW job: there was no other).

- **NSW** keeps its own words: the Construction Certificate or Complying
  Development Certificate and the conditions of consent, and BASIX as the
  reason Section J doesn't apply to a house.
- **Every other state** gets plain words naming no state's instruments: "the
  approved building documents and the conditions of the building approval",
  and the NCC Housing Provisions for a house's energy efficiency.
- **What a state's certifier asks for** is read from their list or email in
  Requirements, as anywhere else.
- **The form also names the state's own certificate where there is one**,
  which this goes alongside and never replaces: Victoria's VBA plumbing
  compliance certificate (air conditioning is plumbing work there),
  Queensland's Form 16, Tasmania's Form 55; elsewhere, check with the
  certifier.

The licence line still reads "Contractor licence"; what that is differs by
state (VBA registration, QBCC licence, SA building work contractor licence).

## What the certificate says

Every statement is short and names its standard, nothing more. The clauses are
approved wording in a pure library, `lib/certs/mechanical.ts`, which the owner
approves before anything issues, in Admin → Templates → Mechanical Compliance
Certificate.

The certificate's template reads top to bottom as the certificate does (the
job, the equipment, the statements, not applicable, the signature) and shows
each statement once (`SHOWN`), grouped by when it
prints: every air conditioning certificate, every ventilation certificate,
what was installed, what was asked for. What the person types is named in
brackets and what depends on the job is in the quiet colour, so a statement
with three wordings is one line, not three. A test holds every wording the
library can print to one of its clause's lines, so a statement the owner
hasn't read can't print. An approval keeps the lines it approved
(`cert_template_approvals.wording`), so the next version marks what changed
and opens on just those. The bell asks the owner until this version is
approved. "I certify that:", the "Not applicable:" line and the "Not
covered:" line come from the library too.

Library mech-2026.10.1 (2026-10-03) is approved again: the page had left
out condensate, commissioning and Section J with ductwork, and the wording
was tidied (title case for the document's name, "air conditioning" without a
hyphen, "1,000 L/s", "Refrigerant R32, no additional charge.", and a "Not
applicable" line that reads as two sentences instead of three colons).

**Every air conditioning certificate:**

1. **Refrigerant circuit:** installed, strength and tightness tested with
   oxygen-free nitrogen, evacuated below 500 microns, charged and commissioned
   to AS/NZS 5149.2 and the ARC Refrigerant Handling Code of Practice (2025).
   The test figures print with it.
2. **Installed to the manufacturer's instructions**, when nothing was asked
   for.
3. **Condensate** drained to a suitable point without damage or nuisance.
4. **Commissioned:** run and checked in heating and cooling, with operating
   instructions and the maintenance schedule handed over.
5. **Refrigerant handled** by people holding an ARC licence.

**Every ventilation certificate:**

1. **Each fan's airflow**, when added, marked as rated or measured (see A
   fan's airflow).
   NCC 2022 sets 25 L/s for a bathroom or toilet and 40 L/s for a kitchen or
   laundry: Housing Provisions 10.8.2 for houses, Part F8 of Volume One for
   apartments.
2. **Discharge to outdoor air**, only when the person answers that every
   exhaust fan discharges outdoors. The form always asks (yes, not every one,
   or no exhaust fans) and never assumes it: job 2933's bathroom fan was
   ducted into a warehouse. A request for it on a job where the answer is no
   blocks the issue until it is marked not applicable.

**Added by what was installed:**

- Ductwork, plenums or flexible duct: AS 4254.1 and AS 4254.2.
- Fire-rated penetrations: sealed with the named fire-stopping product to keep
  the element's fire resistance level.

**Only when the certifier's list asks for it:**

- Installation to AS/NZS 1668.1 and AS 1668.2, or to AS 1668.2 alone.
- Fire mode (Specification 21 and AS/NZS 1668.1), as one of the three answers.
- BCA Part J5: pipework insulated, and each unit can be switched off when its
  space is unoccupied.
- Kitchen exhaust, car park ventilation, or an air balance report. A report
  is attached, or marked as by others.
- Outdoor unit noise. The certificate can say the unit is where the approved
  plans put it. It cannot say what it measures unless someone measured it.
  (In NSW a home air conditioner must not be heard in a neighbour's room
  overnight: POEO (Noise Control) Regulation 2017, reg 45.)

**Not applicable** is printed only for something the certifier asked for,
with its reason. A certificate doesn't list the standards it isn't about.

**Not covered** prints only when the person types something (for example,
"the building's outdoor-air ventilation"). What a certificate covers is its
tables, so nothing is ruled out by default (Isaac, 2026-10-03).

**Never ours:**

- A smoke control system. That needs the mechanical engineer's certificate.
- The fire safety assessment. A measure on the building's fire safety
  schedule, such as air conditioning shutdown on alarm, is assessed for the
  fire safety certificate by an Accredited Practitioner (Fire Safety). By law
  that person cannot be the installer. Our fire-mode statement only says what
  was installed and how it behaves.

## A fan's airflow

Isaac: "we don't measure every airflow against design", and for "tiny little
ceiling exhaust fans" nobody should type a figure at all.

- **No figure unless somebody adds one** (2026-10-03). A fan is its room and
  model. Each fan has an "Add its airflow" tick box; ticked, it asks for the
  L/s and whether that is rated or measured. Unticked, the certificate prints
  no airflow for that fan, and the table drops the column when no fan has one.
- **A figure on the accepted quote waits behind the tick box**, filled in
  but not printed until it is ticked.
- **No fan list.** There was one (a model with its rated L/s, filled in
  wherever the model was typed). It was removed on 2026-10-03: the figure is
  only printed when asked for, and then it is typed. The `fan_models` table
  is left in place, unused.
- **Rated** is the manufacturer's figure at the duct run installed, read off
  the fan curve rather than the free-air number. **Measured** is a reading on
  site (a vane anemometer and hood). The paper always says which: a rated
  figure is never printed as measured.
- **The NCC minimum** is claimed only when every wet-area fan shows a figure,
  and a ticked figure under it stops the issue.
- **When a certifier wants more**, such as an air balance or commissioning
  report on a commercial job, the wizard asks for the report to be attached,
  or marked as by others.

## The requirements (the wizard's "Requirements" step)

Whatever says what this certificate has to cover, from whoever asked: a
certifier's list, an email from the builder or architect, a spec. The step is
named for what it holds, not who sends it, and it is optional.

**As built, it is one text box and a file.** Paste an email or a list, or
type a few lines; pick a file on the job (ServiceM8's PDFs, and anything
uploaded here) or upload one. One "Read it" button reads whatever is there,
text and file together, and lists each thing asked for to check. Edit either
after reading and it says "Not read yet".

**No certifier is asked for, read or printed** (Isaac, 2026-10-01; removed
from the code 2026-10-03). The answers and the paper have no certifier
field, and Tiff reads only the requirements, not who sent them. The
`certifier_profiles` table and `certificate_versions.certifier_profile_id`
are in production but unused; nothing writes them.

The section below describes the commonest case, a certifier's list, which is
a table of items, one per trade, whose mechanical item is the brief for our
certificate.

1. **Bring it in**, one of three ways, all on the wizard's Certifier's list
   screen:
   - **File the builder's email on the job in ServiceM8** (its Inbox: forward
     the email there and add it to the job). Its PDF attachments land on the
     job, the card brings them across, and the screen lists them marked
     "ServiceM8". This is the usual way: the account already holds 709 PDFs
     that arrived like this. "Look again" brings across one filed a minute ago.
   - **Upload the PDF or a photo** right on the screen. It is filed on the
     job's Documents, as the Documents face's own upload files it.
   - **Paste the email**, for when what the certificate must cover is in the
     builder's own words and not an attached list.
2. **Tiff reads it**, on the same scan-then-confirm contract as a licence or
   insurance policy (`org-credential-ai.ts`): one model call fills the form,
   the person checks it against the paper, and nothing is saved until they
   do. It reads:
   - every requirement under the mechanical item, one line each, word for word
3. **Each requirement is matched to a clause** in the library, by the model
   with the clause list in front of it. The person sees each requirement next
   to its clause, and can change either.
4. **Nothing is invented.** A requirement that matches nothing is written by
   the person (printed as typed, the SWMS rule for site-specific controls) or
   marked not applicable with a reason. Issue is blocked until every one is
   resolved.
5. **The certificate answers in the certifier's order**, so they can tick it
   off against their own list. The other trades' items (electrical, glazing,
   BASIX) are left alone.

**Not remembered, on purpose.** Certifiers change from job to job, even for
the same builder, so nothing is carried over: this job's certifier comes off
this job's list or email, or is typed. Names already used are offered as the
field's suggestions, so FutureCert is spelled the same way twice, and that is
all.

## Prefill: where each fact comes from

| Fact | Source | Phase |
|---|---|---|
| Address, client, completion date | `sm8_jobs`, the card and its claims | 1 |
| Builder contact | `sm8_job_contacts`, then `sm8_company_contacts` (as `readEmailDraft` does) | 1 |
| Business name, ABN, address, logo | `organizations` through `orgBrand` | 1 |
| Business ARC trading authorisation, company contractor licence | `org_credentials`, kind `licence`. Both types exist on the Organisation screen, and both are empty for Diamond Air | 1 |
| Insurance (foot) | `org_credentials`, kind `insurance` | 1 |
| Signatory's ARC and contractor licences | `staff_licences` / `staff_licence_records` | 1 |
| Kind of building (a hint; the person picks) | The address | 1 |
| Equipment rows | The work-done description ("1 x 3.6KW indoor for Master Bed"), marked as read from the quote | 1 |
| What else was installed | The work-done description ("fire rated pair coil", "plenums", "condensation pump") | 1 |
| Fan airflow | Typed, when the fan's "Add its airflow" is ticked; the accepted quote's figure waits there | 1 |
| Certifier, project number, the certifier's requirements | The certifier's list, read by Tiff | 1 |
| Certifier names already used, for spelling | `certifier_profiles`. Never chosen for the person: certifiers change from job to job | 1 |
| Equipment and refrigerant charge from the design | `studio_designs.sm8_job_uuid`, and `evaluateVrfCharge` as a suggestion for kg added | 2 |
| Serial numbers | `job_photo_readings.ocr_text` on nameplate photos, offered to confirm, never filled in silently | 2 |

## The paper

Dressed as the Studio's design sheet (`components/studio/summary/sheet-doc.tsx`),
which Isaac has already approved, so both read as one business's paperwork.
Cut down after Isaac's "too much extra information".

- **The frame:** the brand colour around the page, from
  `themeVars(brand.color)` (`lib/org/theme.ts`). No frame for a business that
  hasn't chosen a colour.
- **The masthead:**
  - Left: the certificate's title as the small heading, the site address as
    the title, "Prepared by" with the business, then the builder, the site
    and the job number. No "Attention" line: a certificate isn't a letter.
  - Right: the logo through `BrandLogo` (initials stand in), then legal name,
    ABN, the business's ARC authorisation and contractor licence when on file,
    address and contact lines.
- **The facts row:** the building (when picked) and the completion date.
  What is certified is already the tables' headings, and the fans are
  counted by their rows, so neither is repeated.
- **One table per thing certified:**
  - Air conditioning: location and model, plus serial when any row has one.
    Outdoor unit first. No capacity and no total.
  - Ventilation: location, model, airflow, with "rated" or "measured" on the
    figure.
- **Nothing else describes the equipment.** No system box, no brand line, no
  feature list, no scope paragraph.
- **Certification:** the numbered statements, then not applicable (only for
  something asked) and not covered (only when typed).
- **Sign-off:** the stored signature, name and date, then the signatory's ARC
  licence and contractor licence numbers. Insurance in the foot.
- Plus Jakarta Sans, ink and greys. The brand colour is the frame and nowhere
  else.
- One A4 page for an ordinary job. A long VRF job runs to two, with the frame
  on both.
- The PDF is named after what it covers and the site:
  "Air conditioning certificate – 74-10 Etham Avenue – job 1383.pdf".

**Shared, not copied.** The masthead, frame and table move out of
`sheet-doc.tsx` into `components/org/doc-sheet/`, with their CSS, and both
documents draw from them. The design sheet must print identically before and
after the move. Its tests and a PDF compared before and after are the check.

## Signature

Each person draws their signature **once**, on their own staff card, with the
SWMS sign-on pad (`signatureSvg`).

- Only the person can set or redraw their own signature.
- Issuing **copies** it onto the version, so a signature redrawn later never
  changes a certificate already sent.
- With no signature on file, the Sign step offers the pad there and then, and
  keeps it for next time.

Stored in its own table, `staff_signatures`, so it never rides the staff
card's section save.

## Rules that block Issue (`certProblems`)

The server asks these again at Issue, and never trusts the browser.

- The wording is approved for this library version.
- Nothing asked for is certified that isn't on the certificate: fans,
  ductwork and fire-rated penetrations need to be there, and condensate,
  commissioning, fire mode, Section J and outdoor unit noise need air
  conditioning on it, because their wording is about air conditioning.
- The signatory has a signature on file, and their own ARC licence and
  contractor licence are **current on the issue date**. A licence with no
  expiry date counts as not current.
- What it covers is chosen.
- Every air conditioning row, outdoor units included, has a location, model
  and capacity. (Jobs 1300 and 2699 record capacities but not models, so
  those are typed before Issue.)
- Every ventilation row has a location, a model and an airflow, rated or
  measured.
- Every circuit has its test pressure, hold time, vacuum, refrigerant and kg
  added. A vacuum above 500 microns has the manufacturer's figure.
- Fire-rated penetrations, when ticked, name the fire-stopping product.
- When fire mode is on, an answer is chosen, and the smoke control answer
  stops the certificate.
- When a certifier's list is attached, every requirement is matched, written
  or not applicable, and the certifier and project number are filled in.
  Without a list, neither is asked for.
- The completion date is not in the future.

## Data

One migration, additive, safe to apply before the deploy. As in `swms.sql`:
RLS on with no policies, service role only, every query scoped by `org_id`.

```sql
create table public.staff_signatures (
  staff_profile_id uuid primary key,
  org_id uuid not null,
  signature_svg text not null,
  set_at timestamptz not null default now()
);

create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  sm8_job_uuid text not null,           -- the job card, never a claim
  type text not null check (type in ('mechanical')),
  builder_company_uuid text,            -- snapshot of the builder it went to
  created_by_staff_id uuid,
  created_at timestamptz not null default now()
);

create table public.certificate_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  certificate_id uuid not null references public.certificates (id) on delete cascade,
  version integer not null check (version >= 1),
  answers jsonb not null,               -- covers, building, equipment, tests, ticks
  requirements jsonb not null default '[]', -- each certifier requirement as written,
                                        -- and its clause, own statement or reason
  requirements_document_id uuid,        -- the certifier's list this version answered
  certifier_profile_id uuid,
  content jsonb not null,               -- what the library wrote, frozen
  library_version text not null,
  reason text not null,                 -- "First issue", or why it was reissued
  signatory_staff_id uuid not null,
  signatory_licences jsonb not null,    -- numbers and expiry dates as they stood at issue
  signature_svg text not null,
  document_id uuid,                     -- the PDF in documents
  issued_by_staff_id uuid not null,
  issued_at timestamptz not null default now(),
  unique (certificate_id, version)
);

create table public.certifier_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  name text not null,                   -- "FutureCert"
  clause_keys text[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);

-- removed from the app 2026-10-03; the table stays, unused
create table public.fan_models (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  model text not null,
  rated_lps numeric not null check (rated_lps > 0),
  spec_document_id uuid,                -- the spec sheet the figure came from
  created_by_staff_id uuid,
  created_at timestamptz not null default now(),
  unique (org_id, model)
);

create table public.cert_template_approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  type text not null,
  library_version text not null,
  approved_by_staff_id uuid not null,
  approved_at timestamptz not null default now(),
  unique (org_id, type, library_version)
);
```

The licences and the signature are copied onto the version, because a
certificate states what was held on the day it was signed. That is the
opposite of the SWMS paper's live ticket read, on purpose.

The PDF and the certifier's list are ordinary `job_document`s (see As built),
so the `documents` kind check is unchanged.

## How it mirrors the SWMS

| SWMS today | Certificate |
|---|---|
| `lib/swms/library.ts`: pure, versioned, every control sourced | `lib/certs/mechanical.ts`: pure, `CERT_LIBRARY_VERSION`, every clause names its standard |
| `swms_library_approvals` | `cert_template_approvals` |
| Admin → Templates → SWMS | Admin → Templates → Mechanical Compliance Certificate |
| `swms` + `swms_versions`, frozen, a revision is a new row | `certificates` + `certificate_versions`, the same |
| `issueProblems()` asked again on the server | `certProblems()`, the same |
| `/swms/[versionId]`, paper outside the shell | `/certificates/[versionId]`, dressed as the design sheet |
| The sign-on pad | The same pad, once, on the staff card |
| A page, not a file | A PDF at Issue, through `lib/studio/pdf-render.ts`, filed in `documents` |

## Gates

- **Issue and reissue:** anyone who can open the job card (`workboard`) and
  holds their own current ARC licence and contractor licence. The server reads
  the licences itself. A job has one certificate: the route refuses to start
  a second beside an issued one, so issuing again is always a reissue.
- **Create certificate** shows for anyone who can open the job card. Without
  both licences the wizard opens read-only, with one line naming the licence
  that's missing.
- **Approve the wording:** the owner, as for the SWMS library.
- **Read the paper:** `workboard`.
- **Email and Send to ServiceM8:** the footer's existing gates
  (`workboard_manage`).

## Build order

Each step is its own PR. The design ratchets in
`src/app/dashboard/__tests__/design-ratchets.test.ts` hold on every one.

1. **The library and its golden jobs.** `lib/certs/mechanical.ts`, pure: the
   clauses, the rules for which ones a job gets, and the build from answers to
   content. The golden set is six real jobs, and each must get exactly these
   statements:

   | Job | Covers | Building | Statements beyond the standard set |
   |---|---|---|---|
   | 1383 | Air conditioning | Apartment building | ductwork, then FutureCert's three: AS 1668.1/.2, fire mode, Part J5 |
   | 279 | Both | House, townhouse or duplex | ductwork, Lossnay at its rated airflow |
   | 1300 | Air conditioning | House, townhouse or duplex | ductwork |
   | 1245 | Air conditioning | House, townhouse or duplex | ductwork |
   | 3326 | Air conditioning | Office | none |
   | 2699 | Air conditioning | Apartment building | fire-rated penetrations |

2. **The list reader.** It reads a certifier's list and matches it to the
   clauses. Golden test: FutureCert's list for job 1383. Item 9.1 must come
   back as its three requirements, matched to AS 1668.1/.2, fire mode and
   Part J5, with nothing left over.
3. **Migration and actions.** `app/actions/certificates.ts`: wizard context,
   read the list, issue, reissue, approve, list for a job.
4. **Shared paper parts.** Pull the masthead, frame and table out of the
   design sheet. It must print the same before and after.
5. **The paper.** `/certificates/[versionId]` from those parts, then the PDF
   at Issue, filed on the job.
6. **Signature on the staff card.**
7. **The wizard and the Documents face.** Create certificate, the
   Certificates group under Compliance, Reissue, and the after-Issue buttons.
8. **The wording page.** Read every clause and approve it.
9. **Phase 2.** Prefill from the Studio design, serial numbers from photos,
   and other states.

## Decided (Isaac, 2026-10-01)

1. **Who signs:** anyone with their own current ARC licence and contractor
   licence, whatever their role.
2. **Signature:** drawn once on the staff card, used on every certificate.
3. **One certificate**, covering air conditioning, ventilation or both,
   chosen per job.
4. **Sending:** nothing is automatic. After Issue: email the builder, send to
   ServiceM8, download or share.
5. **Recipient:** the builder.
6. **The look:** the Studio design sheet's frame and masthead, with the logo
   and company details pulled in the same way.
7. **Less on the page:** no system box, brand lines or feature lists. The
   model number says what the unit is.
8. **The building question stays**, with accurate options, and it doesn't
   decide what is certified.
9. **Fire mode and Part J5 only when a certifier asks.**
10. **Airflow is rated by default and measured only when measured.** Small
    exhaust fans take their figure from the fan list. (Since 2026-10-03: no
    fan list, and a figure only when someone adds it.)

## Before the first certificate can be issued

These are data, not code, and are needed whatever is built:

- **Isaac's licence expiry dates:** the ARC licence (L118650) and contractor
  licence (315890C) were added on 2026-10-01 without expiry dates, because the
  cards photographed show 2024.
- **The business's ARC refrigerant trading authorisation** (the AU number), on
  the Organisation screen. The type exists there, and it's empty.
- **A company contractor licence**, if DAS Pty Ltd holds one, on the same
  screen.
- **The wording, read and approved,** with the standards references checked
  by someone who knows them.

## Sources

- [NSW Government: air conditioning and refrigeration work](https://www.nsw.gov.au/business-and-economy/licences-and-credentials/building-and-trade/air-conditioning-and-refrigeration-work)
- [ARC Refrigerant Handling Code of Practice 2025, Part 2](https://www.arctick.org/media/29167/air018-refrigerant-handling-codes-of-practice-2025_part-2_web_final_singles.pdf)
- [EP&A (Development Certification and Fire Safety) Regulation 2021](https://legislation.nsw.gov.au/view/whole/html/inforce/current/sl-2021-0689)
- [NSW Planning: fire safety certification](https://www.planning.nsw.gov.au/policy-and-legislation/buildings/fire-safety-in-buildings/fire-safety-certification)
- [POEO (Noise Control) Regulation 2017, reg 45](https://classic.austlii.edu.au/au/legis/nsw/consol_reg/poteocr2017693/s45.html)
- [Design and Building Practitioners Act 2020, s 6](https://classic.austlii.edu.au/au/legis/nsw/consol_act/dabpa2020313/s6.html)
- [AIRAH Residential Best Practice Guideline](https://airah.org.au/Common/Uploaded%20files/Archive/Resources/Best_Practice_Guideline/RBPG_VIC_version_3-2.pdf)

## As built (2026-10-01)

Built in one pass at Isaac's word ("just build it"), with these differences
from the plan above:

- **The PDF and the certifier's list are `job_document`s**, the kind the
  Documents face's own upload uses, not two new kinds. That means the
  Documents face lists them, the email attaches them and Send to ServiceM8
  sends them with no new code, and there is no kind-check migration. The
  certificate version points at its PDF (`document_id`) and at the list it
  answered (`requirements_document_id`).
- **The paper wears the design sheet's classes instead of extracted
  components.** `components/certs/certificate-paper.tsx` renders the frame,
  the masthead and the figures row with `sheet-doc.css`'s own `dsd-` rules,
  so `sheet-doc.tsx` is untouched and the design sheet prints the same by
  construction. The tables are the certificate's own (`certificate.css`):
  `dsd-rt` is built for nine columns and becomes a list below 1024px, which
  three columns never need. `certificate.css` keeps every design ratchet; it
  is not one of the exempt paper sheets.
- **Tiff only reads the certifier's list. Matching is a rule**
  (`matchRequirement` in `lib/certs/quote.ts`), tested against FutureCert's
  item 9.1, and the person can change any match. The read uses
  `claude-opus-5-5`, falling back to `claude-opus-4-8` on a refusal, as the
  proposal writer does.
- **The wizard's steps** are What it covers (with the completion date),
  Equipment, Certifier's list, Checks, Sign.
- **The SWMS's controls are shared.** `Seg`, `Choice` and `SignaturePad`
  moved to `components/swms/controls.tsx`, and the SWMS wizard and sign-on
  import them from there.
- **Issuing is a route handler** (`app/api/certificates/issue`), because
  printing the PDF needs Chromium and a route segment's `maxDuration`. It is
  all or nothing: a failed print or filing takes the version back out.
- **The certificate opens in the card's viewer**, like the SWMS, at
  `/certificates/[versionId]`. Headless Chrome prints `/print/certificate`
  with a two-minute ticket (`lib/certs/pdf-ticket.ts`). Both draw from the
  same read (`lib/certs/paper-data.ts`).
- **Not built yet:** phase 2 (prefill from the Studio design, serial numbers
  from nameplate photos, other states). The wording is in Admin → Templates,
  and the bell asks the owner to approve each new version.

The golden jobs are tested in `lib/certs/__tests__/mechanical.test.ts`, the
quote reader and the matcher in `quote.test.ts`, the paper in
`components/certs/__tests__/certificate-paper.test.tsx`, the wizard in
`cert-wizard.test.tsx`, and the Documents face's rows in
`job-documents-face.test.tsx`.

### Pressure test and vacuum (2026-10-02)

The refrigerant statement states the pressure test and vacuum as a result,
not figures: "pressure tested with oxygen-free nitrogen and held without
loss, evacuated to the manufacturer's specified vacuum, then charged and
commissioned in accordance with AS/NZS 5149.2 and the ARC code". The wizard
no longer asks for kPa, hold time or microns. It still asks for the
refrigerant and the kg added, which print after the statement, once, or per
outdoor unit when they differ. The figure fields stay in `CircuitTest` so a
version saved before still reads; nothing prints them.

### Where the standards come from (2026-10-02)

Every standard and statement lives in the wording library
(`src/lib/certs/mechanical.ts`, `CERT_LIBRARY_VERSION`), approved once by the
owner. Tiff never looks a standard up: the only model call reads what the
builder sent (a pasted email or an attached list), and rules match each item
to a statement in the library. A new standard is added to the library, as a
new version that is approved again.

Each matched item is checked against what is on the certificate. An item
that asks for ventilation on an air conditioning job, or for ductwork or
fire-rated penetrations that aren't ticked as installed, blocks the issue
until it is marked not applicable with a reason, or the works are added.

### Equipment from the accepted quote (2026-10-03)

Going forward jobs are quoted in HeyTiff's quote builder, so the quote is the
equipment record:

- **Each quote option holds its equipment as rows** (`UnitLine` in
  `src/lib/quotes/proposal.ts`). Each row has a role (outdoor, indoor or
  fan), a room or location, a capacity, a type, a model, a quantity, and the
  outdoor unit an indoor runs from. A fan row also has its rated L/s. The
  quote writer fills the rows from the brief and never invents a model. A
  missing model is left empty and shown as "Model not given yet". The option
  editor edits the rows field by field.
- **An option is marked Accepted on the Quote face.** It's one option when
  the client picks one, and any number when they tick areas.
- **The certificate reads the accepted options' rows** one for one
  (`src/lib/certs/from-quote.ts`), and says so. When a quote has several
  options and none is marked, the wizard says to mark one. The free-text
  quote reader (`src/lib/certs/quote.ts`) is only used for jobs quoted
  before the quote builder, and its note says to check every row against
  what was installed.

Nothing needed migrating: `quote_drafts.draft` is jsonb, no quote had been
saved yet, and a row saved before roles existed reads as an indoor unit.
