"use client";

import { usePathname } from "next/navigation";

/* HQ top-nav links with active-state highlighting. Client-only because active
   detection needs the current pathname; the access guard lives server-side in
   the layout. */

const LINKS = [
  { href: "/hq", label: "Overview" },
  { href: "/hq/data", label: "Data" },
  { href: "/hq/changes", label: "Changes" },
];

function isActive(href: string, pathname: string): boolean {
  if (href === "/hq") return pathname === "/hq";
  return pathname === href || pathname.startsWith(href + "/");
}

export function HqNav() {
  const pathname = usePathname() ?? "/hq";
  return (
    <nav className="hq-nav">
      {LINKS.map((l) => (
        <a
          key={l.href}
          href={l.href}
          className={`hq-nav-link${isActive(l.href, pathname) ? " active" : ""}`}
        >
          {l.label}
        </a>
      ))}
    </nav>
  );
}
