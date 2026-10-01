# Certificates on a job: plan

Status: plan, 2026-10-01. Nothing built yet. Isaac's decisions are at the end.

## Why

Certifiers ask for a mechanical certificate before they issue an Occupation
Certificate. On 2026-10-01 job 1383 (74/10 Etham Ave, Darling Point, for Reed
Developments) needed one for FutureCert's item 9.1. It was put together by hand
in a chat, from two kinds of fact:

- **What HeyTiff already holds:** the job's address, client and contact, the
  scope in the work-done description, the team's licences, and the business's
  ABN and insurance.
- **What the certifier asked for**, which came from the builder's email: the
  certifier's "Occupation Certificate: List of Requirements", which gave the
  project number, the consent authority and, under item 9.1, the exact
  statements the certificate had to make.

The second kind is different on every job and every certifier, so the
template can't hard-code it. "What the certifier asks for", below, is how a
future certificate gets it.

A certificate is the same kind of paper as a SWMS: HeyTiff writes it from a
library of approved wording, a person fills in what only they know, and the
issued version never changes. So it follows the SWMS build, piece for piece.

## What the person does

1. On a job's Documents face, **Create certificate** sits beside Create SWMS.
   SWMS closes when the job is finished, but a certificate opens then: it is
   usually written once the work is done.
2. There is one type, **Mechanical services**, so there is no type to choose.
   The tables carry a `type` column so a second type would not need a new
   build, but no chooser is drawn until there is something to choose
   between.
3. A short wizard opens with most fields already filled in (see Prefill). They
   correct, add and confirm.
4. **Issue** freezes a version, prints it to PDF and files the PDF on the job.
5. The screen after Issue offers what happens next, and each choice is a
   button, never automatic:
   - **Email to the builder.** This opens the existing email draft
     (`readEmailDraft`), starting with the builder's contact and with the
     certificate already ticked. The subject is "Mechanical compliance
     certificate: <address>".
   - **Send to ServiceM8**, through the existing footer path (`job-sm8.ts`).
   - **Download PDF**, and on a phone the phone's own share sheet, so it can go
     by text or another app.

   The PDF is also an ordinary row on the Documents face, so all of these stay
   available later from the footer, like any other file.

## How it mirrors the SWMS

| SWMS today | Certificate |
|---|---|
| `lib/swms/library.ts`: pure, versioned (`LIBRARY_VERSION`), every control sourced | `lib/certs/mechanical.ts`: pure, `CERT_LIBRARY_VERSION`, every clause names the standard or BCA part it answers |
| `swms_library_approvals`: the owner adopts the library before anything issues | `cert_template_approvals`, one per type and library version |
| `/dashboard/swms/template`: read and approve | `/dashboard/certificates/template?type=mechanical` |
| `swms` + `swms_versions` (answers and content frozen, a revision is a new row) | `certificates` + `certificate_versions`, same shape |
| `issueProblems()`: the server re-asks the wizard's rules | `certProblems()`, same pattern |
| `/swms/[versionId]`: paper outside the shell | `/certificates/[versionId]`, outside the shell, dressed as the Studio's design sheet (see The paper) |
| Sign-on signature pad (`signatureSvg`) | The same pad, used once on the staff card (see Signature) |
| Not a file yet ("a SWMS is a page") | Printed to PDF at issue, through the Studio's headless Chrome (`lib/studio/pdf-render.ts`), and filed in `documents` |

## What the certifier asks for

Every certifier sends a list like FutureCert's: a table of items, one per
trade, each saying what that trade's certificate must state. The mechanical
item is the brief for our certificate. So the certificate starts from that
list, not from a fixed form.

**1. Attach the list.** The wizard's first step asks for the certifier's list.
It can be uploaded as a PDF or photo, or picked from the job's Documents if
it's already there. If the builder emailed it, that means saving the
attachment once. It is filed on the job as a document of a new kind,
`certifier_requirements`.

**2. Tiff reads it.** This is the same scan-then-confirm contract as a licence
or insurance policy (`org-credential-ai.ts`): one model call fills the form,
the person checks it against the paper, and nothing is saved until they do.
It reads:

- the certifier's name, the project number, the consent authority and who it
  is addressed to
- the address and scope, which are checked against the job, and a mismatch
  is flagged rather than overwritten
- **every requirement under the mechanical item, one line each, word for
  word**

