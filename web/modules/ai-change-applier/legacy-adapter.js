// @ts-check

export function installLegacyFacade(global, create, createDeps) {
  var tm = global.TM = global.TM || {};
  var aiNamespace = tm.AIChange = tm.AIChange || {};
  var existing = aiNamespace.ApplierModule;
  if (existing && existing.initialized === true) return existing.facade;
  if (global.AIChangeApplier) {
    var conflict = new Error('[AIChangeApplier] refusing to overwrite an existing provider');
    conflict.code = 'ai-change-applier-provider-conflict';
    throw conflict;
  }
  var deps = createDeps(global);
  var facade = create(deps);
  aiNamespace.WriteGuards = facade.writeGuards;
  var state = Object.freeze({
    initialized: true,
    facade: facade,
    create: create,
    createLegacyDeps: createDeps
  });
  aiNamespace.ApplierModule = state;
  return facade;
}
