#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);

function getFlagValue(name, fallback = null) {
  const exact = args.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return fallback;
}

const target = getFlagValue('--target', 'all');
const envFileArg = getFlagValue('--env-file', '.env');
const prod = args.includes('--prod');

const allowedTargets = new Set(['api', 'web', 'all']);
if (!allowedTargets.has(target)) {
  console.error(`❌ Invalid --target value: ${target}. Expected one of: api, web, all.`);
  process.exit(1);
}

function parseDotEnv(content) {
  const result = {};
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2] ?? '';

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

const envFilePath = path.resolve(process.cwd(), envFileArg);
let envSource = { ...process.env };
let loadedFromFile = false;

if (fs.existsSync(envFilePath)) {
  const fileContent = fs.readFileSync(envFilePath, 'utf8');
  envSource = { ...envSource, ...parseDotEnv(fileContent) };
  loadedFromFile = true;
}

const API_REQUIRED = [
  'DATABASE_URL',
  'SESSION_SECRET',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_REDIRECT_URI',
  'ENCRYPTION_KEY_BASE64',
  'KEY_VERSION',
  'OPENAI_API_KEY',
  'ADMIN_EMAILS',
  'PORT',
  'DRIVE_ADAPTER',
];

// Web currently has no required runtime env vars; keep this empty until the UI
// needs guaranteed values across all environments.
const WEB_REQUIRED = [];

const PLACEHOLDER_PATTERNS = [/your-/i, /example\.com/i, /^sk-your/i, /YOUR-API-DOMAIN\.com/i];

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

function checkKeys(keys, label) {
  console.log(`\n🔎 Checking ${label} environment requirements...`);

  for (const key of keys) {
    const value = envSource[key];

    if (value === undefined || value === null || String(value).trim() === '') {
      fail(`${label}: Missing required key ${key}`);
      continue;
    }

    ok(`${label}: ${key} is set`);

    if (prod && PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(String(value)))) {
      fail(`${label}: ${key} appears to contain placeholder/example data in --prod mode`);
    }
  }
}

console.log('🔎 Running environment validation...');
console.log(`Target: ${target}`);
console.log(`Mode: ${prod ? 'production' : 'standard'}`);
if (loadedFromFile) {
  console.log(`Env file: ${path.relative(process.cwd(), envFilePath)}`);
} else {
  warn(`Env file not found at ${path.relative(process.cwd(), envFilePath)}; using process environment only.`);
}

if (target === 'api' || target === 'all') {
  checkKeys(API_REQUIRED, 'api');
}

if (target === 'web' || target === 'all') {
  checkKeys(WEB_REQUIRED, 'web');
}

if (errors.length > 0) {
  console.error(`\n❌ Environment validation failed with ${errors.length} error(s).`);
  process.exit(1);
}

if (warnings.length > 0) {
  console.log(`\n⚠️  Environment validation completed with ${warnings.length} warning(s).`);
}

console.log('\n✅ Environment validation passed.');
