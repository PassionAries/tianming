#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const WEB = path.resolve(__dirname, '..');
const entry = path.join(WEB, 'modules', 'ai-change-applier', 'index.js');
const outfile = path.join(WEB, 'generated', 'tm-ai-change-applier.bundle.js');
const checking = process.argv.includes('--check');

async function buildText() {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['chrome100'],
    charset: 'utf8',
    legalComments: 'none',
    sourcemap: false,
    minify: false,
    banner: { js: '// GENERATED FILE — run: npm run build:renderer-modules\n' }
  });
  if (!result.outputFiles || result.outputFiles.length !== 1) throw new Error('renderer module build produced no single bundle');
  return result.outputFiles[0].text.replace(/\r\n?/g, '\n');
}

buildText().then(function (text) {
  if (checking) {
    const current = fs.existsSync(outfile) ? fs.readFileSync(outfile, 'utf8').replace(/\r\n?/g, '\n') : '';
    if (current !== text) {
      console.error('[renderer-modules] FAIL generated bundle is stale: ' + path.relative(WEB, outfile));
      process.exit(1);
    }
    console.log('[renderer-modules] PASS bundle is reproducible bytes=' + Buffer.byteLength(text));
    return;
  }
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  fs.writeFileSync(outfile, text, 'utf8');
  console.log('[renderer-modules] WROTE ' + path.relative(WEB, outfile) + ' bytes=' + Buffer.byteLength(text));
}).catch(function (error) {
  console.error('[renderer-modules] FAIL', error && error.stack || error);
  process.exit(1);
});