**3. Each requirement is matched to a clause.** The library holds a catalogue
of mechanical clauses. Each one is approved wording with the questions it
needs answered. The catalogue v1 is drawn from what NSW certifiers ask for:

| Clause | Answers a requirement like | Asks the person |
|---|---|---|
| AS/NZS 1668.1 and AS 1668.2 installation | "installed in accordance with AS 1668.1 and AS 1668.2" | confirm |
| Fire mode (Spec 21) | "shuts down in fire mode as required by Specification 21" | one of the three answers (see the wizard) |
| BCA Part J5 | "in accordance with Part J5 of the BCA" | confirm insulation, sealing and controls |
| Refrigerating systems, AS/NZS 5149 | "refrigerant systems to AS/NZS 5149" | refrigerant, charge, pressure test, evacuation |
| Ductwork, AS 4254 | "ductwork to AS 4254" | confirm |
| Kitchen exhaust, AS 1668.1 | "kitchen exhaust hood and ductwork" | fire-rated duct, cleaning access |
| Car park ventilation, AS 1668.2 | "car park ventilation and CO monitoring" | fan rates, CO set points |
| Air and water balance report | "commissioning report / air balance" | attach the report |
| Smoke control (stair pressurisation, smoke exhaust) | anything naming a smoke control system | **not ours**: the wizard says it needs the mechanical engineer's certificate |

Matching is done by the model with the catalogue in front of it, and the
person sees each requirement beside the clause it was matched to and can
change either.

**4. Anything left over is never invented.** If a requirement matches no
clause, the wizard shows it as **Not covered** and the person must:

- write the statement themselves (it prints as typed, under their name, the
  same rule the SWMS follows for site-specific controls), or
- mark it not applicable, with a reason that prints on the certificate.

Issue is blocked while any requirement has neither.

**5. The certificate answers the list, item by item.** The Certification
section prints one statement per requirement, in the certifier's order, so
the certifier can tick it off against their own list. The other trades' items
on the list (electrical, glazing, BASIX and so on) are not ours and are left
alone.

**No list?** This is the usual case: the builder just emails "can you send
the compliance certificate". The certificate is still built, from two facts
about the job, and nothing waits on the certifier:

1. **What kind of building it is**, as the person chose it in What it covers.
   The suggestion comes from the address:
   - a unit number ("12/25-35 Lancaster Drive") suggests a Class 2 apartment
   - a level or suite ("Lv 3 Suite 4") suggests a Class 5 office or other
     commercial space
   - a plain street address suggests a Class 1 house or townhouse
2. **What was installed**, read from the job: ducted or bulkhead units,
   mechanical ventilation (a Lossnay, an exhaust fan), penetrations through
   fire-rated walls or floors (the quote says so, or the building is Class 2
   or above), a roof penetration.

Those two pick the clauses. See What every certificate covers, below.

