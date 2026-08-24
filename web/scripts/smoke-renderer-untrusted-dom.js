#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const electronSource = fs.readFileSync(path.join(ROOT, 'tm-electron.js'), 'utf8');
const infraSource = fs.readFileSync(path.join(ROOT, 'tm-ai-infra.js'), 'utf8');
const startSource = fs.readFileSync(path.join(ROOT, 'tm-patches-start.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const attacks = [
  '\"><img src=x onerror=window.__xss=1>',
  '\"><svg onload=window.__xss=1>',
  '\" autofocus onfocus=\"window.__xss=1',
  '</span><script>window.__xss=1</script>',
  '正常名称 & < > \" \' '
];

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error('[smoke-renderer-untrusted-dom] ' + message);
  passed++;
}

function makeDom() {
  const byId = Object.create(null);
  const tags = [];
  let htmlWrites = 0;
  function node(tag) {
    let id = '';
    let ownText = '';
    const value = {
      nodeType: 1,
      tagName: String(tag || 'div').toUpperCase(),
      children: [], style: {}, dataset: {}, listeners: Object.create(null), className: '', value: '', title: '',
      appendChild(child) { this.children.push(child); if (child && typeof child === 'object') child.parentNode = this; return child; },
      replaceChildren(...children) { this.children = []; children.forEach((child) => this.appendChild(child)); },
      addEventListener(type, fn) { if (!this.listeners[type]) this.listeners[type] = []; this.listeners[type].push(fn); },
      setAttribute(name, attrValue) { this[name] = String(attrValue); },
      click() { (this.listeners.click || []).forEach((fn) => fn({ currentTarget: this, target: this })); }
    };
    Object.defineProperty(value, 'id', { get() { return id; }, set(next) { id = String(next || ''); if (id) byId[id] = value; } });
    Object.defineProperty(value, 'textContent', {
      get() { return ownText + value.children.map((child) => child && child.textContent || '').join(''); },
      set(next) { ownText = String(next == null ? '' : next); if (ownText === '') value.children = []; }
    });
    Object.defineProperty(value, 'innerHTML', { get() { return ''; }, set() { htmlWrites++; } });
    tags.push(value.tagName);
    return value;
  }
  byId['main-view'] = node('main');
  byId.launch = node('section');
  byId['t-era-list'] = node('div');
  return {
    byId, tags, node,
    document: {
      createElement: node,
      createTextNode(text) { const value = node('#text'); value.nodeType = 3; value.textContent = text; return value; },
      getElementById(id) { return byId[id] || null; },
      querySelector() { return null; },
      addEventListener() {}
    },
    htmlWrites() { return htmlWrites; }
  };
}

function collect(root, predicate, out = []) {
  if (!root) return out;
  if (predicate(root)) out.push(root);
  (root.children || []).forEach((child) => collect(child, predicate, out));
  return out;
}

