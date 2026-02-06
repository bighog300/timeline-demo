#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const strict = args.has('--strict') || args.has('--ci');
const root = process.cwd();

const requiredFiles = ['pnpm-lock.yaml', 'vercel.json', '.env.example', 'package.json'];
const requiredScripts = ['vercel:install', 'vercel:build', 'preflight'];

const errors = [];
const warnings = [];

const ok = (msg) => console.log(`✅ ${msg}`);
const warn = (msg) => {
  warnings.push(msg);
  console.warn(`⚠️  ${msg}`);
};
const fail = (msg) => {
  errors.push(msg);
  console.error(`❌ ${msg}`);
};

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`Unable to parse ${path.relative(root, filePath)}: ${error.message}`);
    return null;
  }
}

console.log('🔎 Running deployment preflight checks...');
console.log(`Mode: ${strict ? 'strict' : 'standard'}`);

for (const rel of requiredFiles) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    fail(`Missing required file: ${rel}`);
  } else {
    ok(`Found ${rel}`);
  }
}

const packageJsonPath = path.join(root, 'package.json');
if (fs.existsSync(packageJsonPath)) {
  const packageJson = readJson(packageJsonPath);
  if (packageJson) {
    const scripts = packageJson.scripts ?? {};

    for (const scriptName of requiredScripts) {
      if (!scripts[scriptName]) {
        fail(`Missing required npm script: ${scriptName}`);
      } else {
        ok(`Script present: ${scriptName}`);
      }
    }

    if (scripts.preflight !== 'node scripts/preflight.mjs') {
      warn(`Expected preflight script to be \"node scripts/preflight.mjs\" but found \"${scripts.preflight ?? 'undefined'}\"`);
    }
  }
}

const vercelPath = path.join(root, 'vercel.json');
if (fs.existsSync(vercelPath)) {
  const vercel = readJson(vercelPath);
  if (vercel) {
    const rewrites = Array.isArray(vercel.rewrites) ? vercel.rewrites : [];
    if (rewrites.length > 0) {
      warn('vercel.json includes rewrites; ensure they are intentional for this deployment.');
    } else {
      ok('No rewrites configured in vercel.json.');
    }
  }
}

if (warnings.length > 0) {
  console.log(`\n⚠️  Completed with ${warnings.length} warning(s).`);
}

if (errors.length > 0) {
  console.error(`\n❌ Preflight failed with ${errors.length} error(s).`);
  process.exit(1);
}

console.log('\n✅ Preflight passed. Repository is deployment-ready for this check level.');
