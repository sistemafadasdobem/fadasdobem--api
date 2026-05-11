'use strict';

const path = require('path');

/** Raiz do pacote `fadasdobem--api` (onde vivem `src/`, `package.json`). */
const apiRoot = path.join(__dirname, '..', '..');

module.exports = {
  rootDir: apiRoot,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/scripts/smoke-tests/**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/scripts/smoke-tests/setup.afterEnv.js'],
  maxWorkers: 1,
  testTimeout: 120000,
  verbose: true,
};
