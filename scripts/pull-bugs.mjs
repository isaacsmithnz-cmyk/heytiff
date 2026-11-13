#!/usr/bin/env node
/* THE PHONE'S BUGS, ON THE MAC (lib/mobile/bugs). Copies every bug the phone's
   bug button saved into ~/Developer/heytiff-bugs (BUGS_DIR to put them
   elsewhere): 0012.png beside 0012.txt. A picture already there is left; its
   .txt is read again, as a note can come after the shot. With more than one
   workspace's bugs, each gets a folder of its own.

     npm run bugs            everything new
     npm run bugs -- 12      bug 12 again, picture and all
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (.env.local).");
  process.exit(1);
}
const BUCKET = "documents";
const out = process.env.BUGS_DIR || path.join(os.homedir(), "Developer", "heytiff-bugs");
const again = process.argv[2] ? String(process.argv[2]).padStart(4, "0") : null;
const store = createClient(url, key, { auth: { persistSession: false } }).storage.from(BUCKET);

const list = async (prefix) => {
  const { data, error } = await store.list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (error) throw new Error(`${prefix}: ${error.message}`);
  return data ?? [];
};

const orgs = (await list("bugs")).filter((f) => !f.id).map((f) => f.name);
fs.mkdirSync(out, { recursive: true });
let fresh = 0;
for (const org of orgs) {
  const dir = orgs.length > 1 ? path.join(out, org) : out;
  fs.mkdirSync(dir, { recursive: true });
  // each bug's .txt before its picture, so the line printed for the picture reads its facts
  const named = (await list(`bugs/${org}`)).sort((a, b) => a.name.slice(0, -4).localeCompare(b.name.slice(0, -4)) || (a.name.endsWith(".txt") ? -1 : 1));
  for (const f of named) {
    if (!/^\d{4,}\.(png|txt)$/.test(f.name)) continue;
    const local = path.join(dir, f.name);
    const isPng = f.name.endsWith(".png");
    if (isPng && fs.existsSync(local) && f.name.slice(0, -4) !== again) continue;
    const { data, error } = await store.download(`bugs/${org}/${f.name}`);
    if (error || !data) {
      console.error(`${f.name}: ${error?.message ?? "nothing came back"}`);
      continue;
    }
    fs.writeFileSync(local, Buffer.from(await data.arrayBuffer()));
    if (isPng) {
      fresh += 1;
      const txt = path.join(dir, f.name.replace(/\.png$/, ".txt"));
      const facts = fs.existsSync(txt) ? fs.readFileSync(txt, "utf8") : "";
      const when = /^When: (.*)$/m.exec(facts)?.[1];
      const page = /^Page: (.*)$/m.exec(facts)?.[1] ?? "";
      const note = /^Note: (.*)$/m.exec(facts)?.[1] ?? "";
      const at = when ? new Date(when).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
      console.log([f.name.slice(0, -4), at, page, note].filter(Boolean).join("  "));
    }
  }
}
console.log(fresh ? `${fresh} new in ${out}` : `Nothing new in ${out}`);
