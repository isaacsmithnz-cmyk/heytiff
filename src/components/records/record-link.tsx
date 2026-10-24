"use client";

import Link from "next/link";
import { useContext, type ComponentProps, type MouseEvent } from "react";
import { recordOfHref } from "@/lib/records/ref";
import { RecordsContext } from "./records-context";

/* A LINK THAT OPENS ITS RECORD WHERE YOU ARE.

   A drop-in for `next/link` on any door whose address may be a record's.
   When the address is a maintenance visit's or a service agreement's (they
   have no page of their own) and the record host is mounted, a plain click
   opens it over the screen you are on. A job's address is its page, and
   a link to it is just a link (24 October 2026: the job card over the
   screen went). Everything else is untouched: a ⌘-click, a middle click or
   a `target` still opens the address the browser's way, the address is
   still the real one to copy, and any other link is just a link.

   It takes the click itself rather than Next's `onNavigate`, which Next
   only calls once its router is mounted: the door must behave the same in a
   page drawn on its own. Next leaves a click whose default was prevented
   alone. */

function modified(e: MouseEvent<HTMLAnchorElement>): boolean {
  const target = e.currentTarget.getAttribute("target");
  return (!!target && target !== "_self") || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
}

export function RecordLink({
  href,
  onClick,
  returnFocus,
  ...rest
}: ComponentProps<typeof Link> & {
  href: string;
  /** Where focus goes when the record closes, for a link that will not be
      there then (a row in a popover that closes behind it). The link itself
      otherwise. */
  returnFocus?: (link: HTMLAnchorElement) => HTMLElement | null;
}) {
  const host = useContext(RecordsContext);
  const named = host?.hosted ? recordOfHref(href) : null;
  const target = named && named.ref.kind !== "job" ? named : null;
  return (
    <Link
      href={href}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (!target || !host || e.defaultPrevented || modified(e)) return;
        e.preventDefault();
        const link = e.currentTarget;
        host.open(target.ref, { from: returnFocus ? returnFocus(link) : link });
      }}
    />
  );
}
