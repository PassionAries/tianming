// @ts-check
/// <reference path="types.d.ts" />
// ============================================================
// tm-chronicle-system.js — 编年史系统
//
// R89 从 tm-endturn.js 抽出·战役状态随 GM 持久化，对象本身只提供操作服务
//   原位置 L3282-3486 (205 行)
//
// 依赖外部：_getDaysPerTurn / callAI / extractJSON / _dbg / addEB （均为 window 全局）
// 外部调用方：tm-audio-theme.js / tm-endturn-render.js / tm-patches.js / tm-endturn.js
//
// 加载顺序：必须在 tm-endturn.js 之前（index.html 顺序已调整）
// ============================================================

function _chronicleEmptyState() {
  return { version: 3, monthDrafts: {}, yearChronicles: {}, yearBases: {} };
}

var _chronicleDetachedState = _chronicleEmptyState();

function _chronicleState(targetGM, create) {
  var owner = targetGM || ((typeof GM !== 'undefined' && GM) ? GM : null);
  if (!owner) return _chronicleDetachedState;
  var state = owner._chronicleSysState;
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    if (!create) return null;
    state = _chronicleEmptyState();
    owner._chronicleSysState = state;
  }
  if (!state.monthDrafts || typeof state.monthDrafts !== 'object' || Array.isArray(state.monthDrafts)) state.monthDrafts = {};
  if (!state.yearChronicles || typeof state.yearChronicles !== 'object' || Array.isArray(state.yearChronicles)) state.yearChronicles = {};
  if (!state.yearBases || typeof state.yearBases !== 'object' || Array.isArray(state.yearBases)) state.yearBases = {};
  state.version = 3;
  return state;
}

function _chronicleCloneState(data) {
  var source = data && typeof data === 'object' ? data : _chronicleEmptyState();
  try {
    var cloned = JSON.parse(JSON.stringify(source));
    if (!cloned || typeof cloned !== 'object') return _chronicleEmptyState();
    if (!cloned.monthDrafts || typeof cloned.monthDrafts !== 'object' || Array.isArray(cloned.monthDrafts)) cloned.monthDrafts = {};
    if (!cloned.yearChronicles || typeof cloned.yearChronicles !== 'object' || Array.isArray(cloned.yearChronicles)) cloned.yearChronicles = {};
    if (!cloned.yearBases || typeof cloned.yearBases !== 'object' || Array.isArray(cloned.yearBases)) cloned.yearBases = {};
    cloned.version = 3;
    return cloned;
  } catch (_) {
    return _chronicleEmptyState();
  }
}

function _chronicleDateForTurn(turn) {
  if (typeof TimeUtils !== 'undefined' && TimeUtils && typeof TimeUtils.turnToDate === 'function') {
    var canonical = TimeUtils.turnToDate(turn);
    return {
      year: Number(canonical.year), month: Number(canonical.month), day: Number(canonical.day),
      season: canonical.season || '', monthLabel: canonical.monthLabel || String(canonical.month || '')
    };
  }
  if (typeof calcDateFromTurn === 'function') {
    var legacy = calcDateFromTurn(turn);
    return {
      year: Number(legacy.adYear), month: Number(legacy.solarMonth), day: Number(legacy.solarDay),
      season: legacy.season || '', monthLabel: String(legacy.solarMonth || '')
    };
  }
  return null;
}

function _chronicleDraftLimit() {
  var keepYears = Number(P && P.conf && P.conf.chronicleKeep);
  if (!isFinite(keepYears) || keepYears <= 0) keepYears = 10;
  var daysPerTurn = Number(typeof _getDaysPerTurn === 'function' ? _getDaysPerTurn() : 30);
  if (!isFinite(daysPerTurn) || daysPerTurn <= 0) daysPerTurn = 30;
  return Math.max(12, Math.ceil(366 / daysPerTurn)) * Math.floor(keepYears);
}

function _chronicleRequestId() {
  ChronicleSystem._requestSeq = (ChronicleSystem._requestSeq || 0) + 1;
  return 'chronicle-' + Date.now() + '-' + ChronicleSystem._requestSeq;
}

