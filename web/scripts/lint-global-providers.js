#!/usr/bin/env node
'use strict';

// AST-level classic-script global provider guard.
// The browser's actual index.html script list is the truth source. The report keeps every
// provider, while the gate rejects only providers that can overwrite one another; guarded
// namespace initializers such as `window.TM = window.TM || {}` remain visible but harmless.

const fs = require('fs');
const path = require('path');
let acorn;
try {
  acorn = require('acorn');
} catch (error) {
  if (error && error.code === 'MODULE_NOT_FOUND' && /["']acorn["']/.test(String(error.message || ''))) {
    console.error('[lint-global-providers] 缺少开发依赖 acorn。\n请先在仓库根目录运行：npm ci --ignore-scripts');
    process.exit(2);
  }
  throw error;
}
const lib = require('./lib-arch-guard');

const INDEX_FILE = path.join(lib.WEB_ROOT, 'index.html');
const ALLOW_FILE = path.join(lib.BASELINE_DIR, 'intentional-global-overrides.json');
const REPORT_FILE = path.join(lib.REPORT_DIR, 'global-providers.json');
const BASE_GLOBAL_ROOTS = new Set(['window', 'globalThis', 'self']);
const UPDATE = process.argv.includes('--update');

function lineAt(text, offset) {
  return text.slice(0, offset).split(/\r?\n/).length;
}

function attrValue(attrs, name) {
  const match = attrs.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(["\\\'])(.*?)\\1', 'i'));
  return match ? match[2] : '';
}

function hasAttr(attrs, name) {
  return new RegExp('(?:^|\\s)' + name + '(?:\\s|=|$)', 'i').test(attrs);
}

function scriptEntries() {
  const html = fs.readFileSync(INDEX_FILE, 'utf8');
  const dataBySrc = new Map(lib.parseIndexScripts(INDEX_FILE).map((row) => [row.src, row.isData]));
  const entries = [];
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  let inlineNo = 0;
  while ((match = scriptRe.exec(html))) {
    const attrs = match[1] || '';
    const type = attrValue(attrs, 'type').toLowerCase();
    if (type && !/^(?:text|application)\/javascript$/.test(type) && type !== 'module') continue;
    const rawSrc = attrValue(attrs, 'src');
    const documentOrder = entries.length;
    if (rawSrc) {
      const src = rawSrc.replace(/^\.\//, '').replace(/[?#].*$/, '');
      if (/^(?:https?:)?\/\//i.test(src) || dataBySrc.get(src) || !/\.js$/i.test(src)) continue;
      const abs = path.join(lib.WEB_ROOT, src);
      entries.push({
        src,
        abs,
        code: fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '',
        exists: fs.existsSync(abs),
        documentOrder,
        deferred: type === 'module' || hasAttr(attrs, 'defer'),
        async: hasAttr(attrs, 'async')
      });
    } else if ((match[2] || '').trim()) {
      inlineNo += 1;
      entries.push({
        src: 'index.html:inline#' + inlineNo,
        abs: INDEX_FILE,
        code: match[2],
        exists: true,
        documentOrder,
        deferred: false,
        async: false,
        inlineLine: lineAt(html, match.index)
      });
    }
  }
  const blocking = entries.filter((entry) => !entry.deferred && !entry.async);
  const deferred = entries.filter((entry) => entry.deferred && !entry.async);
  const asynchronous = entries.filter((entry) => entry.async);
  return blocking.concat(deferred, asynchronous).map((entry, executionOrder) => Object.assign(entry, { executionOrder }));
}

function propertyName(member) {
  if (!member || member.type !== 'MemberExpression') return '';
  if (!member.computed && member.property && member.property.type === 'Identifier') return member.property.name;
  if (member.computed && member.property && member.property.type === 'Literal') return String(member.property.value || '');
  return '';
}

function globalTarget(node, aliases) {
  if (!node || node.type !== 'MemberExpression' || !node.object || node.object.type !== 'Identifier') return null;
  if (!(aliases || BASE_GLOBAL_ROOTS).has(node.object.name)) return null;
  const name = propertyName(node);
  return name ? { root: node.object.name, name } : null;
}

function sameTarget(a, b, aliases) {
  const left = globalTarget(a, aliases);
  const right = globalTarget(b, aliases);
  return !!(left && right && left.name === right.name);
}

function guardedInitializer(left, right, aliases) {
  return !!(right && right.type === 'LogicalExpression'
    && (right.operator === '||' || right.operator === '??')
    && sameTarget(left, right.left, aliases));
}

function bindingNames(pattern, out) {
  out = out || [];
  if (!pattern) return out;
  if (pattern.type === 'Identifier') out.push(pattern.name);
  else if (pattern.type === 'RestElement') bindingNames(pattern.argument, out);
  else if (pattern.type === 'AssignmentPattern') bindingNames(pattern.left, out);
  else if (pattern.type === 'ArrayPattern') pattern.elements.forEach((item) => bindingNames(item, out));
  else if (pattern.type === 'ObjectPattern') pattern.properties.forEach((prop) => bindingNames(prop.value || prop.argument, out));
  return out;
}

function childNodes(node) {
  const out = [];
  Object.keys(node || {}).forEach((key) => {
    if (key === 'parent') return;
    const value = node[key];
    if (Array.isArray(value)) value.forEach((item) => { if (item && typeof item.type === 'string') out.push(item); });
    else if (value && typeof value.type === 'string') out.push(value);
  });
  return out;
}

function mentionsGlobal(node, name, aliases) {
  let found = false;
  (function visit(current) {
    if (!current || found) return;
    if (current.type === 'Identifier' && current.name === name) { found = true; return; }
    const target = globalTarget(current, aliases);
    if (target && target.name === name) { found = true; return; }
    childNodes(current).forEach(visit);
  })(node);
  return found;
}

function guardedUse(node, name, ancestors, aliases) {
  const parent = ancestors[ancestors.length - 1];
  if (parent && parent.type === 'UnaryExpression' && parent.operator === 'typeof') return true;
  if (node.optional || (parent && parent.type === 'ChainExpression')) return true;
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const ancestor = ancestors[i];
    if (ancestor.type === 'IfStatement') {
      if (ancestor.test === node || mentionsGlobal(ancestor.test, name, aliases)) return true;
    }
    if (ancestor.type === 'ConditionalExpression' && mentionsGlobal(ancestor.test, name, aliases)) return true;
    if (ancestor.type === 'LogicalExpression' && mentionsGlobal(ancestor.left, name, aliases)) return true;
  }
  return false;
}

function parseEntry(entry) {
  if (!entry.exists) throw new Error('missing index script: ' + entry.src);
  let ast;
  try {
    ast = acorn.parse(entry.code, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowHashBang: true });
  } catch (error) {
    throw new Error(entry.src + ':' + (error.loc ? error.loc.line : '?') + ' AST parse failed: ' + error.message);
  }
  const providers = [];
  const reads = [];

  function addProvider(name, node, kind, immediate, guarded) {
    if (!name) return;
    providers.push({ name, line: node.loc.start.line, offset: node.start, kind, immediate: !!immediate, guardedInitializer: !!guarded });
  }

  function addRead(name, node, ancestors, aliases) {
    if (!name) return;
    reads.push({ name, line: node.loc.start.line, offset: node.start, guarded: guardedUse(node, name, ancestors, aliases) });
  }

  function argumentIsGlobal(node, aliases) {
    if (!node) return false;
    if (node.type === 'ThisExpression') return true;
    if (node.type === 'Identifier') return aliases.has(node.name);
    if (node.type === 'ConditionalExpression') {
      return argumentIsGlobal(node.consequent, aliases) || argumentIsGlobal(node.alternate, aliases);
    }
    if (node.type === 'LogicalExpression') {
      return argumentIsGlobal(node.left, aliases) || argumentIsGlobal(node.right, aliases);
    }
    return false;
  }

  function functionAliases(fn, inherited, invocationArgs) {
    const next = new Set(inherited);
    const params = fn.params || [];
    params.forEach((param) => bindingNames(param).forEach((name) => next.delete(name)));
    if (invocationArgs) {
      params.forEach((param, index) => {
        const names = bindingNames(param);
        if (names.length === 1 && argumentIsGlobal(invocationArgs[index], inherited)) next.add(names[0]);
      });
    }
    return next;
  }

  function functionLocals(fn, inherited) {
    const names = new Set(inherited || []);
    (fn.params || []).forEach((param) => bindingNames(param).forEach((name) => names.add(name)));
    (function collect(node) {
      if (!node) return;
      if (node !== fn && (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression')) return;
      if (node !== fn && node.type === 'FunctionDeclaration') {
        if (node.id) names.add(node.id.name);
        return;
      }
      if (node.type === 'VariableDeclaration') {
        node.declarations.forEach((declaration) => bindingNames(declaration.id).forEach((name) => names.add(name)));
      } else if (node.type === 'ClassDeclaration' && node.id) {
        names.add(node.id.name);
      } else if (node.type === 'CatchClause') {
        bindingNames(node.param).forEach((name) => names.add(name));
      }
      childNodes(node).forEach(collect);
    })(fn.body);
    return names;
  }

  function walk(node, state, ancestors) {
    if (!node) return;
    ancestors = ancestors || [];
    const nextAncestors = ancestors.concat(node);
    if (node.type === 'Program') {
      node.body.forEach((child) => walk(child, { immediate: true, topLevel: true, aliases: new Set(BASE_GLOBAL_ROOTS), locals: new Set() }, nextAncestors));
      return;
    }
    if (node.type === 'FunctionDeclaration') {
      if (state.topLevel && node.id) addProvider(node.id.name, node, 'top-level-function', true, false);
      const aliases = functionAliases(node, state.aliases, null);
      const locals = functionLocals(node, state.locals);
      locals.forEach((name) => aliases.delete(name));
      node.body.body.forEach((child) => walk(child, { immediate: false, topLevel: false, aliases, locals }, nextAncestors));
      return;
    }
    if (node.type === 'ClassDeclaration') {
      if (state.topLevel && node.id) addProvider(node.id.name, node, 'top-level-class', true, false);
      return;
    }
    if (node.type === 'VariableDeclaration') {
      node.declarations.forEach((declaration) => {
        if (state.topLevel) bindingNames(declaration.id).forEach((name) => addProvider(name, declaration, 'top-level-' + node.kind, true, false));
        if (declaration.init) walk(declaration.init, { immediate: state.immediate, topLevel: false, aliases: state.aliases, locals: state.locals }, nextAncestors);
      });
      return;
    }
    if (node.type === 'AssignmentExpression') {
      const target = globalTarget(node.left, state.aliases);
      if (target) addProvider(target.name, node, target.root + '-assignment', state.immediate, guardedInitializer(node.left, node.right, state.aliases));
      else if (state.topLevel && node.left.type === 'Identifier') addProvider(node.left.name, node, 'top-level-assignment', true, false);
      if (node.left.type === 'MemberExpression' && node.left.computed) walk(node.left.property, state, nextAncestors);
      walk(node.right, { immediate: state.immediate, topLevel: false, aliases: state.aliases, locals: state.locals }, nextAncestors);
      return;
    }
    if (node.type === 'MemberExpression') {
      const target = globalTarget(node, state.aliases);
      if (target && state.immediate) addRead(target.name, node, ancestors, state.aliases);
      if (!target) walk(node.object, { immediate: state.immediate, topLevel: false, aliases: state.aliases, locals: state.locals }, nextAncestors);
      if (node.computed) walk(node.property, { immediate: state.immediate, topLevel: false, aliases: state.aliases, locals: state.locals }, nextAncestors);
      return;
    }
    if (node.type === 'Property' || node.type === 'MethodDefinition' || node.type === 'PropertyDefinition') {
      if (node.computed) walk(node.key, { immediate: state.immediate, topLevel: false, aliases: state.aliases, locals: state.locals }, nextAncestors);
      if (node.value) walk(node.value, { immediate: state.immediate, topLevel: false, aliases: state.aliases, locals: state.locals }, nextAncestors);
      return;
    }
    if (node.type === 'CallExpression') {
      const callee = node.callee;
      if (callee && (callee.type === 'FunctionExpression' || callee.type === 'ArrowFunctionExpression')) {
        const aliases = functionAliases(callee, state.aliases, node.arguments);
        const locals = functionLocals(callee, state.locals);
        locals.forEach((name) => aliases.delete(name));
        (callee.params || []).forEach((param, index) => {
          const names = bindingNames(param);
          if (names.length === 1 && argumentIsGlobal(node.arguments[index], state.aliases)) aliases.add(names[0]);
        });
        if (callee.body.type === 'BlockStatement') {
          callee.body.body.forEach((child) => walk(child, { immediate: state.immediate, topLevel: false, aliases, locals }, nextAncestors));
        } else {
          walk(callee.body, { immediate: state.immediate, topLevel: false, aliases, locals }, nextAncestors);
        }
      } else {
        walk(callee, { immediate: state.immediate, topLevel: false, aliases: state.aliases, locals: state.locals }, nextAncestors);
      }
      node.arguments.forEach((arg) => walk(arg, { immediate: state.immediate, topLevel: false, aliases: state.aliases, locals: state.locals }, nextAncestors));
      return;
    }
    if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      const aliases = functionAliases(node, state.aliases, null);
      const locals = functionLocals(node, state.locals);
      locals.forEach((name) => aliases.delete(name));
      if (node.body.type === 'BlockStatement') node.body.body.forEach((child) => walk(child, { immediate: false, topLevel: false, aliases, locals }, nextAncestors));
      else walk(node.body, { immediate: false, topLevel: false, aliases, locals }, nextAncestors);
      return;
    }
    if (node.type === 'Identifier' && state.immediate && !state.aliases.has(node.name) && !state.locals.has(node.name)) {
      addRead(node.name, node, ancestors, state.aliases);
      return;
    }
    childNodes(node).forEach((child) => walk(child, { immediate: state.immediate, topLevel: false, aliases: state.aliases, locals: state.locals }, nextAncestors));
  }

  walk(ast, { immediate: true, topLevel: true, aliases: new Set(BASE_GLOBAL_ROOTS), locals: new Set() }, []);
  return { providers, reads };
}

if (process.argv.includes('--self-test')) {
  const fixture = parseEntry({
    src: 'fixture.js',
    code: 'function Boot() {}\nvar State = {};\nwindow.Explicit = {};\n(function (root) { root.FromAlias = {}; root.Explicit.run(); })(window);\nfunction ordinary(root) { root.NotGlobal = {}; }',
    exists: true
  });
  const names = fixture.providers.map((row) => row.name);
  if (!['Boot', 'State', 'Explicit', 'FromAlias'].every((name) => names.includes(name))) {
    throw new Error('self-test failed to collect classic/global providers');
  }
  if (names.includes('NotGlobal')) throw new Error('self-test misclassified an ordinary root parameter');
  const read = fixture.reads.find((row) => row.name === 'Explicit');
  if (!read || read.guarded) throw new Error('self-test failed to collect an unguarded immediate dependency');
  const guarded = parseEntry({ src: 'guarded.js', code: 'if (window.Later) window.Later.run();', exists: true });
  if (!guarded.reads.length || guarded.reads.some((row) => !row.guarded)) {
    throw new Error('self-test failed guarded dependency classification');
  }
  console.log('[lint-global-providers] SELF-TEST PASS');
  process.exit(0);
}

function uniqueSources(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    if (seen.has(row.src)) return false;
    seen.add(row.src);
    return true;
  }).map((row) => row.src);
}

function validAllowance(entry) {
  return !!(entry && typeof entry.owner === 'string' && entry.owner.trim()
    && typeof entry.reason === 'string' && entry.reason.trim()
    && Array.isArray(entry.expectedOrder) && entry.expectedOrder.length > 1);
}

const entries = scriptEntries();
if (entries.some((entry) => entry.async)) {
  console.error('[lint-global-providers] async classic scripts have nondeterministic provider order');
  process.exit(1);
}

const definitions = [];
const immediateReads = [];
for (const entry of entries) {
  const scan = parseEntry(entry);
  scan.providers.forEach((provider) => definitions.push(Object.assign({ src: entry.src, documentOrder: entry.documentOrder, executionOrder: entry.executionOrder }, provider)));
  scan.reads.forEach((read) => immediateReads.push(Object.assign({ src: entry.src, documentOrder: entry.documentOrder, executionOrder: entry.executionOrder }, read)));
}

const byName = new Map();
definitions.forEach((row) => {
  if (!byName.has(row.name)) byName.set(row.name, []);
  byName.get(row.name).push(row);
});
const collisions = [];
for (const [name, rows] of byName) {
  const effectiveSources = uniqueSources(rows.filter((row) => !row.guardedInitializer));
  if (effectiveSources.length > 1) collisions.push({ name, sources: effectiveSources, definitions: rows });
}
collisions.sort((a, b) => a.name.localeCompare(b.name));

const earlyReads = [];
for (const read of immediateReads) {
  if (read.guarded || !byName.has(read.name)) continue;
  const providers = byName.get(read.name).filter((row) => row.immediate);
  const available = providers.some((provider) => provider.executionOrder < read.executionOrder
    || (provider.executionOrder === read.executionOrder
      && (provider.kind.startsWith('top-level-') || provider.offset <= read.offset)));
  if (!available) earlyReads.push(read);
}

const report = {
  generatedAt: new Date().toISOString(),
  entry: 'index.html',
  scriptCount: entries.length,
  providerNameCount: byName.size,
  definitions: [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, rows]) => ({ name, count: rows.length, definitions: rows })),
  collisions,
  earlyReads
};
lib.saveJSON(REPORT_FILE, report);

