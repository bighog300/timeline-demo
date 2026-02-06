#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const targets = [
  {
    label: 'apps/web build output',
    path: path.join(root, 'apps', 'web', '.next'),
  },
  {
    label: 'packages/shared build output',
    path: path.join(root, 'packages', 'shared', 'dist'),
  },
];

const missing = targets.filter((target) => !fs.existsSync(target.path));

if (missing.length > 0) {
  console.error('❌ Build verification failed. Missing output directories:');
  for (const target of missing) {
    console.error(`- ${target.label}: ${path.relative(root, target.path)}`);
  }
  process.exit(1);
}

console.log('✅ Build verification passed. Output directories found.');
