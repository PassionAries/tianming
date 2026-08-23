// tm-number-parser.js — shared, deterministic Chinese quantity parsing.
(function (root) {
  'use strict';

  var DIGITS = {
    '零': 0, '〇': 0,
    '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
    '壹': 1, '贰': 2, '叁': 3, '肆': 4, '伍': 5,
    '陆': 6, '柒': 7, '捌': 8, '玖': 9
  };
  var SMALL_UNITS = {
    '十': 10, '拾': 10,
    '百': 100, '佰': 100,
    '千': 1000, '仟': 1000
  };
  var LARGE_UNITS = {
    '万': 10000, '萬': 10000,
    '亿': 100000000, '億': 100000000
  };
  var NUMBER_CHARS = '0-9零〇一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟萬億';
  var MEASURE_LABELS = '贯两文石人名丁口户兵卒骑匹斛斗';
  var EXCLUDED_SUFFIXES = /^(?:年|成|州|道|号|案|届|次|章|条|诏|税率)/;
  var ACTION_CONTEXT = /(?:征兵|募兵|招募|募|调银|拨银|拨粮|下拨|移民|迁民|安置|徙民|发徭役|征发|发行|增发|拨发|调拨|赈济|给付|支给|铸造|铸钱)/;

  function _failure(reason, details) {
    var out = { ok: false, reason: reason };
    if (details) out.details = details;
    return out;
  }

  function _finiteLimit(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  function parseNumber(expression, options) {
    options = options || {};
    var max = _finiteLimit(options.max, 1000000000000);
    var raw = String(expression == null ? '' : expression).replace(/[\s,，]/g, '');
    if (!raw) return _failure('empty');

    var arabic = raw.match(/^(\d+(?:\.\d+)?)([十百千万亿萬億]?)$/);
    if (arabic) {
      var numeric = Number(arabic[1]);
      var unit = arabic[2];
      var multiplier = unit === '十' ? 10
        : unit === '百' ? 100
        : unit === '千' ? 1000
        : (unit === '万' || unit === '萬') ? 10000
        : (unit === '亿' || unit === '億') ? 100000000
        : 1;
      var arabicValue = numeric * multiplier;
      if (!Number.isFinite(arabicValue) || arabicValue < 0 || arabicValue > max || !Number.isSafeInteger(Math.round(arabicValue))) {
        return _failure('out-of-range');
      }
      return { ok: true, value: Math.round(arabicValue), normalized: raw };
    }

    if (!(new RegExp('^[' + NUMBER_CHARS.replace('0-9', '') + ']+$')).test(raw)) {
      return _failure('invalid-character');
    }

    var total = 0;
    var section = 0;
    var number = null;
    var previousWasDigit = false;
    var lastSmallUnit = Infinity;
    var lastLargeUnit = Infinity;
    for (var i = 0; i < raw.length; i++) {
      var ch = raw.charAt(i);
      if (Object.prototype.hasOwnProperty.call(DIGITS, ch)) {
        number = previousWasDigit ? ((number || 0) * 10 + DIGITS[ch]) : DIGITS[ch];
        previousWasDigit = true;
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(SMALL_UNITS, ch)) {
        var small = SMALL_UNITS[ch];
        if (small >= lastSmallUnit) return _failure('ambiguous-unit-order');
        section += (number == null || number === 0 ? 1 : number) * small;
        number = null;
        previousWasDigit = false;
        lastSmallUnit = small;
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(LARGE_UNITS, ch)) {
        var large = LARGE_UNITS[ch];
        if (large >= lastLargeUnit) return _failure('ambiguous-unit-order');
        section += number == null ? 0 : number;
        if (section === 0) section = 1;
        total += section * large;
        section = 0;
        number = null;
        previousWasDigit = false;
        lastSmallUnit = Infinity;
        lastLargeUnit = large;
        continue;
      }
      return _failure('invalid-character');
    }

    var value = total + section + (number == null ? 0 : number);
    if (!Number.isFinite(value) || value < 0 || value > max || !Number.isSafeInteger(value)) {
      return _failure('out-of-range');
    }
    return { ok: true, value: value, normalized: raw };
  }

  function extractEdictQuantity(text, options) {
    options = options || {};
    var source = String(text == null ? '' : text);
    var max = _finiteLimit(options.max, 1000000000000);
    var tokenRx = new RegExp('(?:\\d+(?:\\.\\d+)?(?:[十百千万亿萬億])?|[' + NUMBER_CHARS.replace('0-9', '') + ']+)', 'g');
    var candidates = [];
    var match;
    while ((match = tokenRx.exec(source)) !== null) {
      var token = match[0];
      var before = source.slice(Math.max(0, match.index - 18), match.index);
      var after = source.slice(match.index + token.length);
      var measure = after.charAt(0);
      var hasMeasure = !!measure && MEASURE_LABELS.indexOf(measure) >= 0;
      var hasAction = ACTION_CONTEXT.test(before);
      // “两”既是数字二，也是银两计量标签。位于完整数词末尾时按标签处理。
      if (!hasMeasure && hasAction && token.length > 1 && token.charAt(token.length - 1) === '两') {
        token = token.slice(0, -1);
        measure = '两';
        hasMeasure = true;
      }
      if (/第$/.test(before) || EXCLUDED_SUFFIXES.test(after)) continue;
      if (!hasMeasure && !hasAction) continue;

      var parsed = parseNumber(token, { max: max });
      if (!parsed.ok) {
        return _failure(parsed.reason, { token: token, index: match.index });
      }
      candidates.push({
        value: parsed.value,
        token: token,
        index: match.index,
        measure: hasMeasure ? measure : '',
        score: (hasMeasure ? 100 : 0) + (hasAction ? 50 : 0)
      });
    }

    if (!candidates.length) return _failure('not-found');
    var bestScore = Math.max.apply(Math, candidates.map(function (item) { return item.score; }));
    var best = candidates.filter(function (item) { return item.score === bestScore; });
    var values = {};
    best.forEach(function (item) { values[String(item.value)] = true; });
    if (Object.keys(values).length !== 1) {
      return _failure('ambiguous', { candidates: best });
    }
    return {
      ok: true,
      value: best[0].value,
      token: best[0].token,
      measure: best[0].measure,
      index: best[0].index
    };
  }

  root.TMNumberParser = {
    parseNumber: parseNumber,
    extractEdictQuantity: extractEdictQuantity
  };
})(typeof window !== 'undefined' ? window : globalThis);
