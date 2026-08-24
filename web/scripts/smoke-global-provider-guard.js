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
console.log('[smoke-global-provider-guard] PASS — AST providers, root alias scope, and immediate dependency guards');
