import { Chevron } from "@/components/logo";

/* THE MARK ITSELF, so it is never copied. The halo, the glass face, the
   chevron and the sparkle are what make this control recognisable as Tiff, and
   the debrief capsule now wears them too (it opens the same sheet from the
   Journal tab's console). Reusing the CSS while re-typing the MARKUP is the
   mistake ViewTabs was extracted to stop making one level up.

   The burst is NOT in here: it is state-driven and belongs to a real press. */
export function TiffMark({
  chevron,
  spark,
  halo,
  core,
}: {
  chevron: number;
  spark: number;
  /** On a dark ground the glow does the separating. */
  halo?: boolean;
  /** On a light ground the core holds the mark's contrast instead. */
  core?: boolean;
}) {
  return (
    <>
      {halo && <span className="tiffbtn-halo" aria-hidden="true" />}
      <span className="tiffbtn-face">
        {core && <span className="tiffbtn-core" aria-hidden="true" />}
        <Chevron size={chevron} gradient className="tiffbtn-mk" />
        <span className="tiffbtn-spark" aria-hidden="true">
          <svg width={spark} height={spark} viewBox="0 0 24 24" aria-hidden="true">
            <defs>
              {/* A fixed brand gradient, so a constant id is safe: identical
                  defs never collide visually, and unlike a render-time counter
                  it is identical on the server and the client. */}
              <linearGradient id="tiffSpark" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#00E5C0" />
                <stop offset="0.55" stopColor="#2E68FF" />
                <stop offset="1" stopColor="#8A2BE2" />
              </linearGradient>
            </defs>
            <path
              d="M12 2.8 14 9l6.2 2L14 13l-2 6.2L10 13l-6.2-2L10 9Zm7.2 12.4.9 2.7 2.7.9-2.7.9-.9 2.7-.9-2.7-2.7-.9 2.7-.9Z"
              fill="url(#tiffSpark)"
            />
          </svg>
        </span>
      </span>
    </>
  );
}
