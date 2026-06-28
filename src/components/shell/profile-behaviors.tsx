"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { LIC_TYPES, licCard, profileIcon as ic } from "./profile";
import { NAV } from "./nav";

/* Renders the staff-profile HTML and attaches the v3 design's interactions:
   section nav, cost-split auto-balance + donut, role select, toggles,
   doc verify/upload/delete, add/remove licence, work-rights conditional.

   EDIT MODEL — per-card (NOT the design's default). The design exports a global
   `.prof.readonly` toggle (clicking one card's Edit unlocks the whole profile,
   which risks accidental edits to unrelated cards e.g. an emergency-contact
   number). Here, each `.card2` carries its own `readonly` and only the clicked
   card unlocks. The matching CSS lives in shell.css (`.card2.readonly …`).
   ⚠ ON RE-IMPORT: the fresh export will reset this to `.prof.readonly` in both
   shell.css and the handler — re-scope it to `.card2` again (or fix it in the
   Claude design so it survives). */
export function ProfileBehaviors({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const profileEmpties = () => {
      const prof = root.querySelector(".prof");
      if (!prof) return;
      prof.querySelectorAll(".card2 > .c2h").forEach((h) => {
        if (h.querySelector(".cardactions")) return;
        const w = document.createElement("span");
        w.className = "cardactions";
        w.innerHTML =
          `<button class="cardedit" data-edit>${ic("edit", 14)}Edit</button>` +
          `<button class="cardbtn ghost" data-cancel>Cancel</button>` +
          `<button class="cardbtn save" data-save>${ic("check", 14)}Save</button>`;
        h.appendChild(w);
      });
      prof
        .querySelectorAll<HTMLInputElement>("input.inp, textarea.inp, select.inp")
        .forEach((el) => el.classList.toggle("is-empty", !el.value));
    };
    // Open every card read-only; each unlocks individually via its own Edit.
    root.querySelectorAll(".card2").forEach((c) => c.classList.add("readonly"));
    profileEmpties();

    const onClick = (e: Event) => {
      const t = e.target as HTMLElement;

      // breadcrumb -> route back to the section
      const nav = t.closest<HTMLElement>("[data-nav]");
      if (nav) {
        const item = NAV.find((n) => n.key === nav.dataset.nav);
        if (item) router.push(item.href);
        return;
      }

      // section nav
      const psec = t.closest<HTMLElement>("[data-psec]");
      if (psec) {
        const k = psec.dataset.psec;
        root.querySelectorAll(".pnav .pn").forEach((x) => x.classList.toggle("on", x === psec));
        root.querySelectorAll<HTMLElement>(".psec").forEach((s) => s.classList.toggle("on", s.dataset.sec === k));
        document.querySelector(".outlet")?.scrollTo({ top: 0 });
        profileEmpties();
      }

      // permission toggle
      const ptog = t.closest<HTMLElement>("[data-toggle]");
      if (ptog) ptog.classList.toggle("on");

      // segmented (Active / Inactive)
      const pseg = t.closest<HTMLButtonElement>(".seg button");
      if (pseg && pseg.parentElement) {
        pseg.parentElement.querySelectorAll("button").forEach((b) => b.classList.remove("on", "green"));
        pseg.classList.add("on");
        if (pseg.textContent?.trim() === "Active") pseg.classList.add("green");
      }

      // role selection
      const prole = t.closest<HTMLElement>(".permrole");
      if (prole && prole.parentElement) {
        prole.parentElement.querySelectorAll(".permrole").forEach((p) => p.classList.remove("on"));
        prole.classList.add("on");
        const rb = prole.querySelector<HTMLInputElement>("input");
        if (rb) rb.checked = true;
      }

      // read-only <-> edit — scoped to the clicked card only
      const ped = t.closest<HTMLElement>("[data-edit]");
      if (ped) {
        ped.closest(".card2")?.classList.remove("readonly");
        profileEmpties();
        return;
      }
      const pca = t.closest<HTMLElement>("[data-cancel]");
      if (pca) {
        pca.closest(".card2")?.classList.add("readonly");
        profileEmpties();
        return;
      }
      const psv = t.closest<HTMLElement>("[data-save]");
      if (psv) {
        psv.closest(".card2")?.classList.add("readonly");
        profileEmpties();
        return;
      }

      // doc verify / upload / delete
      const dv = t.closest<HTMLElement>("[data-docverify]");
      if (dv) {
        const row = dv.closest<HTMLElement>(".docrow");
        if (row) {
          row.classList.add("verified");
          dv.classList.add("done");
          dv.innerHTML = `${ic("check", 14)}Verified`;
          const b = row.querySelector(".dock b");
          if (b && b.textContent === "No document uploaded") b.textContent = "Verified manually";
          const em = row.querySelector(".dock em");
          if (em) em.textContent = "Working rights confirmed";
        }
        return;
      }
      const dup = t.closest<HTMLElement>("[data-docupload]");
      if (dup) {
        const row = dup.closest<HTMLElement>(".docrow");
        if (row) {
          const b = row.querySelector(".dock b");
          if (b) b.textContent = "passport.pdf";
          const em = row.querySelector(".dock em");
          if (em) em.textContent = "Uploaded · awaiting verification";
          dup.outerHTML = `<button class="docbtn del" data-docdel title="Delete document">${ic("x", 15)}</button>`;
        }
        return;
      }
      const dd = t.closest<HTMLElement>("[data-docdel]");
      if (dd) {
        const row = dd.closest<HTMLElement>(".docrow");
        if (row) {
          row.classList.remove("verified");
          const b = row.querySelector(".dock b");
          if (b) b.textContent = "No document uploaded";
          const em = row.querySelector(".dock em");
          if (em) em.textContent = "Optional — verify manually or attach evidence";
          dd.outerHTML = `<button class="docbtn ghostbtn docup" data-docupload>${ic("upload", 14)}Upload</button>`;
        }
        return;
      }

      // licence remove
      const ldel = t.closest<HTMLElement>("[data-licdel]");
      if (ldel) {
        ldel.closest(".lic")?.remove();
        const ll = root.querySelector("#lic-list");
        const le = root.querySelector<HTMLElement>("#lic-empty");
        if (ll && le && !ll.children.length) le.style.display = "";
        return;
      }

      // licence add
      const ladd = t.closest<HTMLElement>("#lic-add");
      if (ladd) {
        const sel = root.querySelector<HTMLSelectElement>("#lic-type");
        const cu = root.querySelector<HTMLInputElement>("#lic-custom");
        const ll = root.querySelector("#lic-list");
        const le = root.querySelector<HTMLElement>("#lic-empty");
        if (!sel || !cu || !ll) return;
        let lic = null as null | { name: string; sub?: string; color?: string };
        if (sel.value === "__custom") {
          const nm = (cu.value || "").trim();
          if (!nm) {
            cu.focus();
            return;
          }
          lic = { name: nm };
        } else if (sel.value) {
          lic = LIC_TYPES.find((x) => x.name === sel.value) ?? null;
        }
        if (!lic) {
          sel.focus();
          return;
        }
        ll.insertAdjacentHTML("beforeend", licCard(lic));
        if (le) le.style.display = "none";
        sel.selectedIndex = 0;
        cu.value = "";
        cu.style.display = "none";
        sel.style.display = "";
        return;
      }
    };

    const onInput = (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (!target.classList.contains("csrange")) return;
      const cs = target.closest<HTMLElement>(".field");
      if (!cs) return;
      const ranges = [...cs.querySelectorAll<HTMLInputElement>(".csrange")];
      const idx = +(target.dataset.cs || 0);
      const v = Math.round(+target.value);
      const others = ranges
        .map((r, i) => (i === idx ? null : { i, val: Math.round(+r.value), newVal: 0 }))
        .filter(Boolean) as { i: number; val: number; newVal: number }[];
      const othersTotal = others.reduce((a, o) => a + o.val, 0);
      const remaining = 100 - v;
      if (othersTotal === 0) others.forEach((o) => (o.newVal = Math.round(remaining / others.length)));
      else others.forEach((o) => (o.newVal = Math.round(remaining * (o.val / othersTotal))));
      const sum = v + others.reduce((a, o) => a + o.newVal, 0);
      if (others.length) others[0].newVal += 100 - sum;
      const vals: number[] = [];
      vals[idx] = v;
      others.forEach((o) => {
        vals[o.i] = o.newVal;
        ranges[o.i].value = String(o.newVal);
      });
      ranges.forEach((r, i) => {
        const valEl = r.parentElement?.querySelector(".csval");
        if (valEl) valEl.textContent = vals[i] + "%";
      });
      const segs = cs.querySelectorAll(".csseg");
      let acc = 0;
      vals.forEach((val, i) => {
        if (segs[i]) {
          segs[i].setAttribute("stroke-dasharray", val + " " + (100 - val));
          segs[i].setAttribute("stroke-dashoffset", String(-acc));
          acc += val;
        }
      });
      const tot = cs.querySelector(".cstot b");
      if (tot) tot.textContent = "100";
    };

    const onChange = (e: Event) => {
      const target = e.target as HTMLSelectElement;
      if (target.id === "lic-type") {
        const cu = root.querySelector<HTMLInputElement>("#lic-custom");
        if (!cu) return;
        if (target.value === "__custom") {
          target.style.display = "none";
          cu.style.display = "";
          cu.focus();
        } else {
          cu.style.display = "none";
        }
      }
      if (target.id === "wr-status") {
        const v = target.value;
        const grp = root.querySelector<HTMLElement>("#wr-visa");
        const noVisa = v === "Australian citizen" || v === "Permanent resident";
        if (grp) {
          grp.style.opacity = noVisa ? ".35" : "";
          grp.style.pointerEvents = noVisa ? "none" : "";
          grp.querySelectorAll<HTMLInputElement>("input,select").forEach((el) => {
            el.disabled = noVisa;
            if (noVisa) el.value = "";
          });
        }
      }
    };

    root.addEventListener("click", onClick);
    root.addEventListener("input", onInput);
    root.addEventListener("change", onChange);
    return () => {
      root.removeEventListener("click", onClick);
      root.removeEventListener("input", onInput);
      root.removeEventListener("change", onChange);
    };
  }, [router]);

  return <div ref={ref} className="page in" dangerouslySetInnerHTML={{ __html: html }} />;
}
