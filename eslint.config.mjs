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
  // Build scripts are CLIs: their progress lines on stdout are the interface.
  {
    files: ["scripts/**/*.mjs"],
    rules: { "no-console": "off" },
  },
];

export default eslintConfig;
