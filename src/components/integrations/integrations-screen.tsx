"use client";

import { SectionTitle } from "@/components/settings/parts";
import { Servicem8Group } from "./servicem8-group";
import { XeroGroup } from "./xero-group";
import { EmailGroup, type EmailInProps } from "./email-group";
import type { Servicem8Props, XeroProps } from "./types";
import "@/components/settings/integrations.css";

/* SETTINGS › INTEGRATIONS (v2, 25 October 2026; the mock's Integrations
   board, Isaac: "Build Settings as the mock shows: the six sections", and
   of this one, "just should be called integration. Or integrations"). The
   apps this workspace is connected to, each a group under its line:
   ServiceM8, where the day's work lives, then Xero, where the money does,
   then Tiff's own address, where a forwarded email comes in (28 October).
   Everything the two old screens did is in their groups; the index that
   listed them is the section's title. */
export function IntegrationsScreen({ servicem8, xero, email }: { servicem8: Servicem8Props; xero: XeroProps; email: EmailInProps }) {
  return (
    <>
      <SectionTitle>Integrations</SectionTitle>
      <Servicem8Group {...servicem8} />
      <XeroGroup {...xero} />
      <EmailGroup {...email} />
    </>
  );
}
