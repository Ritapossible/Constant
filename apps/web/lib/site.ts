/**
 * The public address of the site. Set NEXT_PUBLIC_SITE_URL once you have a
 * custom domain. On Vercel it falls back to the production URL Vercel provides.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

export const SITE_TITLE = "Constant | Autopay for Data, Electricity, DSTV & Subscriptions";
export const SITE_DESCRIPTION =
  "Autopay for data, airtime, electricity tokens, DSTV, GOtv and subscriptions. Set money aside once; Constant pays on time and warns you before anything runs low.";
