// @ts-check

function snapshotProperty(target, key) {
  return { target: target, key: key, descriptor: Object.getOwnPropertyDescriptor(target, key) };
}

function publishProperty(target, key, value) {
  target[key] = value;
  if (target[key] !== value) throw new Error('[AIChangeApplier] legacy export was not installed: ' + key);
}

function restoreProperties(snapshots) {
  var failures = [];
  for (var index = snapshots.length - 1; index >= 0; index -= 1) {
    var row = snapshots[index];
    try {
      if (row.descriptor) Object.defineProperty(row.target, row.key, row.descriptor);
      else if (!delete row.target[row.key] && Object.prototype.hasOwnProperty.call(row.target, row.key)) {
        throw new Error('property could not be deleted');
      }
    } catch (error) {
      failures.push({ key: row.key, error: String(error && (error.message || error) || 'rollback failed') });
    }
  }
  return failures;
}

export function installLegacyFacade(global, build, createDeps) {
  var aiNamespace = global && global.TM && global.TM.AIChange;
  var existing = aiNamespace && aiNamespace.ApplierModule;
  if (existing && existing.initialized === true) return existing.facade;
  if (global.AIChangeApplier) {
    var conflict = new Error('[AIChangeApplier] refusing to overwrite an existing provider');
    conflict.code = 'ai-change-applier-provider-conflict';
    throw conflict;
  }
  var deps = createDeps(global);
  var installation = build(deps);
  var facade = installation && installation.facade;
  var legacyExports = installation && installation.legacyExports;
  aiNamespace = global && global.TM && global.TM.AIChange;
  if (!facade || !legacyExports || !aiNamespace || typeof aiNamespace !== 'object') {
    var invalid = new Error('[AIChangeApplier] incomplete legacy installation');
    invalid.code = 'ai-change-applier-installation-invalid';
    throw invalid;
  }
  if (legacyExports.AIChangeApplier !== facade) {
    var mismatch = new Error('[AIChangeApplier] facade export mismatch');
    mismatch.code = 'ai-change-applier-installation-invalid';
    throw mismatch;
  }
  var state = Object.freeze({
    initialized: true,
    facade: facade,
    create: function (nextDeps) { return build(nextDeps).facade; },
    build: build,
    createLegacyDeps: createDeps
  });
  var exportKeys = Object.keys(legacyExports);
  var snapshots = exportKeys.map(function (key) { return snapshotProperty(global, key); });
  snapshots.push(snapshotProperty(aiNamespace, 'WriteGuards'));
  snapshots.push(snapshotProperty(aiNamespace, 'ApplierModule'));
  try {
    exportKeys.forEach(function (key) { publishProperty(global, key, legacyExports[key]); });
    publishProperty(aiNamespace, 'WriteGuards', facade.writeGuards);
    // 状态哨兵最后发布：看到 initialized=true 即代表全部 legacy globals 已完整安装。
    publishProperty(aiNamespace, 'ApplierModule', state);
    return facade;
  } catch (error) {
    var rollbackFailures = restoreProperties(snapshots);
    var publishError = new Error('[AIChangeApplier] atomic legacy publish failed: ' + String(error && (error.message || error) || 'unknown'));
    publishError.code = 'ai-change-applier-publish-failed';
    publishError.cause = error;
    publishError.rollbackFailures = rollbackFailures;
    throw publishError;
  }
}
