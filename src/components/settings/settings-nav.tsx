"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { sectionAt, type SettingsSection } from "@/lib/settings/sections";

/* The side list (the mock's left column): each section a 36 row, the one
   you're on in the selected fill and bold, as the sidebar marks its place.
   Which one is on comes from the address, read with usePathname, which
   resolves at once on a client navigation, so the list never waits for the
   page it points at. */
export function SettingsNav({ sections }: { sections: Pick<SettingsSection, "key" | "label" | "href" | "under">[] }) {
  const on = sectionAt(usePathname() ?? "", sections);
  return (
    <nav className="st2-nav" aria-label="Settings">
      {sections.map((s) => (
        <Link
          key={s.key}
          href={s.href}
          className={s.key === on ? "st2-navitem on" : "st2-navitem"}
          aria-current={s.key === on ? "page" : undefined}
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}
