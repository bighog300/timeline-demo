import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const forbiddenDir = path.join(root, "apps/web/app/api/auth");
const forbiddenRoute = path.join(
  root,
  "apps/web/app/api/auth/[...nextauth]/route.ts",
);

const violations = [];

if (fs.existsSync(forbiddenDir)) {
  violations.push(`Found forbidden App Router auth directory: ${forbiddenDir}`);
}

if (fs.existsSync(forbiddenRoute)) {
  violations.push(`Found forbidden App Router NextAuth route: ${forbiddenRoute}`);
}

const forbiddenContentChecks = [
  { label: "app/api/auth/[...nextauth]", pattern: "app/api/auth/[...nextauth]" },
];

const forbiddenImportPatterns = [
  {
    label: "app/api/auth",
    pattern: /(?:^|\n)\s*import[^;]*["'][^"']*app\/api\/auth[^"']*["']/,
  },
  {
    label: "[...nextauth]/route",
    pattern: /(?:^|\n)\s*import[^;]*["'][^"']*\[\.\.\.nextauth\]\/route[^"']*["']/,
  },
  {
    label: "app/api/auth (require)",
    pattern: /require\(\s*["'][^"']*app\/api\/auth[^"']*["']\s*\)/,
  },
  {
    label: "[...nextauth]/route (require)",
    pattern: /require\(\s*["'][^"']*\[\.\.\.nextauth\]\/route[^"']*["']\s*\)/,
  },
];

const files = execSync("git ls-files", { encoding: "utf8" })
  .split("\n")
  .map((entry) => entry.trim())
  .filter(Boolean);

for (const file of files) {
  const absolutePath = path.join(root, file);
  let contents = "";
  try {
    contents = fs.readFileSync(absolutePath, "utf8");
  } catch {
    continue;
  }

  for (const check of forbiddenContentChecks) {
    if (contents.includes(check.pattern)) {
      violations.push(
        `Found forbidden reference "${check.label}" in ${file}.`,
      );
    }
  }

  for (const check of forbiddenImportPatterns) {
    if (check.pattern.test(contents)) {
      violations.push(
        `Found forbidden import reference "${check.label}" in ${file}.`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error("❌ App Router auth is forbidden.");
  console.error("NextAuth v4 must use pages/api/auth/[...nextauth] only.");
  console.error("Remove any app/api/auth routes or references.");
  console.error("");
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("Auth routing verification passed.");