function _chronicleStableHash(value) {
  var text = JSON.stringify(value);
  var hash = 2166136261;
  for (var i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 'chb_' + (hash >>> 0).toString(16).padStart(8, '0');
}

function _chronicleBuildYearBasis(targetGM, state, year) {
  targetGM = targetGM || ((typeof GM !== 'undefined' && GM) ? GM : null);
  state = state || _chronicleState(targetGM, false);
  year = Number(year);
  var drafts = [];
  Object.keys(state && state.monthDrafts || {}).forEach(function(key) {
    var draft = state.monthDrafts[key];
    if (!draft || Number(draft.year) !== year) return;
    drafts.push({
      turn: Number(draft.turn) || 0, year: Number(draft.year), month: Number(draft.month) || 0,
      day: Number(draft.day) || 0, summary: String(draft.summary || ''), narrative: String(draft.narrative || '')
    });
  });
  drafts.sort(function(a, b) { return a.turn - b.turn; });
  var digests = (targetGM && Array.isArray(targetGM._yearlyDigest) ? targetGM._yearlyDigest : []).filter(function(item) {
    if (!item) return false;
    var itemYear = Number(item.year);
    if (!Number.isSafeInteger(itemYear)) {
      var date = _chronicleDateForTurn(item.turn);
      itemYear = date && date.year;
    }
    return itemYear === year;
  }).map(function(item) {
    return { turn: Number(item.turn) || 0, summary: String(item.summary || '') };
  }).sort(function(a, b) { return a.turn - b.turn; });
  var foreshadowings = (targetGM && Array.isArray(targetGM._foreshadowings) ? targetGM._foreshadowings : []).filter(function(item) {
    if (!(item && item.resolved && item.resolveTurn)) return false;
    var date = _chronicleDateForTurn(item.resolveTurn);
    return date && date.year === year;
  }).map(function(item) {
    return {
      plantTurn: Number(item.plantTurn) || 0, resolveTurn: Number(item.resolveTurn) || 0,
      content: String(item.content || ''), resolveContent: String(item.resolveContent || '')
    };
  }).sort(function(a, b) { return a.resolveTurn - b.resolveTurn || a.plantTurn - b.plantTurn; });
  var edicts = (targetGM && Array.isArray(targetGM._edictTracker) ? targetGM._edictTracker : []).filter(function(item) {
    if (!(item && item.turn)) return false;
    var date = _chronicleDateForTurn(item.turn);
    return date && date.year === year;
  }).map(function(item) {
    return {
      turn: Number(item.turn) || 0, category: String(item.category || ''), content: String(item.content || ''),
      status: String(item.status || ''), assignee: String(item.assignee || ''), feedback: String(item.feedback || '')
    };
  }).sort(function(a, b) { return a.turn - b.turn; });
  var sourceTurn = drafts.reduce(function(max, draft) { return Math.max(max, draft.turn); }, 0);
  return {
    year: year,
    sourceTurn: sourceTurn,
    historyBasisHash: _chronicleStableHash({ year: year, drafts: drafts, digests: digests, foreshadowings: foreshadowings, edicts: edicts })
  };
}

function _chronicleTrimYears(state, targetP) {
  if (!state || !state.yearChronicles) return;
  var keepYears = Number(targetP && targetP.conf && targetP.conf.chronicleKeep);
  if (!isFinite(keepYears) || keepYears <= 0) keepYears = 10;
  var maxYears = Math.max(1, Math.floor(keepYears)) * 2;
  var yearKeys = Object.keys(state.yearChronicles).map(Number).filter(function(year) {
    return Number.isSafeInteger(year);
  }).sort(function(a, b) { return a - b; });
  if (yearKeys.length <= maxYears) return;
  yearKeys.slice(0, yearKeys.length - maxYears).forEach(function(year) {
    delete state.yearChronicles[year];
    if (state.yearBases) delete state.yearBases[year];
  });
}

function _chronicleWaitForWorldCommit(targetGM, leaseIsCurrent) {
  if (!targetGM || !targetGM._endTurnCommitPending) return Promise.resolve(true);
  var startedAt = Date.now();
  return new Promise(function(resolve) {
    function poll() {
      if (!leaseIsCurrent()) { resolve(false); return; }
      if (!targetGM._endTurnCommitPending) { resolve(true); return; }
      if (Date.now() - startedAt > 90000) { resolve(false); return; }
      setTimeout(poll, 25);
    }
    poll();
  });
}

var ChronicleSystem = {
  _inFlight: [],
  _requestSeq: 0,

  // 兼容旧消费者的属性访问；真正数据始终落在当前 GM._chronicleSysState。
  get monthDrafts() { return _chronicleState(null, true).monthDrafts; },
  set monthDrafts(value) { _chronicleState(null, true).monthDrafts = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {}; },
  get yearChronicles() { return _chronicleState(null, true).yearChronicles; },
  set yearChronicles(value) { _chronicleState(null, true).yearChronicles = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {}; },

  /** 记录本回合摘要（每回合末调用） */
  addMonthDraft: function(turn, shizhengji, zhengwen) {
    if (!P || !P.time) return null;
    turn = Number(turn);
    if (!Number.isSafeInteger(turn) || turn < 1) return null;
    var date = _chronicleDateForTurn(turn);
    if (!date || !isFinite(date.year)) return null;
    var state = _chronicleState(null, true);
    var key = String(turn);

    state.monthDrafts[key] = {
      turn: turn,
      year: date.year,
      month: date.month,
      day: date.day,
      season: date.season,
      monthLabel: date.monthLabel,
      summary: (shizhengji || '').substring(0, 300),
      narrative: (zhengwen || '').substring(0, 200),
      timestamp: Date.now()
    };

    // 每回合一份、同一回合幂等覆盖；按回合号裁剪，不能再以季度键吞掉同季多回合。
    var draftKeys = Object.keys(state.monthDrafts);
    var maxDrafts = _chronicleDraftLimit();
    if (draftKeys.length > maxDrafts) {
      draftKeys.sort(function(a, b) {
        return Number(state.monthDrafts[a] && state.monthDrafts[a].turn || 0) - Number(state.monthDrafts[b] && state.monthDrafts[b].turn || 0);
      });
      var toRemove = draftKeys.slice(0, draftKeys.length - maxDrafts);
      toRemove.forEach(function(k) { delete state.monthDrafts[k]; });
    }

    // 使用统一历法判断“本回合结束后跨年”，不复制固定 365/91.25 天公式。
    var nextDate = _chronicleDateForTurn(turn + 1);
    if (nextDate && nextDate.year > date.year) {
      state.yearBases[date.year] = _chronicleBuildYearBasis(GM, state, date.year);
      ChronicleSystem._tryGenerateYearChronicle(date.year);
    }
    return state.monthDrafts[key];
  },

  /** 尝试生成年度正史（异步，不阻塞游戏） */
  _tryGenerateYearChronicle: function(year) {
    year = Number(year);
    if (!isFinite(year)) return Promise.resolve({ ok: false, reason: 'invalid-year' });
    var targetGM = (typeof GM !== 'undefined') ? GM : null;
    var targetP = (typeof P !== 'undefined') ? P : null;
    var targetState = _chronicleState(targetGM, true);
    if (!targetGM || !targetP || !targetState) return Promise.resolve({ ok: false, reason: 'missing-world' });
    if (targetState.yearChronicles[year]) return Promise.resolve({ ok: true, existing: true });
    if (!(targetP.ai && targetP.ai.key)) return Promise.resolve({ ok: false, reason: 'missing-ai' });

    var existing = ChronicleSystem._inFlight.find(function(item) {
      return item && item.stateRef === targetState && item.year === year;
    });
    if (existing) return existing.promise;

    // 收集该年所有月度摘要
    var drafts = [];
    Object.keys(targetState.monthDrafts).forEach(function(key) {
      var d = targetState.monthDrafts[key];
      if (d.year === year) drafts.push(d);
    });
    if (drafts.length === 0) return Promise.resolve({ ok: false, reason: 'missing-drafts' });

    drafts.sort(function(a, b) { return a.turn - b.turn; });
    var timelineId = '';
    try {
      timelineId = typeof _tmEnsureTimelineId === 'function' ? _tmEnsureTimelineId(targetGM) : String(targetGM._timelineId || '');
    } catch (_) { timelineId = String(targetGM._timelineId || ''); }
    if (!timelineId) return Promise.resolve({ ok: false, reason: 'missing-timeline' });
    var historyBasis = targetState.yearBases[year] || _chronicleBuildYearBasis(targetGM, targetState, year);
    targetState.yearBases[year] = historyBasis;

    var lease = {
      requestId: _chronicleRequestId(),
      gmRef: targetGM,
      pRef: targetP,
      stateRef: targetState,
      campaignId: String(targetGM._campaignId || ''),
      timelineId: timelineId,
      loadGen: (typeof window !== 'undefined' && window._tmLoadGen) || 0,
      year: year,
      sourceTurn: historyBasis.sourceTurn,
      historyBasisHash: historyBasis.historyBasisHash,
      promise: null
    };
    function leaseIsCurrent() {
      return typeof GM !== 'undefined' && typeof P !== 'undefined' &&
        GM === lease.gmRef && P === lease.pRef &&
        (((typeof window !== 'undefined' && window._tmLoadGen) || 0) === lease.loadGen) &&
        String((GM && GM._campaignId) || '') === lease.campaignId &&
        String((GM && GM._timelineId) || '') === lease.timelineId &&
        _chronicleState(lease.gmRef, false) === lease.stateRef &&
        ChronicleSystem._inFlight.some(function(item) { return item && item.requestId === lease.requestId; });
    }

    // 构建 AI prompt（不硬编码朝代，从 P 中读取）
    var sc = findScenarioById(targetGM.sid);
    var dynasty = sc ? sc.dynasty || sc.era || '' : '';
    var emperor = sc ? sc.emperor || sc.role || '' : '';
    var prevAfterword = '';
    if (targetState.yearChronicles[year - 1]) {
      prevAfterword = targetState.yearChronicles[year - 1].afterword || '';
    }

    // 编年史风格（从chronicleConfig读取）
    var _ccfg = targetP.chronicleConfig || {};
    var _style = _ccfg.style || 'biannian';
    var _styleGuide = {
      biannian: '编年体（仿《资治通鉴》），以时间为纲，逐月叙事，客观冷静。',
      shilu: '实录体（仿《各朝实录》），以帝王言行为中心，详记诏令与臣对。',
      jizhuan: '纪传体（仿《史记》），以人物为中心，叙述本年关键人物事迹。',
      jishi: '纪事本末体（仿《通鉴纪事本末》），以事件为线索，完整讲述本年重大事件始末。',
      biji: '笔记体（仿宋人笔记），笔调闲散，穿插逸事趣闻，可加作者评论。',
      custom: _ccfg.customStyleNote || '自定义风格，典雅古朴。'
    };
    var _chrR2 = _getCharRange('chronicle');
    var _minC = _ccfg.yearlyMinChars || _chrR2[0];
    var _maxC = _ccfg.yearlyMaxChars || _chrR2[1];

    // 6.5: 编年史整合——春秋左传风格强制指导
    var _chronicleStyleGuide = '严格参照《春秋》《左传》编年体史书风格。以年月为序，记录大事。用语简洁精炼如"某年某月，某事"。每事一句或数句，不铺陈渲染。年号纪年，按时序排列。';
    var prompt = '你是一位古代史官，负责撰写' + dynasty + '正史。\n';
    prompt += '文体要求：' + (_styleGuide[_style] || _styleGuide.biannian) + '\n';
    prompt += '底层风格参照：' + _chronicleStyleGuide + '\n';
    prompt += '请根据以下各季/月的起居注摘要，撰写' + year + '年的编年史记（' + _minC + '-' + _maxC + '字）。\n';
    if (emperor) prompt += '当朝天子/主角：' + emperor + '\n';
    if (prevAfterword) prompt += '上年史评：' + prevAfterword + '\n';
    // 6.1联动：注入该年回收的伏笔因果链
    if (targetGM._foreshadowings) {
      var _yearResolved = targetGM._foreshadowings.filter(function(f) {
        if (!(f && f.resolved && f.resolveTurn)) return false;
        var resolvedDate = _chronicleDateForTurn(f.resolveTurn);
        return resolvedDate && resolvedDate.year === year;
      });
      if (_yearResolved.length > 0) {
        prompt += '\n\u672C\u5E74\u56DE\u6536\u7684\u4F0F\u7B14\u56E0\u679C\u94FE\uFF08\u7F16\u5E74\u4E2D\u5E94\u81EA\u7136\u5448\u73B0\u8FD9\u4E9B\u524D\u56E0\u540E\u679C\uFF09\uFF1A\n';
        _yearResolved.forEach(function(f) {
          prompt += '  T' + f.plantTurn + '\u57CB\u4E0B\u300C' + f.content + '\u300D\u2192 T' + f.resolveTurn + '\u300C' + (f.resolveContent||'') + '\u300D\n';
        });
      }
    }
    // 6.5联动：注入每回合一句话摘要
    if (targetGM._yearlyDigest && targetGM._yearlyDigest.length > 0) {
      var yearDigests = targetGM._yearlyDigest.filter(function(d) {
        if (!d) return false;
        var digestYear = (d.year != null && d.year !== '') ? Number(d.year) : NaN;
        if (!Number.isSafeInteger(digestYear)) {
          var digestDate = _chronicleDateForTurn(d.turn);
          digestYear = digestDate && digestDate.year;
        }
        return digestYear === year;
      });
      if (yearDigests.length > 0) {
        prompt += '\n\u672C\u5E74\u5404\u56DE\u5408\u4E00\u53E5\u8BDD\u6458\u8981\uFF1A\n';
        yearDigests.forEach(function(d) { prompt += 'T' + d.turn + ': ' + d.summary + '\n'; });
      }
    }
    // 6.7联动：本年度下达诏令+其后续影响（colorEdicts + _chainEffects）
    if (targetGM._edictTracker && targetGM._edictTracker.length > 0) {
      var _yearEdicts = targetGM._edictTracker.filter(function(e) {
        if (!e || !e.turn) return false;
        var _d = _chronicleDateForTurn(e.turn);
        return _d && _d.year === year;
      });
      if (_yearEdicts.length > 0) {
        prompt += '\n\u3010\u672C\u5E74\u9881\u4E0B\u8BCF\u4EE4\u00B7\u7F16\u5E74\u4E2D\u5FC5\u987B\u8BB0\u5176\u9881\u5E03\u00B7\u6267\u884C\u00B7\u4F59\u6CE2\u3011\n';
        _yearEdicts.slice(0, 10).forEach(function(e) {
          prompt += '  T' + e.turn + '\u00B7' + (e.category||'\u8BCF\u4EE4') + '\uFF1A' + (e.content||'').slice(0, 80) + '\n';
          prompt += '      \u00B7\u72B6\u6001: ' + (e.status||'pending');
          if (e.assignee) prompt += '  \u6267\u884C: ' + e.assignee;
          if (e.progressPercent) prompt += '  \u8FDB\u5EA6: ' + e.progressPercent + '%';
          prompt += '\n';
          if (e.feedback) prompt += '      \u00B7\u53CD\u9988: ' + e.feedback.slice(0, 100) + '\n';
          if (e._chainEffects && e._chainEffects.length) {
            prompt += '      \u00B7\u8FDE\u9501\u6548\u5E94: ';
            e._chainEffects.slice(-5).forEach(function(ce) {
              prompt += (ce.turn ? 'T'+ce.turn+' ' : '') + (ce.effect||'') + '; ';
            });
            prompt += '\n';
          }
        });
        prompt += '  \u203B \u7F16\u5E74\u4E2D\u8BE5\u4EE5\u300C\u8BCFXX\u300D\u300C\u884C\u81F3X\u6708\u67D0\u65E5\uFF0CXX\u4E8B\u5E94\u300D\u7B49\u53E5\u5F0F\uFF0C\u5C06\u8BCF\u4EE4\u9881\u5E03\u2014\u6267\u884C\u2014\u4F59\u6CE2\u7ED3\u6210\u56E0\u679C\u94FE\uFF0C\u4E0D\u53EF\u53EA\u63D0\u9881\u5E03\u800C\u4E0D\u63D0\u7ED3\u679C\n';
      }
    }
    prompt += '\n\u5404\u56DE\u5408\u6458\u8981\uFF1A\n';
    drafts.forEach(function(d) {
      var dateLabel = d.year + '\u5E74' + (d.monthLabel || d.month || '') + '\u6708' + (d.day ? d.day + '\u65E5' : '');
      prompt += '\u3010T' + d.turn + '\u00B7' + dateLabel + '\u3011' + d.summary + '\n';
    });
    prompt += '\n请返回 JSON: {"chronicle":"正史正文' + _charRangeText('chronicle') + '","afterword":"史评/论赞' + _charRangeScaled('comment', 1.0) + '"}';

    // 时空约束·年度编年正史修史·full(带在世/已故名单·防给在世者书卒/越今引后事·本局事以GM为准)（typeof守卫防加载序）
    if (typeof _buildTemporalConstraint === 'function') { try { prompt += '\n' + _buildTemporalConstraint(null, {}); } catch (_) {} }

    // 异步生成，不阻塞；年度编年不应抢占玩家正在等待的主推演通道。
    var request;
    try {
      request = callAI(prompt, 1500, null, 'primary', {
        priority: 'background',
        timeoutMs: 60000,
        maxRetries: 1
      });
    } catch (syncError) {
      (window.TM && TM.errors && TM.errors.capture) ? TM.errors.capture(syncError, 'Chronicle') : console.warn('[Chronicle] 年度正史生成失败:', syncError);
      return Promise.resolve({ ok: false, error: syncError });
    }
    lease.promise = Promise.resolve(request).then(function(result) {
      if (!leaseIsCurrent()) return { ok: false, stale: true };
      var parsed = extractJSON(result);
      if (parsed) {
        var chronicleText = (parsed && typeof parsed === 'object') ? parsed.chronicle : '';
        if (typeof chronicleText !== 'string' || !chronicleText.trim()) {
          chronicleText = typeof result === 'string' ? result : '';
        }
        if (!chronicleText.trim()) return { ok: false, reason: 'invalid-result' };
        var afterwordText = (parsed && typeof parsed === 'object' && typeof parsed.afterword === 'string') ? parsed.afterword : '';
        var chronicleEntry = {
          content: chronicleText.slice(0, 20000),
          afterword: afterwordText.slice(0, 5000),
          read: false,
          generatedAt: Date.now(),
          authorityLevel: 'official_record',
          confidence: 0.8
        };
        return _chronicleWaitForWorldCommit(targetGM, leaseIsCurrent).then(function(worldCommitted) {
          if (!worldCommitted || !leaseIsCurrent()) return { ok: false, stale: true };
          if (!(typeof TM_SaveDB !== 'undefined' && TM_SaveDB && typeof TM_SaveDB.saveChronicleRecord === 'function')) {
            throw new Error('年度正史轻量持久化接口缺失');
          }
          return TM_SaveDB.saveChronicleRecord({
            campaignId: lease.campaignId,
            timelineId: lease.timelineId,
            year: year,
            sourceTurn: lease.sourceTurn,
            historyBasisHash: lease.historyBasisHash,
            requestId: lease.requestId,
            loadGeneration: lease.loadGen,
            generatedAt: chronicleEntry.generatedAt,
            maxYears: Math.max(1, Math.floor(Number(targetP && targetP.conf && targetP.conf.chronicleKeep) || 10)) * 2,
            chronicle: chronicleEntry
          }, { writeGuard: leaseIsCurrent }).then(function(saved) {
            if (saved !== true) throw new Error('年度正史轻量 checkpoint 未提交');
            if (!leaseIsCurrent()) return { ok: false, stale: true };
            targetState.yearChronicles[year] = chronicleEntry;
            _chronicleTrimYears(targetState, targetP);
            _dbg('[Chronicle] 年度正史生成完成:', year);
            if (typeof addEB === 'function') addEB('正史', year + '年编年史已完成');
            return { ok: true, year: year, durable: true };
          });
        });
      }
      return { ok: false, reason: 'invalid-result' };
    }).catch(function(e) {
      (window.TM && TM.errors && TM.errors.capture) ? TM.errors.capture(e, 'Chronicle') : console.warn('[Chronicle] 年度正史生成失败:', e);
      return { ok: false, error: e };
    }).then(function(outcome) {
      ChronicleSystem._inFlight = ChronicleSystem._inFlight.filter(function(item) { return item && item.requestId !== lease.requestId; });
      return outcome;
    });
    ChronicleSystem._inFlight.push(lease);
    return lease.promise;
  },

  /** 获取年度正史（UI 用） */
  getYearChronicle: function(year) {
    return ChronicleSystem.yearChronicles[year] || null;
  },

  /** 获取所有已生成年份 */
  getAvailableYears: function() {
    return Object.keys(ChronicleSystem.yearChronicles).map(Number).filter(function(year) {
      return Number.isSafeInteger(year);
    }).sort(function(a, b) { return a - b; });
  },

  /** 从独立轻量 store 合并当前战役已完成的年度正史。 */
  hydrateDurableRecords: function(targetGM, targetP) {
    targetGM = targetGM || ((typeof GM !== 'undefined' && GM) ? GM : null);
    targetP = targetP || ((typeof P !== 'undefined' && P) ? P : null);
    if (!targetGM || !targetP) return Promise.resolve({ ok: false, reason: 'missing-world' });
    if (!(typeof TM_SaveDB !== 'undefined' && TM_SaveDB && typeof TM_SaveDB.listChronicleRecords === 'function')) {
      return Promise.resolve({ ok: false, reason: 'storage-unavailable' });
    }
    var targetState = _chronicleState(targetGM, true);
    var campaignId = String(targetGM._campaignId || '');
    var timelineId = String(targetGM._timelineId || '');
    var loadGen = (typeof window !== 'undefined' && window._tmLoadGen) || 0;
    function leaseIsCurrent() {
      return typeof GM !== 'undefined' && typeof P !== 'undefined' &&
        GM === targetGM && P === targetP &&
        (((typeof window !== 'undefined' && window._tmLoadGen) || 0) === loadGen) &&
        String((GM && GM._campaignId) || '') === campaignId &&
        String((GM && GM._timelineId) || '') === timelineId &&
        _chronicleState(targetGM, false) === targetState;
    }
    return TM_SaveDB.listChronicleRecords(campaignId, timelineId).then(function(records) {
      if (!leaseIsCurrent()) return { ok: false, stale: true };
      var merged = 0;
      (records || []).sort(function(a, b) { return Number(a && a.generatedAt || 0) - Number(b && b.generatedAt || 0); }).forEach(function(record) {
        if (!record || String(record.campaignId || '') !== campaignId || String(record.timelineId || '') !== timelineId) return;
        var year = Number(record.year);
        var incoming = record.chronicle;
        if (!Number.isSafeInteger(year) || !incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return;
        if (typeof incoming.content !== 'string' || !incoming.content) return;
        var sourceTurn = Number(record.sourceTurn);
        if (!Number.isSafeInteger(sourceTurn) || sourceTurn < 0 || sourceTurn > Number(targetGM.turn || 0)) return;
        var currentBasis = targetState.yearBases[year] || _chronicleBuildYearBasis(targetGM, targetState, year);
        if (!currentBasis || currentBasis.sourceTurn !== sourceTurn || currentBasis.historyBasisHash !== String(record.historyBasisHash || '')) return;
        targetState.yearBases[year] = currentBasis;
        var current = targetState.yearChronicles[year];
        if (current && Number(current.generatedAt || 0) >= Number(record.generatedAt || incoming.generatedAt || 0)) return;
        var cloned = null;
        try { cloned = JSON.parse(JSON.stringify(incoming)); } catch (_) { cloned = null; }
        if (!cloned) return;
        if (current && current.read === true) cloned.read = true;
        targetState.yearChronicles[year] = cloned;
        merged++;
      });
      _chronicleTrimYears(targetState, targetP);
      if (merged && leaseIsCurrent() && typeof renderBiannian === 'function') {
        try { renderBiannian(); } catch (_) {}
      }
      return { ok: true, merged: merged };
    });
  },

  /** 标记已读 */
  markRead: function(year) {
    if (ChronicleSystem.yearChronicles[year]) {
      ChronicleSystem.yearChronicles[year].read = true;
    }
  },

  /** 序列化（存档用） */
  serialize: function(targetGM) {
    return _chronicleCloneState(_chronicleState(targetGM, false));
  },

  /** 反序列化（读档用） */
  deserialize: function(data, targetGM) {
    var owner = targetGM || ((typeof GM !== 'undefined' && GM) ? GM : null);
    var next = _chronicleCloneState(data);
    if (owner) owner._chronicleSysState = next;
    else _chronicleDetachedState = next;
    return next;
  },

  /** 重置 */
  reset: function(targetGM) {
    return ChronicleSystem.deserialize(null, targetGM);
  }
};
