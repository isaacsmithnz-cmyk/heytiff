import type { InputHTMLAttributes, ReactNode } from "react";

/* The first run's pieces, on the web: the phone's boxes and rows (heytiff-mobile
   components/MyDetails) in the web's own sizes, fields 36 tall with a 6 corner
   and their label over them (design.md rules 28, 33), a white group on the
   grey for rows (rule 35), state as a dot and a word (rule 17). */

export const INPUT =
  "h-9 w-full rounded-[var(--r-control)] border border-[var(--edge)] bg-white px-3 text-[14px] text-[var(--ink)] " +
  "placeholder:text-[var(--q)] outline-none focus:shadow-[var(--ring)]";
export const INPUT_BAD = `${INPUT} border-[var(--bad-t)]`;

export function Field({ id, label, children, className }: { id?: string; label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium leading-[18px] text-[var(--q)]">
        {label}
      </label>
      {children}
    </div>
  );
}

/** A box with its label over it, red-edged when the save named it. */
export function Box({
  id,
  label,
  value,
  onChange,
  bad,
  className,
  ...rest
}: { id: string; label: string; value: string; onChange: (v: string) => void; bad?: boolean; className?: string } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "value" | "onChange" | "className"
>) {
  return (
    <Field id={id} label={label} className={className}>
      <input id={id} name={id} className={bad ? INPUT_BAD : INPUT} value={value} aria-invalid={bad || undefined} onChange={(e) => onChange(e.target.value)} {...rest} />
    </Field>
  );
}

/** How far along: one bar per step, the ones done and the one you're on in ink. */
export function Steps({ count, at }: { count: number; at: number }) {
  return (
    <div className="flex gap-1" aria-label={`Step ${at + 1} of ${count}`}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={`h-[3px] flex-1 rounded-full ${i <= at ? "bg-[var(--ink)]" : "bg-[var(--line)]"}`} />
      ))}
    </div>
  );
}

/** A row on a white group: its name in bold, a grey line under it, and what's on its right. */
export function Row({ name, sub, children, first }: { name: ReactNode; sub?: ReactNode; children?: ReactNode; first?: boolean }) {
  return (
    <div className={`flex min-h-14 items-center gap-3 px-4 py-2.5 ${first ? "" : "border-t border-[var(--line)]"}`}>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-[var(--ink)]">{name}</div>
        {sub ? <div className="text-[13px] leading-[18px] text-[var(--q)]">{sub}</div> : null}
      </div>
      {children}
    </div>
  );
}

/** State in words: a dot and a word in its colour (rule 17). */
export function Word({ tone, children }: { tone: "ok" | "look" | "fyi"; children: string }) {
  const c = tone === "ok" ? "var(--green-w)" : tone === "look" ? "var(--orange-w)" : "var(--q)";
  const dot = tone === "ok" ? "var(--green)" : tone === "look" ? "var(--orange)" : "var(--grey)";
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: c }}>
      <span className="h-2 w-2 rounded-full" style={{ background: dot }} />
      {children}
    </span>
  );
}

/** dd/mm/yyyy, shaped as it's typed. */
export function maskDate(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join("/");
}
