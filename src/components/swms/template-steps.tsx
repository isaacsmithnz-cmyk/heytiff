import { buildSwms, DEFAULT_ANSWERS, LEVEL_LABEL } from "@/lib/swms/library";

/* THE SWMS TEMPLATE, READ — every step with its hazards and controls, as the
   template writes them with nothing chosen on site yet.

   What the owner reads before approving it, on the template page and in the
   wizard. The control levels stay here: this is the business deciding that
   these controls are its own, which is exactly where the hierarchy matters.
   Pure and hook-free, so a server page and a client wizard both render it. */

const PREVIEW = buildSwms(
  { ...DEFAULT_ANSWERS, isolation: "the isolation point", hospital: "—" },
  { work: "", electricianName: "the electrician", firstAiderName: null }
);

export function TemplateSteps() {
  return (
    <>
      {PREVIEW.steps.map((s) => (
        <div key={s.key} className="sw-grp">
          <div className="sw-gh">
            <b>{s.title}</b>
          </div>
          <p className="sw-text">{s.hazards}</p>
          <ul className="sw-lib">
            {s.controls.map((c) => (
              <li key={c.text}>
                <span>{LEVEL_LABEL[c.level]}</span>
                {c.text}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}
