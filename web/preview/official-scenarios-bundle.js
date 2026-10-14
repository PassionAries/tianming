/* GENERATED FILE. Source: ../tm-official-scenario-bundle.js（须先装载）. Run `node web/scripts/sync-official-scenarios.js`. */
(function(global){
  var KEY_BY_FILENAME = {"天启七年·九月（官方）":"tianqi7","绍宋·建炎元年八月（官方）":"shaosong","晚唐·开成五年（官方）":"tang840"};
  var list = global.TMOfficialScenarioBundle;
  if (!Array.isArray(list)) throw new Error("official-scenarios-bundle.js: 须先装载 ../tm-official-scenario-bundle.js");
  var out = {};
  list.forEach(function(entry){ var key = entry && KEY_BY_FILENAME[entry.filename]; if (key) out[key] = entry.data; });
  global.TM_OFFICIAL_SCENARIOS = out;
})(typeof window !== "undefined" ? window : globalThis);