async function main() {
  const dom = makeDom();
  const project = { id: 'proj-\"-<id>', name: attacks[0], title: attacks[1], era: '测试', role: '帝' };
  const imported = { id: 'file-\"-id', name: attacks[2], title: attacks[3], modifiedStr: attacks[4], source: 'user' };
  let selectedProject = null;
  let managedName = null;
  const ctx = {
    console, Date, Math, Number, String, JSON, Promise, setTimeout, clearTimeout,
    fetch: async () => ({ ok: false }), confirm: () => true,
    document: dom.document,
    P: { scenarios: [project], conf: {}, _indices: {} }, GM: {},
    _$: (id) => dom.byId[id] || null, _dbg() {}, toast() {}, buildIndices() {},
    findScenarioById(id) { return ctx.P.scenarios.find((row) => row.id === id); },
    startGame() {}
  };
  ctx.window = ctx;
  ctx.tianming = {
    isDesktop: true,
    listScenarios: async () => ({ success: true, files: [imported] }),
    loadScenario: async () => ({ success: false }), saveScenario: async () => ({ success: true }), deleteScenario: async () => ({ success: true })
  };
  vm.createContext(ctx);
  vm.runInContext(electronSource, ctx, { filename: 'tm-electron.js' });
  const originalStartProject = ctx.desktopStartProjectScn;
  ctx.desktopStartProjectScn = (id) => { selectedProject = id; };
  await ctx.showScnSelect();
  const selectionRoot = dom.byId['main-view'].children[0];
  const projectRows = collect(selectionRoot, (row) => row.dataset && row.dataset.scenarioId === project.id);
  assert(projectRows.length === 1, 'scenario ID containing quotes is preserved in dataset');
  assert(projectRows[0].textContent.includes(attacks[0]), 'malicious scenario name is visible as text');
  collect(projectRows[0], (row) => row.tagName === 'BUTTON')[0].click();
  assert(selectedProject === project.id, 'scenario selection passes the exact quoted ID through a closure');

  ctx.desktopEnterScn = (name) => { managedName = name; };
  await ctx.showScnManage();
  const manageRoot = dom.byId['main-view'].children[0];
  assert(manageRoot.textContent.includes(attacks[2]) && manageRoot.textContent.includes(attacks[4]), 'imported scenario metadata is visible as text');
  collect(manageRoot, (row) => row.tagName === 'BUTTON' && row.textContent === '编辑')[0].click();
  assert(managedName === imported.name, 'scenario manager passes the exact malicious name through a closure');

  ctx.desktopStartProjectScn = originalStartProject;
  originalStartProject(project.id);
  assert(dom.byId['start-save-name'].value.indexOf(attacks[0]) === 0, 'default save name is assigned through input.value without truncation');
  assert(dom.htmlWrites() === 0, 'scenario startup and management never write innerHTML');
  assert(!dom.tags.includes('IMG') && !dom.tags.includes('SVG') && !dom.tags.includes('SCRIPT'), 'metadata cannot create active DOM tags');
  assert(ctx.__xss === undefined, 'scenario metadata does not execute script');

  const eraStart = infraSource.indexOf('function renderEraNamesList(){');
  const eraEnd = infraSource.indexOf('\nfunction saveT(){', eraStart);
  const eraCtx = { document: dom.document, P: { time: { year: 1, eraNames: attacks.map((name, index) => ({ name, startYear: index, startMonth: 1, startDay: 1 })) } }, _$: (id) => dom.byId[id], window: null, Number, String };
  eraCtx.window = eraCtx;
  vm.runInNewContext(infraSource.slice(eraStart, eraEnd), eraCtx, { filename: 'tm-ai-infra-era-editor.js' });
  eraCtx.renderEraNamesList();
  attacks.forEach((attack, index) => assert(dom.byId['t-era-n-' + index].value === attack, 'era name ' + index + ' is preserved only in input.value'));
  assert(dom.htmlWrites() === 0 && eraCtx.__xss === undefined, 'era editor does not execute or parse malicious attributes');

  const timeStart = infraSource.indexOf('function _tmTimeDisplayParts(turn){');
  const timeEnd = infraSource.indexOf('\nfunction getSE(', timeStart);
  const timeDom = makeDom();
  const timeCtx = {
    document: timeDom.document,
    P: { time: { display: 'reign', reign: attacks[1], prefix: attacks[2], suffix: attacks[3] } },
    calcDateFromTurn() { return { eraInfo: { era: attacks[0], ryStr: attacks[4] }, reignYear: 1, adYear: 1, solarMonth: 1, solarDay: 1, lunarMonth: 1, lunarDay: 1, season: attacks[2], gzDayStr: attacks[3], gzYearStr: attacks[4] }; },
    lunarMonthName() { return attacks[1]; }, lunarDayName() { return attacks[0]; }, toChineseReignYear() { return '元年'; },
    String, Math
  };
  vm.runInNewContext(infraSource.slice(timeStart, timeEnd), timeCtx, { filename: 'tm-ai-infra-time-display.js' });
  const timeNode = timeCtx.createTSElement(1);
  assert(timeNode.textContent.includes(attacks[0]) && timeNode.title.includes(attacks[0]), 'time metadata remains literal text and title data');
  const compatibilityHtml = timeCtx.getTS(1);
  assert(!compatibilityHtml.includes('<img') && !compatibilityHtml.includes('<svg') && !compatibilityHtml.includes('<script'), 'legacy time HTML context-encodes active markup');
  assert(timeCtx.__xss === undefined && timeDom.htmlWrites() === 0, 'time display creates no executable markup');

  const ceremonyStart = startSource.indexOf('function _tmShowOpeningCeremony(');
  const ceremonyEnd = startSource.indexOf('\nfunction ', ceremonyStart + 20);
  const ceremonySource = startSource.slice(ceremonyStart, ceremonyEnd);
  assert(ceremonyStart >= 0 && !/\.innerHTML\s*=|insertAdjacentHTML|setAttribute\s*\(\s*['\"]on/i.test(ceremonySource), 'opening ceremony builder has no dynamic HTML or event-attribute sink');
  assert(!/\.innerHTML\s*=\s*[^;]*sc\.opening/.test(startSource), 'opening prose is not assigned to innerHTML');

  const csp = (indexSource.match(/Content-Security-Policy[^>]+/i) || [''])[0];
  const inlineHandlers = (indexSource.match(/\son(?:click|change|input|load|error|mousedown|keydown)\s*=/gi) || []).length;
  const inlineScripts = (indexSource.match(/<script(?![^>]*\bsrc=)[^>]*>/gi) || []).length;
  assert(/object-src 'none'/.test(csp) && /base-uri 'none'/.test(csp), 'CSP keeps object and base restrictions');
  assert(inlineHandlers > 0 || inlineScripts > 0, 'unsafe-inline remains a measured legacy dependency rather than being removed deceptively');

  console.log('[smoke-renderer-untrusted-dom] pass assertions=' + passed + ' inlineHandlers=' + inlineHandlers + ' inlineScripts=' + inlineScripts);
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
