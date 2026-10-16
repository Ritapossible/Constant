import { BILL_PRICES, FACTS, TOPUP_EXAMPLES, TOPUP_RANGE } from "@/lib/pricing";
import { SITE_URL } from "@/lib/site";

/** A plain-text summary for AI assistants (llmstxt.org), from the same prices as /pricing (D-075). */
export const dynamic = "force-static";

export function GET() {
  const body = `# ConstantUnits

> Autopay for prepaid bills in Nigeria: data, airtime, electricity, TV and subscriptions. People set money aside
> in a pot per bill, and ConstantUnits pays each bill on its date or before it runs out, within limits they set.

## What it pays

- Data and airtime on MTN, Airtel, Glo and T2, topped up before the line runs low.
- Prepaid electricity tokens for Nigerian DisCos, and postpaid bills on a date.
- TV: DStv, GOtv, StarTimes, renewed the day before they expire.
- Subscriptions, including AI tools: planned (they need a naira-funded virtual card).

## Pricing

${BILL_PRICES.map((b) => `- ${b.label}: ${b.fee}. ${b.basis}`).join("\n")}

Adding money:
- Bank transfer to the user's own ConstantUnits account number: free.
- Card, USSD or QR (${TOPUP_RANGE}): Paystack's fee added at cost, shown before paying. For example, ${TOPUP_EXAMPLES.map((t) => `${t.credit} costs ${t.total}`).join("; ")}.
- Stablecoins (USDC or USDT on Base, USDC on Arc): the same naira fees, at the market rate.

${FACTS.map((f) => `- ${f}`).join("\n")}

## Links

- Home: ${SITE_URL}
- Pricing: ${SITE_URL}/pricing
- App: ${SITE_URL}/app
- Privacy: ${SITE_URL}/privacy
`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
