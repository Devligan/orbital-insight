import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  // Third-party runtime assets copied into public/ by the prebuild script.
  { ignores: ["public/**", ".next/**", ".next-prod/**"] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
];

export default eslintConfig;
