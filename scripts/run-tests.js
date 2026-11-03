#!/usr/bin/env node

/**
 * Cross-platform test runner that works on Node 18-24.
 *
 * Problem: the quoted glob form and directory form for node --test
 * have inconsistent behavior across Node versions.
 *
 * Solution: explicitly list test files using fs and spawn --test with the files.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const TEST_DIR = 'test';
const TEST_PATTERN = '.test.js';

function findTestFiles(dir) {
  const files = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(TEST_PATTERN)) {
      files.push(path.join(dir, entry.name));
    }
  }

  return files.sort();
}

const testFiles = findTestFiles(TEST_DIR);

if (testFiles.length === 0) {
  console.log(`No test files found in ${TEST_DIR}/`);
  process.exit(0);
}

console.log('Running tests:');
testFiles.forEach(f => console.log(`  - ${f}`));
console.log();

// Spawn node --test with the explicit file list
const child = spawn(process.execPath, ['--test', ...testFiles], {
  stdio: 'inherit',
  shell: false
});

child.on('error', (err) => {
  console.error(`Failed to start test runner: ${err.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  process.exit(code === null ? (signal ? 1 : 0) : code);
});