When the certifier's list asks for something that doesn't apply, it is
printed as **not applicable**, with the reason ("house: energy efficiency is
set by the BASIX certificate"). Nothing else is listed as not applicable: a
certificate does not go through every standard it isn't about.

Five mockups were drawn this way on 2026-10-01 from real finished jobs:

- 279: VRF and Lossnay, a house
- 1300: VRF bulkheads, a townhouse
- 1245: two ducted systems, a house
- 3326: a split in an office suite
- 2699: a multi split in an apartment

Each picked a different set from this table.

**And the builder is asked once, in the same email.** The email draft that
goes out with the certificate ends with one line: "If your certifier has
sent a list of requirements, forward it and we'll match the certificate to
it." If a list arrives later, attaching it to the job makes a **Reissue** with
the list's requirements matched. The first version stays on file as version
1, as a SWMS revision does.

**Builders are remembered too.** The certifier used on a builder's last job is
suggested for the next one, so a builder who always uses FutureCert gets
FutureCert's clauses without asking.

**Remembered per certifier.** Each certifier's last matched set is kept. The
next FutureCert job starts with FutureCert's clauses already chosen, even
before its list is attached, and the reader only has to confirm the new
project number.

## What every certificate covers (research, 2026-10-01)

An installer's certificate is not a statutory "compliance certificate". In
NSW only a registered certifier issues those. Ours is **documentary evidence**
that the certifier may rely on to issue the Occupation Certificate (EP&A
(Development Certification and Fire Safety) Regulation 2021, and NCC A5G3
evidence of suitability). Evidence is only as good as its facts, so the
certificate is built around: who did it, what and where, which standards,
and the test results that prove it.

**On every air conditioning certificate:**

1. **Who.** The business (legal name, ABN) and its NSW contractor licence
   for air conditioning and refrigeration, which is required for this work at
   any value (Home Building Act 1989). The signatory's ARC refrigerant
   handling licence. The business's ARC refrigerant trading authorisation
   number (the AU number) belongs here too, and is **not on file yet**.
2. **What and where.** One row per unit: location, model, and **serial
   number**. The serial is what the manufacturer's warranty registers, and
   commissioning records list it. Serials are not captured today; nameplate
   photos (`job_photo_readings`) are where they come from.
3. **Refrigerant circuit, AS/NZS 5149.2 and the ARC Code of Practice
   (2025).** These are the test results, typed, never assumed:
   - strength and tightness test with oxygen-free nitrogen (pressure and
     hold time)
   - evacuation below **500 microns** before charging, unless the
     manufacturer says otherwise
   - refrigerant type, and the charge added in kg
4. **Installed to the manufacturer's instructions**: clearances, mounting,
   pipe lengths.
5. **Condensate** drained to a suitable point without damage or nuisance.
6. **Commissioned**: run and checked in heating and cooling, with operating
   instructions and the maintenance schedule handed over (AIRAH best
   practice).
7. **Not covered**, said once: electrical work, which the electrician
   certifies separately under AS/NZS 3000.

**Added by what was installed** (ticked by the person, suggested from the
quote):

- Ductwork, plenums or flexible duct: **AS 4254.1/.2**.
- Penetrations through fire-rated walls or floors: sealed with a tested
  fire-stopping system to keep the fire resistance level.

**On every ventilation certificate:**

- Each fan's location and model, with **measured airflow** in L/s against
  the design or required airflow. Within ±10% of design is the usual
  tolerance.
- Discharge goes to outdoor air, not the roof space (NCC 2022 Housing
  Provisions 10.8.2: at least 25 L/s for a bathroom or toilet, 40 L/s for a
  kitchen or laundry).
- **AS 1668.2** where the building's ventilation relies on it: commercial
  spaces, car parks, and common areas in an apartment building. Houses and
  apartments are usually naturally ventilated, so a bathroom fan doesn't make
  a house an AS 1668.2 job.

**Only when the certifier's list asks, or the person adds it:**

- Fire mode: AS/NZS 1668.1 and NCC Specification 21.
- BCA Part J5 energy efficiency.
- Outdoor unit noise. In NSW, a residential air conditioner must not be heard
  in a neighbour's room overnight (POEO (Noise Control) Regulation 2017,
  reg 45). The certificate can say the unit is where the approved plans put
  it. It cannot say what it measures unless someone measured it.

**Never on ours.** A fire safety measure on the building's fire safety
schedule (for example, air-conditioning shutdown on alarm) is assessed for
the fire safety certificate by an Accredited Practitioner (Fire Safety), and
that person must not be the installer. Our fire-mode clause says what was
installed and how it behaves. It is never offered as the fire safety
assessment.

**Australia-wide or NSW?** The building classes, AS/NZS 5149, AS 4254,
AS 1668 and the ARC licence are national. The contractor licence, BASIX,
the noise regulation and the OC process are NSW. Each state has its own
version of those (in Victoria, a VBA registration and compliance certificate
for refrigerated air conditioning work). v1 writes the NSW version. The
state comes from the job's address, as the SWMS's jurisdiction does.

