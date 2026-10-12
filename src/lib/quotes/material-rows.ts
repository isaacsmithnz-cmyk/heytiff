/* A row of a job's materials list as an option's kit writes it: what it
   is, the detail under it, and how many. Pure, so option-materials.ts and
   the server that puts an accepted option on the job share it. */

export type OptionRow = {
  name: string;
  sub: string;
  qty: string;
  /** the system a unit is part of, so its indoor and outdoor are priced
      from one supplier (job-price.ts) */
  system?: number;
};
