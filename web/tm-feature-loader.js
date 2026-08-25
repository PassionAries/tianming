// tm-feature-loader.js — explicit, lifecycle-aware classic-script feature boundaries.
(function (root) {
  'use strict';
  if (!root || !root.document) return;

  root.TM = root.TM || {};

  var MANIFEST_SRC = 'feature-manifest.js?v=20260825-feature-loader-v2';
  var DEFAULT_TIMEOUT_MS = 15000;
  var definitions = Object.create(null);
  var runtime = Object.create(null);
  var scriptLoads = Object.create(null);
  var manifestPromise = null;

  function featureError(code, message, details) {
    var error = new Error(message || code);
    error.code = code;
    error.details = details || {};
    return error;
  }

  function report(error, phase, feature) {
    var payload = {
      code: error && error.code ? error.code : 'feature-error',
      phase: phase || 'unknown',
      feature: feature || '',
      message: error && error.message ? error.message : String(error || 'unknown feature error')
    };
    try {
      if (root.TM && root.TM.Diagnostics && typeof root.TM.Diagnostics.capture === 'function') {
        root.TM.Diagnostics.capture('feature-loader', payload);
      } else if (root.console && typeof root.console.warn === 'function') {
        root.console.warn('[TM.Features]', payload);
      }
    } catch (diagnosticError) {
      if (root.console && typeof root.console.warn === 'function') {
        root.console.warn('[TM.Features] diagnostic failed', diagnosticError);
      }
    }
  }

  function normalizeScripts(value) {
    if (!Array.isArray(value) || !value.length) throw featureError('invalid-feature-definition', 'feature scripts must be a non-empty array');
    return value.map(function (entry) {
      if (typeof entry !== 'string' || !entry.trim()) throw featureError('invalid-feature-script', 'feature script path must be a non-empty string');
      return entry.trim();
    });
  }

  function normalizeDefinition(name, input) {
    if (!name || typeof name !== 'string') throw featureError('invalid-feature-name', 'feature name must be a non-empty string');
    input = input || {};
    return {
      name: name,
      scripts: normalizeScripts(input.scripts),
      dependsOn: Array.isArray(input.dependsOn) ? input.dependsOn.slice() : [],
      platform: input.platform || 'any',
      provides: Array.isArray(input.provides) ? input.provides.slice() : [],
      loadPolicy: input.loadPolicy || 'on-demand',
      sideEffects: input.sideEffects || 'legacy-unknown',
      init: typeof input.init === 'function' ? input.init : null,
      dispose: typeof input.dispose === 'function' ? input.dispose : null,
      timeoutMs: Number.isFinite(Number(input.timeoutMs)) && Number(input.timeoutMs) > 0
        ? Number(input.timeoutMs) : DEFAULT_TIMEOUT_MS
    };
  }

  function stateFor(name) {
    if (!runtime[name]) {
      runtime[name] = {
        state: definitions[name] ? 'defined' : 'unknown',
        promise: null,
        initialized: false,
        retryCount: 0,
        lastError: null
      };
    }
    return runtime[name];
  }

  function define(name, input) {
    if (definitions[name]) throw featureError('duplicate-feature-definition', 'feature is already defined: ' + name, { feature: name });
    definitions[name] = normalizeDefinition(name, input);
    stateFor(name).state = 'defined';
    return definitions[name];
  }

  function registerManifest(manifest) {
    if (!manifest || manifest.version !== 1 || !manifest.features || typeof manifest.features !== 'object') {
      throw featureError('invalid-feature-manifest', 'feature manifest version 1 is required');
    }
    Object.keys(manifest.features).forEach(function (name) {
      define(name, manifest.features[name]);
    });
    return Object.keys(manifest.features).length;
  }

  function platformKind() {
    try {
      if (root.TM && root.TM.platform && root.TM.platform.kind) return String(root.TM.platform.kind);
      if (root.tianming) return 'electron';
      if (root.Capacitor && typeof root.Capacitor.isNativePlatform === 'function' && root.Capacitor.isNativePlatform()) return 'capacitor';
    } catch (error) {
      report(error, 'platform-detection');
    }
    return 'web';
  }

  function applicable(expected, actual) {
    if (!expected || expected === 'any') return true;
    if (Array.isArray(expected)) return expected.indexOf(actual) >= 0;
    if (expected === 'desktop') return actual === 'electron';
    if (expected === 'touch') return actual === 'capacitor';
    return expected === actual;
  }

  function resolvePath(pathText) {
    var parts = String(pathText || '').split('.');
    var value = root;
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i] || value == null || !Object.prototype.hasOwnProperty.call(value, parts[i])) return undefined;
      value = value[parts[i]];
    }
    return value;
  }

  function verifyProvides(definition) {
    var missing = definition.provides.filter(function (pathText) { return typeof resolvePath(pathText) === 'undefined'; });
    if (missing.length) {
      throw featureError('feature-provider-missing', 'feature did not provide required globals: ' + missing.join(', '), {
        feature: definition.name,
        missing: missing
      });
    }
  }

  function loadScript(src, timeoutMs) {
    if (scriptLoads[src]) return scriptLoads[src];
    scriptLoads[src] = new Promise(function (resolve, reject) {
      var script = root.document.createElement('script');
      var settled = false;
      var timer = root.setTimeout(function () {
        if (settled) return;
        settled = true;
        delete scriptLoads[src];
        script.onload = null;
        script.onerror = null;
        reject(featureError('feature-script-timeout', 'feature script timed out: ' + src, { script: src, timeoutMs: timeoutMs }));
      }, timeoutMs);
      script.async = false;
      script.src = src;
      script.dataset.tmFeatureScript = 'true';
      script.onload = function () {
        if (settled) return;
        settled = true;
        root.clearTimeout(timer);
        script.onload = null;
        script.onerror = null;
        resolve({ ok: true, script: src });
      };
      script.onerror = function () {
        if (settled) return;
        settled = true;
        root.clearTimeout(timer);
        delete scriptLoads[src];
        script.onload = null;
        script.onerror = null;
        reject(featureError('feature-script-load-failed', 'feature script failed to load: ' + src, { script: src }));
      };
      (root.document.head || root.document.documentElement).appendChild(script);
    });
    return scriptLoads[src];
  }

  function ensureManifest() {
    if (manifestPromise) return manifestPromise;
    manifestPromise = loadScript(MANIFEST_SRC, DEFAULT_TIMEOUT_MS).then(function () {
      if (!Object.keys(definitions).length) throw featureError('feature-manifest-empty', 'feature manifest registered no features');
      return true;
    }).catch(function (error) {
      manifestPromise = null;
      throw error;
    });
    return manifestPromise;
  }

  function ensureDefined(name) {
    if (definitions[name]) return Promise.resolve(definitions[name]);
    return ensureManifest().then(function () {
      if (!definitions[name]) throw featureError('unknown-feature', 'unknown feature: ' + name, { feature: name });
      return definitions[name];
    });
  }

  function loadFeature(name) {
    return ensureDefined(name).then(function (definition) {
      var state = stateFor(name);
      var actualPlatform = platformKind();
      if (!applicable(definition.platform, actualPlatform)) {
        state.state = 'not-applicable';
        return { ok: false, code: 'not-applicable', feature: name, platform: actualPlatform };
      }
      return definition.dependsOn.reduce(function (chain, dependency) {
        return chain.then(function () {
          return ensure(dependency).then(function (result) {
            if (result && result.ok === false && result.code === 'not-applicable') {
              throw featureError('feature-dependency-not-applicable', 'feature dependency is not applicable: ' + dependency, {
                feature: name,
                dependency: dependency
              });
            }
          });
        });
      }, Promise.resolve()).then(function () {
        return definition.scripts.reduce(function (chain, src) {
          return chain.then(function () { return loadScript(src, definition.timeoutMs); });
        }, Promise.resolve());
      }).then(function () {
        verifyProvides(definition);
        if (!state.initialized && definition.init) {
          return Promise.resolve(definition.init()).then(function () { state.initialized = true; });
        }
        state.initialized = true;
      }).then(function () {
        state.state = 'ready';
        state.lastError = null;
        return { ok: true, feature: name, state: 'ready' };
      });
    });
  }

  function ensure(name) {
    var state = stateFor(name);
    if (state.state === 'ready') return Promise.resolve({ ok: true, feature: name, state: 'ready', reused: true });
    if (state.promise) return state.promise;
    if (state.state === 'failed') {
      return Promise.reject(featureError('feature-retry-required', 'feature failed previously; call retry(): ' + name, {
        feature: name,
        retryCount: state.retryCount
      }));
    }
    state.state = 'loading';
    state.promise = loadFeature(name).catch(function (error) {
      state.state = 'failed';
      state.lastError = error;
      report(error, 'ensure', name);
      throw error;
    }).finally(function () {
      state.promise = null;
    });
    return state.promise;
  }

  function retry(name) {
    var state = stateFor(name);
    if (state.state !== 'failed') return ensure(name);
    if (state.retryCount >= 1) {
      return Promise.reject(featureError('feature-retry-limit', 'feature retry limit reached: ' + name, { feature: name }));
    }
    state.retryCount += 1;
    state.state = 'defined';
    state.lastError = null;
    return ensure(name);
  }

  function preload(name) {
    return ensure(name);
  }

  function dispose(name) {
    return ensureDefined(name).then(function (definition) {
      var state = stateFor(name);
      if (!state.initialized) {
        state.state = state.state === 'unknown' ? 'defined' : state.state;
        return { ok: true, feature: name, disposed: false };
      }
      return Promise.resolve(definition.dispose ? definition.dispose() : undefined).then(function () {
        state.initialized = false;
        state.state = 'disposed';
        return { ok: true, feature: name, disposed: true };
      });
    });
  }

  function status(name) {
    if (name) {
      var one = stateFor(name);
      return {
        feature: name,
        state: one.state,
        initialized: one.initialized,
        retryCount: one.retryCount,
        errorCode: one.lastError && one.lastError.code || ''
      };
    }
    return Object.keys(runtime).sort().map(function (key) { return status(key); });
  }

  function afterWindowLoad(callback) {
    if (root.document.readyState === 'complete') root.setTimeout(callback, 0);
    else root.addEventListener('load', callback, { once: true });
  }

  function bootOptionalFeatures() {
    afterWindowLoad(function () {
      var search = '';
      try { search = String(root.location && root.location.search || ''); } catch (error) { report(error, 'query-detection'); }
      if (/[?&](?:test|devHarness)=1(?:&|$)/.test(search)) {
        ensure('browserTestHarness').catch(function (error) { report(error, 'browser-test-harness', 'browserTestHarness'); });
      }
      if (platformKind() === 'web') {
        var idle = typeof root.requestIdleCallback === 'function'
          ? root.requestIdleCallback
          : function (fn) { return root.setTimeout(fn, 1200); };
        idle(function () {
          ensure('onlineUpdate').catch(function (error) { report(error, 'online-update', 'onlineUpdate'); });
        });
      }
    });
  }

  root.TM.Features = {
    define: define,
    registerManifest: registerManifest,
    ensure: ensure,
    preload: preload,
    dispose: dispose,
    status: status,
    retry: retry,
    platformKind: platformKind,
    _loadScript: loadScript,
    _manifestSource: MANIFEST_SRC
  };

  bootOptionalFeatures();
})(typeof window !== 'undefined' ? window : globalThis);
