import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredDocs = [
  "START_HERE.md",
  "ARCHITECTURE.md",
  "RUNBOOK.md",
  "CHANGELOG.md",
];

const missingDocs = requiredDocs.filter((doc) => !fs.existsSync(path.join(root, doc)));
if (missingDocs.length > 0) {
  console.error(`Missing required docs: ${missingDocs.join(", ")}`);
  process.exit(1);
}

const readmePath = path.join(root, "README.md");
if (fs.existsSync(readmePath)) {
  const readme = fs.readFileSync(readmePath, "utf8");
  const missingLinks = requiredDocs.filter((doc) => !readme.includes(doc));
  if (missingLinks.length > 0) {
    console.error(`README.md missing links to: ${missingLinks.join(", ")}`);
    process.exit(1);
  }
}

console.log("Docs verification passed.");