if (UPDATE) {
  const nextAllow = { version: 1, overrides: {}, earlyReads: {} };
  collisions.forEach((collision) => {
    nextAllow.overrides[collision.name] = {
      owner: collision.sources[0],
      reason: 'Pre-existing classic-script provider chain retained as an explicit load-order contract; later providers intentionally extend or replace the compatibility surface.',
      expectedOrder: collision.sources
    };
  });
  earlyReads.forEach((read) => {
    nextAllow.earlyReads[read.name + '@' + read.src] = {
      owner: read.src,
      reason: 'Pre-existing immediate guarded-by-runtime startup dependency retained pending explicit dependency injection.'
    };
  });
  lib.saveJSON(ALLOW_FILE, nextAllow);
  console.log('[lint-global-providers] baseline updated: ' + lib.rel(ALLOW_FILE));
  process.exit(0);
}

const allow = lib.loadJSON(ALLOW_FILE, { overrides: {}, earlyReads: {} });
const overrides = allow.overrides || {};
const earlyAllow = allow.earlyReads || {};
let failed = false;
const activeOverrides = new Set();
for (const collision of collisions) {
  const approval = overrides[collision.name];
  activeOverrides.add(collision.name);
  if (!validAllowance(approval)) {
    failed = true;
    console.error('[lint-global-providers] unapproved duplicate provider: ' + collision.name + ' => ' + collision.sources.join(' -> '));
    continue;
  }
  if (JSON.stringify(approval.expectedOrder) !== JSON.stringify(collision.sources)) {
    failed = true;
    console.error('[lint-global-providers] override order drift: ' + collision.name);
    console.error('  expected: ' + approval.expectedOrder.join(' -> '));
    console.error('  actual:   ' + collision.sources.join(' -> '));
  }
}
Object.keys(overrides).forEach((name) => {
  if (!activeOverrides.has(name)) {
    failed = true;
    console.error('[lint-global-providers] stale override approval: ' + name);
  }
});

const activeEarly = new Set();
for (const read of earlyReads) {
  const key = read.name + '@' + read.src;
  activeEarly.add(key);
  const approval = earlyAllow[key];
  if (!approval || typeof approval.owner !== 'string' || !approval.owner || typeof approval.reason !== 'string' || !approval.reason) {
    failed = true;
    console.error('[lint-global-providers] immediate read before provider: ' + key + ':' + read.line);
  }
}
Object.keys(earlyAllow).forEach((key) => {
  if (!activeEarly.has(key)) {
    failed = true;
    console.error('[lint-global-providers] stale early-read approval: ' + key);
  }
});

console.log('[lint-global-providers] scripts=' + entries.length + ' globals=' + byName.size
  + ' collisions=' + collisions.length + ' earlyReads=' + earlyReads.length);
console.log('[lint-global-providers] report=' + lib.rel(REPORT_FILE));
if (failed) process.exit(1);
console.log('[lint-global-providers] PASS');
