"use client";

import { SectionTitle } from "@/components/settings/parts";
import { Servicem8Group } from "./servicem8-group";
import { XeroGroup } from "./xero-group";
import type { Servicem8Props, XeroProps } from "./types";
import "@/components/settings/integrations.css";

/* SETTINGS › INTEGRATIONS (v2, 25 October 2026; the mock's Integrations
   board, Isaac: "Build Settings as the mock shows: the six sections", and
   of this one, "just should be called integration. Or integrations"). The
   apps this workspace is connected to, each a group under its line:
   ServiceM8, where the day's work lives, then Xero, where the money does.
   Everything the two old screens did is in their groups; the index that
   listed them is the section's title. */
export function IntegrationsScreen({ servicem8, xero }: { servicem8: Servicem8Props; xero: XeroProps }) {
  return (
    <>
      <SectionTitle>Integrations</SectionTitle>
      <Servicem8Group {...servicem8} />
      <XeroGroup {...xero} />
    </>
  );
}
