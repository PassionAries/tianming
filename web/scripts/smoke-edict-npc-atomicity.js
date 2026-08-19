#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const edictSource = fs.readFileSync(path.join(ROOT, 'tm-endturn-edict.js'), 'utf8');
const followupSource = fs.readFileSync(path.join(ROOT, 'tm-endturn-followup.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(ROOT, 'tm-endturn-pipeline-steps.js'), 'utf8');
let assertions = 0;

function check(value, label) {
  if (!value) throw new Error('[smoke-edict-npc-atomicity] ' + label);
  assertions += 1;
}
function snapshot(value) { return JSON.stringify(value); }

const ctx = {
  console,
  Math, Date, JSON, Object, Array, Number, String, Boolean, Promise,
  parseInt, parseFloat, isFinite, isNaN,
  deepClone(value) { return JSON.parse(JSON.stringify(value)); },
  clamp(value, min, max) { return Math.max(min, Math.min(max, value)); },
  GM: {
    turn: 9,
    marker: 'clean',
    chars: [{ name: '甲', loyalty: 50, officialTitle: '', position: '', careerHistory: [] }],
    officeTree: [{ name: '中枢', positions: [{ name: '尚书', holder: '' }] }],
    armies: [],
    evtLog: [],
    _turnAiResults: { subcall15: { immutable: true } }
  },
  P: { marker: 'template', playerInfo: { characterName: '天子', factionName: '朝廷' } },
  addEB(type, text) { ctx.GM.evtLog.push({ type, text }); },
  findCharByName(name) { return ctx.GM.chars.find((char) => char.name === name) || null; },
  TM: {
    errors: { capture() {} },
    AIChange: {
      Army: {
        applyAIArmyChange(change) {
          ctx.GM.armies.push({ name: change.name });
          ctx.P.marker = 'partial-army';
          throw new Error('forced-army-create-failure');
        }
      }
    },
    Endturn: { AI: { followup: {} } }
  }
};
ctx.window = ctx;
ctx.global = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(edictSource, ctx, { filename: 'tm-endturn-edict.js' });

const beforeGM = snapshot(ctx.GM);
const beforeP = snapshot(ctx.P);
let edictError = null;
try {
  ctx.applyEdictActions({
    appointments: [{ character: '甲', position: '尚书' }],
    armyBuilds: [{ name: '新军', strength: 1000 }]
  });
} catch (error) { edictError = error; }
check(edictError && /forced-army-create-failure/.test(edictError.message), 'a later edict action failure is surfaced');
check(snapshot(ctx.GM) === beforeGM && snapshot(ctx.P) === beforeP,
  'appointment, event log, army and template writes all roll back when the edict batch fails');

ctx.TM.AIChange.Army.applyAIArmyChange = function(change) {
  const army = { name: change.name };
  ctx.GM.armies.push(army);
  return { ok: true, army };
};
const success = ctx.applyEdictActions({
  appointments: [{ character: '甲', position: '尚书' }],
  armyBuilds: [{ name: '新军', strength: 1000 }]
});
check(success && success.ok && ctx.GM.officeTree[0].positions[0].holder === '甲' && ctx.GM.armies.length === 1,
  'a fully valid edict batch commits all actions together');

vm.runInContext(followupSource, ctx, { filename: 'tm-endturn-followup.js' });
const atomicApply = ctx.TM.Endturn.AI.followup._applyNpcDeepResultAtomic;
check(typeof atomicApply === 'function', 'NPC deep-result atomic helper is exported for the shared sc15/sc15n path');

ctx.GM = {
  turn: 10,
  chars: [{ name: '乙', loyalty: 60, nested: { mood: '平' } }],
  relations: { '乙/丙': 5 },
  _turnAiResults: { subcall15: { parsed: 'immutable-result' } }
};
ctx.P = { marker: 'npc-template' };
const npcBeforeGM = snapshot(ctx.GM);
const npcBeforeP = snapshot(ctx.P);
const charRef = ctx.GM.chars[0];
let applyCalls = 0;
const npcOutcome = atomicApply(function() {
  applyCalls += 1;
  ctx.GM.chars[0].loyalty = 1;
  ctx.GM.chars[0].nested.mood = '怒';
  ctx.GM.relations['乙/丙'] = -100;
  ctx.P.marker = 'partial-npc';
  throw new Error('forced-npc-apply-failure');
}, { mood_shifts: [] });
check(!npcOutcome.ok && applyCalls === 1, 'NPC apply failure is returned without a second model/application attempt');
check(snapshot(ctx.GM) === npcBeforeGM && snapshot(ctx.P) === npcBeforeP,
  'NPC mood, relationship, parsed result and P state return to the pre-apply snapshot');
check(ctx.GM.chars[0] === charRef, 'recursive rollback preserves existing nested object identity for concurrent readers');

const postStart = pipelineSource.indexOf("name: 'post-ai-edict'");
const postEnd = pipelineSource.indexOf("name: 'systems'", postStart);
const postSlice = pipelineSource.slice(postStart, postEnd);
check(postStart >= 0 && postEnd > postStart && /onError:\s*'abort'/.test(postSlice) && !/catch\s*\(/.test(postSlice),
  'post-ai-edict no longer converts state-mutating failures into a successful pipeline step');

console.log('[smoke-edict-npc-atomicity] PASS assertions=' + assertions);
