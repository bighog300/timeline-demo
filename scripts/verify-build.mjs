#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const requiredRoutes = [
  path.join(root, 'apps', 'web', 'app', 'admin', 'ops', 'page.tsx'),
  path.join(root, 'apps', 'web', 'app', 'api', 'meta', 'build', 'route.ts'),
];
const missingRoutes = requiredRoutes.filter((filePath) => !fs.existsSync(filePath));
if (missingRoutes.length > 0) {
  console.error('❌ Build verification failed. Required route source files missing:');
  for (const filePath of missingRoutes) {
    console.error(`- ${path.relative(root, filePath)}`);
  }
  process.exit(1);
}

const webPackageJsonPath = path.join(root, 'apps', 'web', 'package.json');
let webUsesShared = false;

if (fs.existsSync(webPackageJsonPath)) {
  const webPackageJson = JSON.parse(fs.readFileSync(webPackageJsonPath, 'utf8'));
  const dependencySets = [
    webPackageJson.dependencies ?? {},
    webPackageJson.devDependencies ?? {},
    webPackageJson.peerDependencies ?? {},
    webPackageJson.optionalDependencies ?? {},
  ];
  webUsesShared = dependencySets.some((deps) => '@timeline/shared' in deps);
}

const targets = [
  {
    label: 'apps/web build output',
    path: path.join(root, 'apps', 'web', '.next'),
  },
];

if (webUsesShared) {
  targets.push({
    label: 'packages/shared build output',
    path: path.join(root, 'packages', 'shared', 'dist'),
  });
}

const missing = targets.filter((target) => !fs.existsSync(target.path));

if (missing.length > 0) {
  console.error('❌ Build verification failed. Missing output directories:');
  for (const target of missing) {
    console.error(`- ${target.label}: ${path.relative(root, target.path)}`);
  }
  process.exit(1);
}

console.log('✅ Build verification passed. Output directories found.');
