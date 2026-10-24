// Next's recommended rules plus React's hook rules: the mistakes that break a screen at runtime, caught in CI.
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Off: jsx-ast-utils 3.3.5 crashes evaluating BigInt arithmetic in JSX props (money is BigInt everywhere here).
      "jsx-a11y/role-supports-aria-props": "off",
      // Advice, not a defect: loading data in an effect and setting state from it is how these screens fetch.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    // The marketing site (landing page and its sections) is frozen; its findings are shown, not enforced.
    files: ["components/*.tsx", "app/page.tsx"],
    rules: { "@next/next/no-html-link-for-pages": "warn", "react/no-unescaped-entities": "warn" },
  },
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "public/**"] },
];

export default config;
