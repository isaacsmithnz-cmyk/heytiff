import { brandContact, brandInitials, hasBrand, plateFor, type LogoGround, type OrgBrand } from "@/lib/org/brand";
import "./letterhead.css";

/* WHO SENT THIS — the two shapes the company's face takes on a surface a
   customer receives.

   No "use client" and no hooks, deliberately: the handover sheet renders these
   on the server, the studio's print document renders them inside a client
   component, and both need the same object. A presentational component with no
   state is the only thing that can be both.

   Its own stylesheet rather than a block in shell.css, because none of the
   surfaces using it are inside the app shell — the handover sheet and the live
   link are outside `.fg` entirely, and the print document renders into a
   portal. The three sheets that WOULD have to carry a copy each are
   shell.css, studio.css and the handover page's inline string.

   NOT print-only. `Letterhead` is drawn to survive being printed — no
   background it depends on, colours that hold on paper — but it renders on
   screen first, and the live link uses `BrandMark` on screen only. */

/** The document letterhead: logo, business name, and the line an invoice or a
    handover gets checked against. Falls back to nothing at all — a caller with
    no brand renders its own wording instead of an empty frame. */
export function Letterhead({ brand }: { brand: OrgBrand }) {
  if (!hasBrand(brand)) return null;
  const contact = brandContact(brand);

  return (
    <div className="org-lh">
      <BrandLogo brand={brand} className="org-lh-logo" />
      <div className="org-lh-k">
        {brand.name && <b>{brand.name}</b>}
        {contact.length > 0 && (
          <span className="org-lh-contact">
            {/* joined with a middot as ONE string, not as separate spans with
                a separator between them: a separator that can wrap onto a line
                by itself is the classic way this row breaks. */}
            {contact.join(", ")}
          </span>
        )}
      </div>
    </div>
  );
}

/** The compact mark — logo and name, for a bar rather than a document. When
    the business has told us nothing, `fallback` is what the surface says
    instead (every caller passes its own platform wording).

    A DARK GROUND, always: every surface that asks for this mark is a dark bar.
    It used to be plated white whatever the logo was, which made a white logo
    invisible on the one surface that suits it best. Now the plate follows the
    logo's measured ink (`plateFor`): a pale logo sits on the bar bare, and a
    dark or unmeasured one gets the white plate it always had. */
export function BrandMark({
  brand,
  fallback,
}: {
  brand: OrgBrand;
  fallback: string;
}) {
  if (!hasBrand(brand)) return <span className="org-mark-fb">{fallback}</span>;

  return (
    <span className="org-mark">
      <BrandLogo brand={brand} className="org-mark-logo" ground="dark" />
      {brand.name && <b>{brand.name}</b>}
    </span>
  );
}

/* The logo, or the initials standing in for one.

   Exported because the studio's design sheet builds its own masthead — the
   business's name runs at 34px there, above a contact line, and `Letterhead`'s
   own arrangement would print the name a second time right under it.

   `alt` is empty on purpose. The business name is rendered as TEXT immediately
   beside it in both shapes above, so a described logo makes a screen reader
   say the same name twice — the image is decoration for a label that is
   already there. The one case where it is not is a business with a logo and no
   name, and that one gets the name it does not have from nowhere anyway. */
export function BrandLogo({
  brand,
  className,
  ground = "light",
}: {
  brand: OrgBrand;
  className: string;
  /** what the logo is drawn ON. Paper by default, because that is nearly every
      surface; the share link's bar says "dark". The logo's own ink then decides
      whether it needs a plate — see `plateFor`. */
  ground?: LogoGround;
}) {
  if (brand.logoUrl) {
    const plate = plateFor(brand.logoTone, ground);
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={plate ? `${className} org-plate-${plate}` : className} src={brand.logoUrl} alt="" />;
  }
  const initials = brandInitials(brand.name);
  if (!initials) return null;
  return (
    <span className={`${className} org-initials`} aria-hidden="true">
      {initials}
    </span>
  );
}
