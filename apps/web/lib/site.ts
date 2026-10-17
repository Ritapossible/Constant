/**
 * The public address of the site. Set NEXT_PUBLIC_SITE_URL once you have a
 * custom domain. On Vercel it falls back to the production URL Vercel provides.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

export const SITE_TITLE = "ConstantUnits | Autopay for Data, Electricity, DStv & Subscriptions";
export const SITE_DESCRIPTION =
  "Autopay for data, airtime, electricity tokens, DStv, GOtv and subscriptions. Set money aside once; ConstantUnits pays on time and warns you before anything runs low.";

/** Where people reach ConstantUnits. One address everywhere (footer, privacy, FAQ, /llms.txt). */
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "constantunitshq@gmail.com";
