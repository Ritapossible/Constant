import { CONTACT_EMAIL } from "@/lib/site";
import { LEGAL_ADDRESS, LEGAL_NAME } from "@/lib/legal";

/** Who to write to, and who is responsible, at the end of each legal page. */
export function LegalContact() {
  return (
    <>
      <h2>Contact</h2>
      <p>
        For privacy, legal or refund requests, write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We reply within two business days.
      </p>
      {LEGAL_NAME ? (
        <p>
          ConstantUnits is operated by {LEGAL_NAME}
          {LEGAL_ADDRESS ? `, ${LEGAL_ADDRESS}` : ""}.
        </p>
      ) : (
        <p>ConstantUnits is in early access. The registered business details and postal address will be published here before payments open.</p>
      )}
      <p className="muted">This page is written in plain language. If anything here is unclear, write to us and we will explain it.</p>
    </>
  );
}
