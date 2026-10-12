/* A row of a job's materials list as a quote's parts write it: what it is,
   the detail under it, and how many (lines-job.ts linesMaterials). Pure. */

export type OptionRow = {
  name: string;
  sub: string;
  qty: string;
};
