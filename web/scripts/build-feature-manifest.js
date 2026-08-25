#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB_ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(WEB_ROOT, 'feature-manifest.js');

function loadFeatureManifest() {
  let captured = null;
  const root = {
    TM: {
      Features: {
        registerManifest(manifest) {
          if (captured) throw new Error('feature manifest registered more than once');
          captured = manifest;
        }
      }
    }
  };
  root.window = root;
  root.globalThis = root;
  vm.runInNewContext(fs.readFileSync(SOURCE, 'utf8'), root, { filename: SOURCE });
  if (!captured) throw new Error('feature-manifest.js did not register a manifest');
  return captured;
}

function scriptPath(src) {
  return String(src || '').replace(/[?#].*$/, '').replace(/^\.\//, '');
}

function validateFeatureManifest(manifest) {
  const errors = [];
  if (!manifest || manifest.version !== 1) errors.push('manifest.version must equal 1');
  const features = manifest && manifest.features;
  if (!features || typeof features !== 'object' || Array.isArray(features)) errors.push('manifest.features must be an object');
  const seenScripts = new Map();
  Object.entries(features || {}).forEach(([name, feature]) => {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) errors.push(`invalid feature name: ${name}`);
    if (!Array.isArray(feature.scripts) || !feature.scripts.length) errors.push(`${name}: scripts must be non-empty`);
    if (!Array.isArray(feature.dependsOn)) errors.push(`${name}: dependsOn must be an array`);
    if (!Array.isArray(feature.provides) || !feature.provides.length) errors.push(`${name}: provides must be non-empty`);
    if (!feature.platform) errors.push(`${name}: platform is required`);
    if (!feature.loadPolicy) errors.push(`${name}: loadPolicy is required`);
    if (!feature.sideEffects) errors.push(`${name}: sideEffects is required`);
    (feature.scripts || []).forEach((src) => {
      const clean = scriptPath(src);
      if (!clean || path.isAbsolute(clean) || clean.includes('..')) errors.push(`${name}: unsafe script path ${src}`);
      if (!fs.existsSync(path.join(WEB_ROOT, clean))) errors.push(`${name}: missing script ${clean}`);
      if (seenScripts.has(clean)) errors.push(`${clean}: owned by both ${seenScripts.get(clean)} and ${name}`);
      seenScripts.set(clean, name);
    });
  });
  Object.entries(features || {}).forEach(([name, feature]) => {
    (feature.dependsOn || []).forEach((dependency) => {
      if (!Object.prototype.hasOwnProperty.call(features, dependency)) errors.push(`${name}: unknown dependency ${dependency}`);
      if (dependency === name) errors.push(`${name}: feature cannot depend on itself`);
    });
  });
  if (errors.length) throw new Error('feature manifest invalid:\n- ' + errors.join('\n- '));
  return { featureCount: Object.keys(features).length, scriptCount: seenScripts.size };
}

if (require.main === module) {
  const manifest = loadFeatureManifest();
  const result = validateFeatureManifest(manifest);
  if (process.argv.includes('--print')) {
    const serializable = JSON.parse(JSON.stringify(manifest, (key, value) => typeof value === 'function' ? '[lifecycle]' : value));
    process.stdout.write(JSON.stringify(serializable, null, 2) + '\n');
  }
  console.log(`[feature-manifest] PASS features=${result.featureCount} scripts=${result.scriptCount}`);
}

module.exports = { loadFeatureManifest, validateFeatureManifest, scriptPath };