Sources:
- [NSW Government, air conditioning and refrigeration work](https://www.nsw.gov.au/business-and-economy/licences-and-credentials/building-and-trade/air-conditioning-and-refrigeration-work)
- [ARC Refrigerant Handling Code of Practice 2025, Part 2](https://www.arctick.org/media/29167/air018-refrigerant-handling-codes-of-practice-2025_part-2_web_final_singles.pdf)
- [EP&A (Development Certification and Fire Safety) Regulation 2021](https://legislation.nsw.gov.au/view/whole/html/inforce/current/sl-2021-0689)
- [NSW Planning, fire safety certification](https://www.planning.nsw.gov.au/policy-and-legislation/buildings/fire-safety-in-buildings/fire-safety-certification)
- [POEO (Noise Control) Regulation 2017, reg 45](https://classic.austlii.edu.au/au/legis/nsw/consol_reg/poteocr2017693/s45.html)
- [Design and Building Practitioners Act 2020, s 6](https://classic.austlii.edu.au/au/legis/nsw/consol_act/dabpa2020313/s6.html)
- [AIRAH Residential Best Practice Guideline](https://airah.org.au/Common/Uploaded%20files/Archive/Resources/Best_Practice_Guideline/RBPG_VIC_version_3-2.pdf)

## The wizard

The text is the library's; the inputs are the job's.

0. **What it covers** (Isaac, 2026-10-01: "a template where we select what
   we're certifying"). Two questions, each a row of large options, and
   nothing is decided for the person:
   - **What are you certifying?** Air conditioning, Ventilation, or both. This
     names the certificate ("Air conditioning compliance certificate", or
     "Air conditioning and ventilation compliance certificate"), decides which
     equipment tables the paper has, and decides which clauses are offered.
   - **What kind of building?** Kept (Isaac, 2026-10-01), with the options
     worded so each one is true for its class:
     - House, townhouse or duplex (Class 1a)
     - Apartment building (Class 2)
     - Office (Class 5)
     - Shop, café or restaurant (Class 6)
     - Other or not sure (no class is printed)

     A class is printed only when the person picked it. The address only
     preselects an option, and a quiet line says so ("picked because the
     address has a level and suite"), because an address can't settle it:
     a "2/15" unit can be a villa (Class 1a), and townhouses over a shared
     basement car park are Class 2. When the certifier's list or the
     Construction Certificate states the class, that is used instead.
1. **The certifier's list.** Attach it and confirm what Tiff read, as above.
2. **The job.** Site address, builder, builder's contact, certifier, the
   certifier's project number, consent authority, date the works were
   completed. The certifier's fields come from the list. The completion date
   defaults to the job's completion date in ServiceM8.
3. **Equipment.** Rows of unit, location and capacity, plus model and serial
   numbers where known, then the controls. Rows can be added, removed and
   reordered. The total is calculated, never typed. (Job 1383's total was
   typed wrong on the job sheet: "29 kW" for units that add up to 19.8.)
4. **Scope.** What was included and what was by others (bulkheads,
   plasterboard, painting, electrical). This step is ticks over the library's
   lines plus one free line.
5. **Compliance.** One card per requirement on the certifier's list, each
   showing the clause it was matched to and that clause's questions. The
   default set, as job 1383 needed it:
   - AS/NZS 1668.1 and AS 1668.2: confirm.
   - **Fire mode (Spec 21)** is one of three answers, and the wording follows
     the answer:
     - *Individual room units, each ≤ 1000 L/s, not part of smoke control*:
       exempt from shutdown. Every unit's airflow has to be confirmed.
     - *Shuts down on a fire signal*: give the interface and the date it was
       tested.
     - *Part of a smoke control system*: the wizard stops. That needs an
       engineer's certificate, not ours.
   - BCA Part J5: insulation, sealing and the control that turns each unit
     off.
   - AS/NZS 5149, AS 4254, and the manufacturer's instructions.
   - Commissioning facts, typed and not assumed:
     - pressure test (pressure and how long it was held)
     - evacuation (microns)
     - refrigerant type and charge added
     - date commissioned
6. **Sign.** The signatory is whoever is issuing. Their role doesn't matter;
   what they hold does: a current **ARC licence** and a current **contractor
   licence**, both read from their staff card and both printed on the
   certificate. Their signature is the one stored on their staff card (see
   Signature), shown here for them to see, and then they Issue. Nothing is
   drawn at this step.

## Prefill: where each fact comes from

| Fact | Source | Phase |
|---|---|---|
| Address, client, completion date | `sm8_jobs` | 1 |
| Builder contact | `sm8_job_contacts`, then `sm8_company_contacts` (as `readEmailDraft` already does) | 1 |
| Business name, ABN, address, logo | `organizations` through `orgBrand` | 1 |
| Insurance (footer) | `org_credentials` (public liability, workers comp) | 1 |
| Signatory's ARC and contractor licences | `staff_licences` / `staff_licence_records` | 1 |
| Equipment rows | Parsed from the work-done description ("1 x 3.6KW indoor for Master Bed"), clearly marked as read from the quote | 1 |
| Equipment from the design | `studio_designs.sm8_job_uuid`: the linked design's rooms, indoor and outdoor models, and the refrigerant charge `evaluateVrfCharge` already works out | 2 |
| Serial numbers | `job_photo_readings.ocr_text` on the job's nameplate photos, offered for the person to confirm and never filled in silently | 2 |
| Certifier, project number, consent authority, and what the certificate must state | The certifier's list, read by Tiff (see What the certifier asks for) | 1 |
| A certifier's usual clauses, before their list arrives | `certifier_profiles`, the last set matched for that certifier | 1 |

## The paper

The certificate is dressed as the Studio's design sheet
(`components/studio/summary/sheet-doc.tsx`), the document Isaac has already
approved, so both read as one business's paperwork. A mockup of job 1383 in
this dress was sent on 2026-10-01. It uses:

- **The frame**: the brand colour as a frame around the page, from
  `themeVars(brand.color)` (`lib/org/theme.ts`), with the colour made safe to
  print and no frame at all for a business that hasn't chosen one.
- **The masthead**: two parties, one each side.
  - Left: the job and who it is for. The certificate's name is a small
    heading over the site address as the title, then "Prepared by" with the
    business and the date, then the builder, the contact, the site and the job
    number in the ruled address block.
  - Right: the business. The logo comes from `orgBrand()`, signed at render
    through `BrandLogo` (the initials stand in when there's no logo). Under it
    are the legal name, ABN, address and contact lines from `brandContact`,
    ranged right.
- **The row of figures** (`.dsd-figs`): certifier, project number, consent
  authority, works completed, connected capacity.
- **One table per thing certified** (`.dsd-rt`): Air conditioning lists
  location, model and capacity, with the outdoor unit as the first row and
  the total in the foot. Ventilation lists location, model and airflow in
  L/s. Identical units in adjacent rooms share a row ("Bedrooms 1, 2, 3",
  "3 × PEFY-P32VMX-E1").
- **Nothing else describes the equipment.** Isaac, 2026-10-01: "too much
  extra information". There is no system band, no brand line, no feature
  list (wi-fi, zones, grille styles) and no scope paragraph. The model number
  says what the unit is. The figures row is four facts: what is certified,
  the building, the completion date, the capacity.
- **Certification**: one short numbered statement per requirement, naming
  the standard and nothing more, then one line for what is not applicable or
  not covered.
- **Sign-off**: the stored signature, name and date, then the ARC and
  contractor licences, each with its number and class. Insurance goes in the
  foot.
- Plus Jakarta Sans, the app's only typeface. Ink and greys only: the brand
  colour is the frame and nowhere else, as `theme.ts` rules.

**Sharing it, not copying it.** The masthead, frame and table are pulled out
of `sheet-doc.tsx` into `components/org/doc-sheet/`, with their CSS moved out
of `sheet-doc.css`. Then the design sheet and the certificate draw from the
same parts, and a change to the letterhead lands on both. The design sheet
must print identically before and after the move; its existing tests and a
PDF compared before and after are the check.

## Signature

Each person draws their signature **once**, on their own staff card, using the
SWMS sign-on pad (`signatureSvg`). Every certificate they issue after that
uses it.

- Only the person can set or redraw their own signature. A manager cannot
  draw one for someone else, because a signature is the person's own mark.
- Issuing **copies** the signature onto the version, so a signature redrawn
  later never changes a certificate already sent.
- With no signature on file, the Sign step offers the pad there and then, and
  saving it stores it on the card for next time.

Storage: one row per person in a new `staff_signatures` table (svg, set_at).
It is a separate table rather than a `staff_profiles` column, so it never
rides the profile's flat section save.

## Rules that block Issue (`certProblems`)

- Every requirement read from the certifier's list has a clause, a statement
  the person wrote, or a reason it does not apply.
- The signatory has a signature on file (or draws one at this step).
- The signatory holds their own ARC licence and their own contractor licence,
  both on file and **current on the issue date**. A licence with no expiry on file counts as
  "check it" and blocks Issue, the same as an expired one. (Isaac's two were
  added on 2026-10-01 without expiry dates, because the cards in the photo
  show 2024. Their current expiry dates need adding before v1 can issue.)
- There is at least one equipment row, and every row has a location and a
  capacity.
- A fire-mode answer is chosen. The ≤ 1000 L/s answer needs every unit's
  airflow confirmed.
- The completion date is not in the future, and is not before the job was
  created.
- The certifier's project number and the consent authority are filled in
  (the certifier sends the paper back without them).
- The template for this type and library version has been approved.

## Data

One migration, additive, safe to apply before the deploy (no RLS policies,
service role only, every query scoped by `org_id`, like `swms.sql`):

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
  sm8_job_uuid text not null,
  type text not null check (type in ('mechanical')),
  certifier_profile_id uuid,        -- who it is for, once known
  requirements_document_id uuid,    -- the certifier's list, in documents
  created_by_staff_id uuid,
  created_at timestamptz not null default now()
);

create table public.certificate_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  certificate_id uuid not null references public.certificates (id) on delete cascade,
  version integer not null check (version >= 1),
  answers jsonb not null,          -- what the person chose and typed
  requirements jsonb not null,     -- each requirement as the certifier wrote it,
                                   -- its clause (or the person's own statement,
                                   -- or why it does not apply)
  content jsonb not null,          -- what the library wrote, frozen
  library_version text not null,
  reason text not null,            -- "First issue", or why it was reissued
  signatory_staff_id uuid not null,
  signatory_licences jsonb not null, -- the numbers and expiry dates as they stood at issue
  signature_svg text not null,
  document_id uuid,                -- the PDF in documents
  issued_by_staff_id uuid not null,
  issued_at timestamptz not null default now(),
  unique (certificate_id, version)
);

-- what each certifier usually asks for, so their next job starts there
create table public.certifier_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  name text not null,               -- "FutureCert"
  clause_keys text[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique (org_id, name)
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

The licences are snapshotted onto the version, because a certificate states
what was held on the day it was signed, not what is held now. That is the
opposite of the SWMS paper's live ticket read, on purpose.

`documents` takes a new kind, `certificate`, in its kind check (see
`documents_kind_catchup.sql` for how that check is widened).

## Gates

- **Issue and reissue**: anyone who can open the job card (`workboard`) **and**
  holds a current ARC licence and a current contractor licence on their own
  staff card. Isaac, 2026-10-01: "anyone with a contractor licence and ARC
  licence can sign it off". A role is not the test, because the licences
  are what make the signature mean something. The server reads the licences
  itself at Issue (`certProblems`) and never trusts the browser's word for
  them.
- **Create certificate** shows for anyone who can open the job card. Anyone
  without both licences sees the wizard read-only, with one line naming the
  licence they're missing, rather than a button that fails at the end.
- **Approve the template**: owner, as for the SWMS library.
- **Read the paper**: `workboard`.
- **Email and Send to ServiceM8**: the existing footer's own gates
  (`workboard_manage`), unchanged.

## Build order

1. **Library and tests.** `lib/certs/mechanical.ts`, pure: the clause
   catalogue, and the build from answers to content. Its golden test rebuilds
   job 1383's certificate from its answers and checks it word for word
   against what was sent on 2026-10-01.
2. **The requirements reader.** The read of a certifier's list, and the
   matching against the catalogue. Its golden test is FutureCert's list for
   job 1383: item 9.1 must come back as its three requirements, matched to
   AS 1668.1/1668.2, fire mode and J5, with nothing left over.
3. **Migration and actions.** `app/actions/certificates.ts`: wizard context,
   read the list, issue, approve, list for a job.
4. **Shared paper parts.** Pull the masthead, frame and table out of the
   design sheet. The design sheet must print the same before and after.
5. **Paper.** `/certificates/[versionId]` from those parts, then the PDF at
   issue, filed on the job.
6. **Signature on the staff card.** Draw it once, redraw it.
7. **Wizard and Documents face.** The Create certificate button, a
   Certificates group under Compliance, Reissue, and the after-Issue screen
   (email the builder, send to ServiceM8, download or share).
8. **Template page.** Read the catalogue and approve it.
9. **Phase 2.** Prefill from the Studio design and serial numbers from photos.

Each step is its own PR. The design ratchets in
`src/app/dashboard/__tests__/design-ratchets.test.ts` hold on every one. The
wizard is a screen and follows `docs/design.md`. The paper is a print
stylesheet, outside the guards like the other three.

## Decided (Isaac, 2026-10-01)

1. **Who signs:** anyone with a current ARC licence and a current contractor
   licence of their own, whatever their role. This replaces the earlier
   "any admin or manager" answer, and closes the question of a manager
   without a contractor licence: they can't sign.
2. **Signature:** drawn once and stored on the person's staff card, then used
   on every certificate they issue.
3. **Types:** mechanical only for now.
4. **Sending:** nothing is automatic. After Issue there is a Send to ServiceM8
   button and a share choice (email, download, the phone's share sheet).
5. **Recipient:** the builder. The email draft starts with the builder's
   contact on the job.
