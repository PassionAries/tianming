// @ts-check

function stableById(list, id) {
  var key = String(id == null ? '' : id).trim();
  if (!key || !Array.isArray(list)) return null;
  var matches = list.filter(function (row) {
    return row && row.id != null && String(row.id).trim() === key;
  });
  return matches.length === 1 ? matches[0] : null;
}

function uniqueLegacyName(list, name) {
  var key = String(name == null ? '' : name).trim();
  if (!key || !Array.isArray(list)) return { ok: false, code: 'missing-reference' };
  var matches = list.filter(function (row) {
    return row && row.name != null && String(row.name).trim() === key;
  });
  if (matches.length === 1) return { ok: true, value: matches[0] };
  return { ok: false, code: matches.length ? 'ambiguous-reference' : 'identity-not-found' };
}

export function createLegacyDeps(global) {
  if (!global || typeof global !== 'object') throw new Error('[AIChangeApplier] renderer root missing');
  var tm = global.TM || {};
  var aiChange = tm.AIChange || {};
  return {
    global: global,
    pathUtils: aiChange.PathUtils,
    army: aiChange.Army,
    narrative: aiChange.Narrative,
    world: {
      current: function () { return global.GM; },
      snapshot: function () {
        if (typeof global._tmBuildDetachedPersistenceState === 'function') {
          return global._tmBuildDetachedPersistenceState({ GM: global.GM, P: global.P });
        }
        return null;
      },
      transaction: function (fn) { return fn(global.GM, global.P); }
    },
    identities: {
      characterById: function (id) { return stableById(global.GM && global.GM.chars, id); },
      factionById: function (id) { return stableById(global.GM && global.GM.facs, id); },
      positionById: function (id) {
        return typeof global._offFindPositionById === 'function' ? global._offFindPositionById(id) : null;
      },
      uniqueLegacyCharacterName: function (name) {
        return uniqueLegacyName(global.GM && global.GM.chars, name);
      },
      uniqueLegacyFactionName: function (name) {
        return uniqueLegacyName(global.GM && global.GM.facs, name);
      }
    },
    commands: {
      roster: tm.Roster || null,
      factions: tm.Factions || null,
      office: tm.Office || null,
      ledger: tm.Ledger || null,
      military: aiChange.Army || null,
      regions: tm.Regions || null,
      travel: tm.Travel || null
    },
    diagnostics: tm.errors || global.console,
    events: tm.Events || null,
    uiInvalidation: tm.UIInvalidation || null
  };
}

export function validateDependencies(deps) {
  var failures = [];
  if (!deps || !deps.global) failures.push('global');
  if (!deps || !deps.world || typeof deps.world.current !== 'function') failures.push('world.current');
  if (!deps || !deps.identities || typeof deps.identities.characterById !== 'function') failures.push('identities.characterById');
  if (!deps || !deps.pathUtils || typeof deps.pathUtils.applyPathSet !== 'function') failures.push('TM.AIChange.PathUtils');
  if (!deps || !deps.army || typeof deps.army.applyAIArmyChange !== 'function') failures.push('TM.AIChange.Army');
  if (!deps || !deps.narrative || typeof deps.narrative.mergeUpdatesToEntity !== 'function') failures.push('TM.AIChange.Narrative');
  if (failures.length) {
    var error = new Error('[AIChangeApplier] dependencies unavailable: ' + failures.join(', '));
    error.code = 'ai-change-applier-dependencies-missing';
    error.details = failures;
    throw error;
  }
  return deps;
}
