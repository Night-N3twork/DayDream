import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("uses credentialless COEP for Daydream production and dev pages", () => {
  const production = readFileSync(`${process.cwd()}/index.ts`, "utf8");
  const development = readFileSync(`${process.cwd()}/vite.config.ts`, "utf8");

  expect(production).toMatch(/crossOriginEmbedderPolicy:\s*\{\s*policy:\s*["']credentialless["']\s*\}/);
  expect(development).toMatch(/"Cross-Origin-Embedder-Policy":\s*"credentialless"/);
});
