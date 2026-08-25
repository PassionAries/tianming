#!/usr/bin/env node
'use strict';

const cp = require('child_process');
const path = require('path');

const guard = path.join(__dirname, 'lint-global-providers.js');
const result = cp.spawnSync(process.execPath, [guard, '--self-test'], { encoding: 'utf8', windowsHide: true });
if (result.status !== 0 || !String(result.stdout).includes('SELF-TEST PASS')) {
  console.error(result.stdout || '');
  console.error(result.stderr || '');
  process.exit(1);
}

const missingAcornProbe = [
  "const Module = require('module');",
  'const originalLoad = Module._load;',
  "Module._load = function(request) { if (request === 'acorn') { const error = new Error(\"Cannot find module 'acorn'\"); error.code = 'MODULE_NOT_FOUND'; throw error; } return originalLoad.apply(this, arguments); };",
  'process.argv = [' + JSON.stringify(process.execPath) + ', ' + JSON.stringify(guard) + ', "--self-test"];',
  'require(' + JSON.stringify(guard) + ');'
].join('\n');
const missing = cp.spawnSync(process.execPath, ['-e', missingAcornProbe], { encoding: 'utf8', windowsHide: true });
const missingOutput = String(missing.stdout || '') + String(missing.stderr || '');
if (missing.status !== 2 || !/acorn/.test(missingOutput) || !/npm ci --ignore-scripts/.test(missingOutput)) {
  console.error('[smoke-global-provider-guard] missing-acorn diagnosis did not expose the required recovery command');
  console.error(missingOutput);
  process.exit(1);
}

console.log('[smoke-global-provider-guard] PASS — AST providers, root alias scope, dependency guards, and missing-acorn diagnosis');
