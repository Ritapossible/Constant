/**
 * Facts the privacy policy, terms and refund policy are written from (D-081). Change the code first, then this:
 * each line must stay true of what the app does.
 */

/** Shown at the top of each legal page. Update it whenever a page's meaning changes. */
export const LEGAL_UPDATED = "23 October 2026";

/**
 * The business behind ConstantUnits. Set NEXT_PUBLIC_LEGAL_NAME and NEXT_PUBLIC_LEGAL_ADDRESS once it is
 * registered (CAC); until then the pages say the details will be published before payments open.
 */
export const LEGAL_NAME = process.env.NEXT_PUBLIC_LEGAL_NAME || null;
export const LEGAL_ADDRESS = process.env.NEXT_PUBLIC_LEGAL_ADDRESS || null;

export type Service = {
  name: string;
  /** Who runs it and where the data is handled. */
  where: string;
  why: string;
  data: string;
};

/** Every outside service that receives personal data, from the code (apps/api, apps/worker, apps/web). */
export const SERVICES: Service[] = [
  {
    name: "Privy",
    where: "Privy, Inc. · United States",
    why: "Signing you in, and creating the wallet that holds your stablecoins",
    data: "The sign-in method you choose (email address, Google name and email, or wallet address), your wallet addresses, and device and IP details used to keep sign-in secure",
  },
  {
    name: "Paystack",
    where: "Paystack Payments Limited · Nigeria",
    why: "Your ConstantUnits account number, card, USSD and QR top-ups, and returning money to your bank",
    data: "Your name, email address and phone number, amounts and references, the bank account you ask us to send money to, and, when you verify your identity, your BVN and a bank account in your name, which Paystack checks with the banks. We keep only the last 4 digits of your BVN. Card details go to Paystack only; ConstantUnits never sees them",
  },
  {
    name: "VTpass",
    where: "VTpass · Nigeria",
    why: "Paying your bills to the networks, electricity companies and TV providers",
    data: "The phone, meter or smartcard number of each bill, the amount, and a contact phone number. It returns the name on the meter or decoder",
  },
  {
    name: "Resend",
    where: "Resend · United States",
    why: "Sending you receipts, tokens and reminders by email",
    data: "Your email address and the message",
  },
  {
    name: "Telegram",
    where: "Telegram · United Arab Emirates",
    why: "Sending you receipts, tokens and reminders, and taking STOP and START, if you connect it",
    data: "Your Telegram chat ID and the messages between you and the ConstantUnits bot",
  },
  {
    name: "Termii",
    where: "Termii · Nigeria",
    why: "Sending you receipts, tokens and reminders by SMS, when SMS is on",
    data: "Your phone number and the message",
  },
  {
    name: "Circle",
    where: "Circle · United States",
    why: "Checking wallet addresses against sanctions lists before stablecoins pay a bill",
    data: "Wallet addresses",
  },
  {
    name: "Hosting: Vercel, Pxxl and Neon",
    where: "Vercel (website, global) · Pxxl (servers, Germany) · Neon (database, Frankfurt, Germany)",
    why: "Running the website, the servers and the database that keep your account",
    data: "Everything in your account, stored encrypted where noted below, and the IP address and browser details in short-lived server logs",
  },
  {
    name: "Base and Arc networks",
    where: "Public blockchains",
    why: "Holding your stablecoins in your own wallet, and paying bills from them when you allow it",
    data: "Your wallet address and its transactions, which are public on these networks by design. The app reads balances through a public network node, which sees your IP address and wallet address",
  },
];

/** What isn't used, said plainly. */
export const NOT_USED = "No advertising, no analytics or tracking tools, no session recording, and we never sell your data.";
