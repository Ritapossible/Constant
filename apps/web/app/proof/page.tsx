import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { PageHeader } from "@/components/PageHeader";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Stellar proof | ConstantUnits",
  description:
    "ConstantUnits pays Nigerian bills from USDC on Stellar through its own Soroban contract. Every step of our testnet runs, with a link to check it on the ledger.",
  alternates: { canonical: "/proof" },
};

const EXPLORER = "https://stellar.expert/explorer/testnet";
const tx = (hash: string) => `${EXPLORER}/tx/${hash}`;
const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-6)}`;

type Step = { text: string; hash?: string };

/** docs/proof/stellar-e2e.md: the real API and worker, from linking an account to a paid bill and a revoke. */
const E2E = {
  date: "23 October 2026",
  contract: "CAFVOKGNPLNJFTHL47R526U4WT5NPIE37OA2VHMXLQQU4C3OROL372DB",
  steps: [
    { text: "The user links their Stellar account by signing a message in the app." },
    { text: "Their account is opened for USDC; ConstantUnits sponsors every reserve.", hash: "57d1288e9baedb5a6f93addd97a8a53a44e62a69176a3daeb1b24755514230e0" },
    { text: "The user holds 0 XLM, and never needs any." },
    { text: "30 Circle testnet USDC arrive in the user's account.", hash: "f18153d54b694d6394dbbf2a8aec71f35518cc39acd14593d3b08628e30f247d" },
    { text: "A DStv Compact bill (₦19,950) is added." },
    { text: "The app proposes a limit: up to 19.97 USDC every 30 days, until 15 Feb 2027. The user signs once." },
    { text: "The mandate is registered on chain.", hash: "d1f034b907130c986d45e10abe4f291198ae03c2e583aaf2cd066e528e4b4abb" },
    { text: "Renewal day: 14.75 USDC is charged, and confirmed before the bill is paid.", hash: "89ff3db7cb41bb68516688002d68384bc7934ee873396d97879a3f514c58c077" },
    { text: "Exactly ₦19,950 is credited against that transaction, and the decoder is renewed once." },
    { text: "The user taps Stop in the app; the mandate is revoked on chain.", hash: "4a290c94a0aa675c94d55481d4c8bcd1fd950614db072518402cf393ec8af34b" },
    { text: "The user still holds 0 XLM: every fee was ConstantUnits'." },
  ] satisfies Step[],
};

/** docs/proof/stellar-testnet.md: the contract's rules, including the charges it must refuse. */
const RULES = {
  date: "23 October 2026",
  contract: "CDZOET377WDCBXUAOGDGJFYFWA7W3IJWJPMARHW4WVK2AYPHIRWASQCE",
  wasm: "56ab1c614134bde744380b7568da25b480fed5b2e34bff51f385c8ac7fff2e20",
  steps: [
    { text: "A new user's account is opened with every reserve sponsored.", hash: "2767e9bc5eb2d372536134de671779f1ab19b0713af10e0139d15eb0038f47aa" },
    { text: "25 Circle testnet USDC to the user.", hash: "d1462052a6871cf1d25a8aaacd4632c9104e518cf20e529e97cdb2dc7a7e5384" },
    { text: "A signature from any other key is refused." },
    { text: "Mandate created: up to 10.00 USDC every 30 days, for 3 periods.", hash: "5e7247b19a3257a20c226db95ee6e569785fde59fad4e9f43ab3c4950c61bfe5" },
    { text: "Charge 1: 4.00 USDC.", hash: "ca196524902299e6f391475394ecc1db3af819e87551f88bae52e9a94c954ae0" },
    { text: "Charge 2: 6.00 USDC. The treasury has received exactly 10.00." },
    { text: "The same charge again: refused (DuplicateCharge)." },
    { text: "A charge over this period's limit: refused (OverCap)." },
    { text: "Revoked by the user.", hash: "b865975bcafad99ea78a7672f8e934612b0d3e7c88bc39c20a2bcf8c7419d6e1" },
    { text: "A charge after the revoke: refused (Revoked)." },
    { text: "The hour's receipts, as one Merkle root on the ledger; each receipt's proof leads to it.", hash: "583a72d4f784edc61be687058600fd542a7961235d682c07d197ab2193dce51d" },
  ] satisfies Step[],
};

function Run({ steps }: { steps: Step[] }) {
  return (
    <ol className="proof-steps">
      {steps.map((s, i) => (
        <li key={i}>
          <span>{s.text}</span>
          {s.hash && (
            <a href={tx(s.hash)} target="_blank" rel="noreferrer" className="proof-tx">
              {short(s.hash)} ↗
            </a>
          )}
        </li>
      ))}
    </ol>
  );
}

export default function Proof() {
  return (
    <>
      <PageHeader />
      <main id="main" className="container section" style={{ maxWidth: 820 }}>
        <article className="prose">
          <h1 className="h2">Paying bills from USDC on Stellar</h1>
          <p className="muted">Testnet · last run {E2E.date}</p>
          <p className="lede">
            ConstantUnits lets someone keep a Nigerian bill paid straight from USDC on Stellar. They sign once, and our Soroban contract
            makes sure we can never take more than they approved. Everything below happened on Stellar testnet. Each link opens the
            transaction on stellar.expert, so you can check it without trusting us.
          </p>

          <h2>How it works</h2>
          <ul>
            <li>
              <b>No XLM, no seed phrase.</b> The Stellar account is a wallet made with the person&apos;s ConstantUnits sign-in. We
              sponsor the account and its USDC trustline and pay every fee.
            </li>
            <li>
              <b>One signature per bill.</b> The person approves a mandate: the most per period, the period, and an end date. The app
              decodes the exact bytes before they sign, and refuses anything that isn&apos;t what the screen says.
            </li>
            <li>
              <b>The contract enforces the limit.</b> It refuses a charge over the period&apos;s limit, the same charge twice, or any
              charge after the person stops it.
            </li>
            <li>
              <b>The bill is paid in naira</b> only after the USDC charge is confirmed on the ledger, for exactly the bill&apos;s amount.
            </li>
            <li>
              <b>Stop is instant.</b> One tap in the app, and the mandate is revoked on chain.
            </li>
          </ul>

          <h2>End to end, through our API and worker</h2>
          <p>
            Our production API and worker, run against testnet with a test account: from linking a Stellar account to a renewed decoder
            and a revoke. Contract{" "}
            <a href={`${EXPLORER}/contract/${E2E.contract}`} target="_blank" rel="noreferrer">
              <code>{short(E2E.contract)}</code>
            </a>
            .
          </p>
          <Run steps={E2E.steps} />

          <h2>The contract&apos;s rules</h2>
          <p>
            The same contract code on its own, deployed for this run: two charges within the limit, then the three it must refuse.
            Contract{" "}
            <a href={`${EXPLORER}/contract/${RULES.contract}`} target="_blank" rel="noreferrer">
              <code>{short(RULES.contract)}</code>
            </a>
            , code hash <code>{short(RULES.wasm)}</code>.
          </p>
          <Run steps={RULES.steps} />

          <h2>What else backs this</h2>
          <ul>
            <li>The contract is written in Rust with soroban-sdk and has 14 unit tests, run on every change with the rest of our tests.</li>
            <li>Both runs above are scripts that anyone with the code can repeat against testnet; their output is recorded word for word.</li>
            <li>Testnet USDC has no value. Mainnet needs Stellar account screening and production keys first; this is the next step.</li>
          </ul>

          <h2>Next</h2>
          <ul>
            <li>Screening for Stellar accounts, then mainnet with a production RPC provider.</li>
            <li>Turning the USDC we receive into naira at scale.</li>
            <li>The same mandate for electricity and data, not only cable TV.</li>
          </ul>

          <p className="muted" style={{ marginTop: 32 }}>
            Questions about this page: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
        </article>
      </main>
      <Footer />
    </>
  );
}
