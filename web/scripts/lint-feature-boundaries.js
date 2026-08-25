#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./lib-arch-guard');
const featureBuild = require('./build-feature-manifest');

const INDEX = path.join(lib.WEB_ROOT, 'index.html');
const STARTUP = path.join(lib.WEB_ROOT, 'startup-script-phases.json');
const EAGER_REMOVALS = [
  'tm-test-harness.js',
  'tm-update-card.js',
  'tm-desktop-update.js',
  'tm-online-update.js',
  'tm-map-label-geo.js',
  'tm-map-label-collide.js'
];

const failures = [];
function assert(condition, message) { if (!condition) failures.push(message); }

const manifest = featureBuild.loadFeatureManifest();
const featureResult = featureBuild.validateFeatureManifest(manifest);
const eager = lib.parseIndexScripts(INDEX).filter((row) => /\.js$/i.test(row.src || '')).map((row) => row.src);
assert(eager.filter((src) => src === 'tm-feature-loader.js').length === 1, 'index.html must eagerly load exactly one tm-feature-loader.js');
EAGER_REMOVALS.forEach((src) => assert(!eager.includes(src), `${src} must not remain in the eager startup chain`));

const declaredScripts = Object.values(manifest.features).flatMap((feature) => feature.scripts.map(featureBuild.scriptPath));
EAGER_REMOVALS.forEach((src) => assert(declaredScripts.includes(src), `${src} must be owned by a declared feature`));
assert(featureResult.scriptCount === EAGER_REMOVALS.length, 'first feature cohort must own exactly six deferred scripts');

const loaderSource = fs.readFileSync(path.join(lib.WEB_ROOT, 'tm-feature-loader.js'), 'utf8');
assert(!/(?:\beval\s*\(|new\s+Function\s*\()/.test(loaderSource), 'feature loader must not execute strings');
assert(!/TM\.__[A-Za-z0-9]+Parts/.test(loaderSource), 'feature loader must not introduce a parts bucket');

const desktopSource = fs.readFileSync(path.join(lib.WEB_ROOT, 'tm-desktop-update.js'), 'utf8');
assert(/function\s+init\s*\(/.test(desktopSource) && /function\s+dispose\s*\(/.test(desktopSource), 'desktop update must expose an explicit lifecycle');
assert(!/addEventListener\(\s*['"]load['"]\s*,\s*(?:arm|init)/.test(desktopSource), 'desktop update must not self-initialize at module load');

const onlineSource = fs.readFileSync(path.join(lib.WEB_ROOT, 'tm-online-update.js'), 'utf8');
assert(/function\s+init\s*\(/.test(onlineSource) && /function\s+dispose\s*\(/.test(onlineSource), 'online update must expose an explicit lifecycle');
assert(!/addEventListener\(\s*['"]DOMContentLoaded['"]\s*,\s*(?:arm|init)/.test(onlineSource), 'online update must not self-initialize at module load');

const mapSource = fs.readFileSync(path.join(lib.WEB_ROOT, 'phase8-formal-map.js'), 'utf8');
assert(!/var\s+_TMGeo\s*=/.test(mapSource), 'formal map must not capture the optional geometry provider at module load');
assert(/TM\.Features\.ensure\(['"]formalMapLabels['"]\)/.test(mapSource), 'formal map must request its label feature at first render');
assert(/invalidateMapLabelGeometryCaches/.test(mapSource), 'formal map must invalidate fallback geometry caches after late load');

if (fs.existsSync(STARTUP)) {
  const startup = JSON.parse(fs.readFileSync(STARTUP, 'utf8'));
  assert(startup.version === 2, 'startup manifest must use schema version 2');
  assert(startup.deferredChangesApproved >= 6, 'startup manifest must record at least six approved deferred scripts');
  assert(Array.isArray(startup.features) && startup.features.length >= 4, 'startup manifest must include explicit feature definitions');
}

if (failures.length) {
  failures.forEach((failure) => console.error('[lint-feature-boundaries] ' + failure));
  process.exit(1);
}
console.log(`[lint-feature-boundaries] PASS eager=${eager.length} features=${featureResult.featureCount} deferredScripts=${featureResult.scriptCount}`);
