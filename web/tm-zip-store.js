// 极简 ZIP 构建器（store/不压缩）。立绘 PNG / 音频 OGG 本已压缩，store 最合适。
// 浏览器：window.TMZipStore；node：module.exports（便于测试）。无第三方依赖。
(function(root){
  'use strict';
  var CRC_T = (function(){ var t = [], c, n, k; for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
  function crc32(buf){ var c = 0xFFFFFFFF; for (var i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function strBytes(s){
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    var b = []; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (c < 128) b.push(c); else if (c < 2048) { b.push(192 | (c >> 6), 128 | (c & 63)); } else { b.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } }
    return new Uint8Array(b);
  }
  function u16(n){ return new Uint8Array([n & 255, (n >> 8) & 255]); }
  function u32(n){ return new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]); }

  // entries: [{ name:String, data:Uint8Array }] → Uint8Array(zip)
  function buildZip(entries){
    var parts = [], central = [], offset = 0;
    entries.forEach(function(e){
      var name = strBytes(e.name), data = e.data, crc = crc32(data);
      [u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0)].forEach(function(p){ parts.push(p); });
      parts.push(name); parts.push(data);
      central.push([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]);
      offset += 30 + name.length + data.length;
    });
    var cdStart = offset, cdParts = [];
    central.forEach(function(row){ row.forEach(function(p){ cdParts.push(p); }); });
    var cdLen = cdParts.reduce(function(a, p){ return a + p.length; }, 0);
    var eocd = [u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cdLen), u32(cdStart), u16(0)];
    var all = parts.concat(cdParts).concat(eocd);
    var total = all.reduce(function(a, p){ return a + p.length; }, 0);
    var out = new Uint8Array(total), pos = 0;
    all.forEach(function(p){ out.set(p, pos); pos += p.length; });
    return out;
  }

  function bytesToBase64(bytes){
    if (typeof btoa === 'undefined' && typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    var bin = '', chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(bin);
  }

  function strFromBytes(b){
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(b);
    var s = '', i = 0;
    while (i < b.length) { var c = b[i]; if (c < 128) { s += String.fromCharCode(c); i += 1; } else if (c < 224) { s += String.fromCharCode(((c & 31) << 6) | (b[i + 1] & 63)); i += 2; } else { s += String.fromCharCode(((c & 15) << 12) | ((b[i + 1] & 63) << 6) | (b[i + 2] & 63)); i += 3; } }
    return s;
  }
  function rd16(b, o){ return b[o] | (b[o + 1] << 8); }
  function rd32(b, o){ return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  // 批Ⅴ(2026-07-22)·STORE zip 解析器：解本构建器（及任何 store 法）打的包——网页/安卓端
  // 装资产包用。压缩条目(method≠0)直接明说拒解（工坊网页发布一律 store·外部压缩包请走桌面版）。
  // bytes: Uint8Array(zip) → [{ name:String, data:Uint8Array }]
  function parseZip(bytes){
    if (!(bytes && bytes.length > 22)) throw new Error('zip 数据过短');
    // 从尾部找 EOCD（容许 comment·最多回扫 64KB+22）
    var eocd = -1, lo = Math.max(0, bytes.length - 65558);
    for (var i = bytes.length - 22; i >= lo; i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 zip（未找到目录尾）');
    var count = rd16(bytes, eocd + 10), cdOfs = rd32(bytes, eocd + 16);
    var out = [], p = cdOfs;
    for (var n = 0; n < count; n++) {
      if (rd32(bytes, p) !== 0x02014b50) throw new Error('zip 中央目录损坏');
      var method = rd16(bytes, p + 10);
      var csize = rd32(bytes, p + 20), usize = rd32(bytes, p + 24);
      var nlen = rd16(bytes, p + 28), elen = rd16(bytes, p + 30), clen = rd16(bytes, p + 32);
      var lofs = rd32(bytes, p + 42);
      var name = strFromBytes(bytes.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + elen + clen;
      if (name.slice(-1) === '/') continue; // 目录条目
      if (name.indexOf('..') >= 0) throw new Error('zip 含越界路径: ' + name);
      if (method !== 0) throw new Error('仅支持 store（不压缩）zip——工坊网页发布的包即是；外部压缩包请用桌面版安装');
      // 局部头：跳过其 name/extra（长度可能与中央目录不同·以局部头为准）
      if (rd32(bytes, lofs) !== 0x04034b50) throw new Error('zip 局部头损坏: ' + name);
      var lnlen = rd16(bytes, lofs + 26), lelen = rd16(bytes, lofs + 28);
      var dstart = lofs + 30 + lnlen + lelen;
      var data = bytes.slice(dstart, dstart + (csize || usize));
      if (crc32(data) !== rd32(bytes, p - nlen - elen - clen - 46 + 16)) throw new Error('zip 校验不符: ' + name);
      out.push({ name: name, data: data });
    }
    return out;
  }

  // B1（工坊全链修缮·批B）：把散文件按「商店分类」归一成一个 store-zip 投稿包的计划——
  // 纯函数（不碰 DOM/state），产出 manifest + 各文件包内落位 + 守门信息，供页内打包器消费。
  // 与 buildZip 同居本模块（工坊包 (de)序列化原语）：mod=混合资产组合包（图片落 portraits/、
  // 音频落 music/·与 mod 立绘/音乐识别约定对齐）；单类型包平铺；scenario/map 补 entry 指向首个
  // JSON。文件名去路径 + 非法字符清洗 + 同名去重。fileMetas=[{ name, size, index }]。
  var LOOSE_MAX_SINGLE = 20 * 1024 * 1024;   // 单文件醒目提示阈值
  var LOOSE_MAX_TOTAL = 60 * 1024 * 1024;    // 总量硬闸（网页安装端上限约 64MB）
  function planLoosePack(type, title, version, description, fileMetas) {
    type = String(type || 'mod');
    var IMG = /\.(png|jpe?g|webp|bmp)$/i, AUD = /\.(mp3|ogg|wav)$/i, JSN = /\.(geo)?json$/i;
    var OK = /\.(png|jpe?g|webp|bmp|mp3|ogg|wav|json|geojson|md|txt|csv|glb|gltf)$/i;
    function clean(name) {
      var b = String(name == null ? '' : name).replace(/^.*[\/\\]/, '');           // 去路径
      b = b.replace(/[\x00-\x1f<>:"|?*\/\\]+/g, '_').replace(/\s+/g, ' ').trim();   // 非法字符清洗
      return b || 'file';
    }
    function slugify(s) {
      return String(s == null ? '' : s).trim().toLowerCase().replace(/[^a-z0-9_\-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    }
    function targetPath(cleanName) {
      if (type === 'mod') {
        if (IMG.test(cleanName)) return 'portraits/' + cleanName;
        if (AUD.test(cleanName)) return 'music/' + cleanName;
        return cleanName;
      }
      return cleanName;                                                            // 单类型包平铺
    }
    function assetKind(cleanName) {
      if (IMG.test(cleanName)) return 'portrait';
      if (AUD.test(cleanName)) return 'music';
      if (JSN.test(cleanName)) return (type === 'map' ? 'map' : 'data');
      return 'file';
    }
    var slug = slugify(title) || ('pack-' + Date.now().toString(36).slice(-6));
    var targets = [], assets = [], skipped = [], oversize = [], seen = {}, total = 0;
    (fileMetas || []).forEach(function (fm) {
      var raw = clean(fm && fm.name);
      if (!OK.test(raw)) { skipped.push(raw); return; }
      var size = Number(fm && fm.size) || 0;
      total += size;
      if (size > LOOSE_MAX_SINGLE) oversize.push(raw);
      var p = targetPath(raw), uniq = p, n = 2;
      while (seen[uniq]) { uniq = p.replace(/(\.[^.\/]+)?$/, '-' + n + '$1'); n++; } // 同名去重
      seen[uniq] = true;
      targets.push({ path: uniq, index: (fm && fm.index != null) ? fm.index : targets.length, size: size });
      assets.push({ name: raw.replace(/\.[^.]+$/, ''), file: uniq, type: assetKind(raw) });
    });
    var entry = '';
    for (var i = 0; i < targets.length; i++) { if (JSN.test(targets[i].path)) { entry = targets[i].path; break; } }
    var manifest = {
      id: slug,
      title: String(title == null ? '' : title).trim() || slug,
      type: type,
      version: String(version == null ? '' : version).trim() || '1.0.0',
      description: String(description == null ? '' : description).trim(),
      files: targets.map(function (t) { return t.path; }),
      assets: assets
    };
    if (type === 'scenario' || type === 'map') manifest.entry = entry || (targets[0] && targets[0].path) || '';
    return { slug: slug, manifest: manifest, targets: targets, assets: assets, skipped: skipped, oversize: oversize, totalSize: total };
  }

  var api = { buildZip: buildZip, bytesToBase64: bytesToBase64, parseZip: parseZip, crc32: crc32,
    planLoosePack: planLoosePack, LOOSE_MAX_SINGLE: LOOSE_MAX_SINGLE, LOOSE_MAX_TOTAL: LOOSE_MAX_TOTAL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TMZipStore = api;
})(typeof window !== 'undefined' ? window : null);
