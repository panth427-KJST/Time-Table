/* =====================================================================
   FakeGAS — จำลอง Google Apps Script services แบบย่อ (Spreadsheet/Cache/Lock/Properties/Utilities/...)
   ใช้สำหรับ (1) โหมดทดลองในเบราว์เซอร์ (2) ทดสอบอัตโนมัติด้วย Node
   ไม่ได้ใช้ในระบบจริงบน Google
   ===================================================================== */
var FakeGAS = (function () {
  'use strict';
  /* ---------- SHA-256 (สำหรับทดสอบรหัสผ่านแบบ hash) ---------- */
  function utf8(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.codePointAt(i); if (c > 0xffff) i++;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | c >> 6, 0x80 | c & 63);
      else if (c < 0x10000) out.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
      else out.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    }
    return out;
  }
  function sha256(bytes) {
    var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var m = bytes.slice(), l = bytes.length * 8;
    m.push(0x80); while (m.length % 64 !== 56) m.push(0);
    for (var s = 7; s >= 0; s--) m.push(s >= 4 ? 0 : (l >>> (s * 8)) & 255);
    var w = new Array(64), r = function (x, n) { return (x >>> n) | (x << (32 - n)); };
    for (var o = 0; o < m.length; o += 64) {
      for (var i = 0; i < 16; i++) w[i] = (m[o + 4 * i] << 24) | (m[o + 4 * i + 1] << 16) | (m[o + 4 * i + 2] << 8) | m[o + 4 * i + 3];
      for (i = 16; i < 64; i++) {
        var s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        var t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H = [H[0] + a, H[1] + b, H[2] + c, H[3] + d, H[4] + e, H[5] + f, H[6] + g, H[7] + h].map(function (x) { return x | 0; });
    }
    var out = [];
    H.forEach(function (x) { for (var k = 3; k >= 0; k--) { var v = (x >>> (k * 8)) & 255; out.push(v > 127 ? v - 256 : v); } });
    return out;
  }
  function bytesOf(v) { return typeof v === 'string' ? utf8(v) : v.map(function (b) { return (b + 256) % 256; }); }
  function unsign(a) { return a.map(function (b) { return (b + 256) % 256; }); }
  function hmac256(msg, key) {
    var k = bytesOf(key), m = bytesOf(msg);
    if (k.length > 64) k = unsign(sha256(k));
    while (k.length < 64) k = k.concat([0]);
    var ip = k.map(function (b) { return b ^ 0x36; }), op = k.map(function (b) { return b ^ 0x5c; });
    return sha256(op.concat(unsign(sha256(ip.concat(m)))));
  }
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64enc(bytes) {
    var s = '', u = bytes.map(function (b) { return (b + 256) % 256; });
    for (var i = 0; i < u.length; i += 3) {
      var n = (u[i] << 16) | ((u[i + 1] || 0) << 8) | (u[i + 2] || 0);
      s += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (i + 1 < u.length ? B64[n >> 6 & 63] : '=') + (i + 2 < u.length ? B64[n & 63] : '=');
    }
    return s;
  }

  function create(opts) {
    opts = opts || {};
    var state = (opts.load && opts.load()) || { books: {}, props: {}, cache: {}, active: 'DB', mails: [], files: 0 };
    var nowFn = opts.now || function () { return Date.now(); };
    function persist() { if (opts.save) opts.save(state); }

    function book(id) { if (!state.books[id]) throw new Error('ไม่พบไฟล์ Spreadsheet: ' + id); return state.books[id]; }
    function Range(rows, r, c, nr, nc) {
      return {
        getValues: function () {
          var out = [];
          for (var i = 0; i < nr; i++) { var row = rows[r - 1 + i] || [], o = []; for (var j = 0; j < nc; j++) o.push(row[c - 1 + j] == null ? '' : row[c - 1 + j]); out.push(o); }
          return out;
        },
        setValues: function (v) {
          for (var i = 0; i < v.length; i++) { var ri = r - 1 + i; rows[ri] = rows[ri] || []; for (var j = 0; j < v[i].length; j++) rows[ri][c - 1 + j] = v[i][j]; }
          return this;
        },
        setNumberFormat: function () { return this; }, setFontWeight: function () { return this; }, setBackground: function () { return this; }
      };
    }
    function Sheet(b, name) {
      var rows = function () { return b.sheets[name]; };
      var lastRow = function () { var d = rows(), n = d.length; while (n && !(d[n - 1] || []).some(function (x) { return x !== '' && x != null; })) n--; return n; };
      var lastCol = function () { return rows().reduce(function (m, r) { return Math.max(m, (r || []).length); }, 0); };
      return {
        getName: function () { return name; },
        getLastRow: lastRow, getLastColumn: lastCol,
        getRange: function (r, c, nr, nc) { return Range(rows(), r, c, nr || 1, nc || 1); },
        getDataRange: function () { return Range(rows(), 1, 1, Math.max(1, lastRow()), Math.max(1, lastCol())); },
        appendRow: function (a) { var d = rows(); d.splice(lastRow(), d.length - lastRow(), a.slice()); return this; },
        clearContents: function () { b.sheets[name] = []; return this; },
        clear: function () { b.sheets[name] = []; return this; },
        setFrozenRows: function () { return this; }
      };
    }
    function Book(id) {
      var b = book(id);
      return {
        getId: function () { return id; }, getUrl: function () { return '#sheet-' + id; },
        getSheetByName: function (n) { return b.sheets[n] ? Sheet(b, n) : null; },
        insertSheet: function (n) { if (b.sheets[n]) throw new Error('มีชีตชื่อนี้แล้ว'); b.sheets[n] = []; return Sheet(b, n); },
        getSheets: function () { return Object.keys(b.sheets).map(function (n) { return Sheet(b, n); }); },
        deleteSheet: function (s) { delete b.sheets[s.getName()]; },
        setSpreadsheetTimeZone: function () {}
      };
    }
    var cache = {
      get: function (k) { var e = state.cache[k]; if (!e) return null; if (e.x < nowFn()) { delete state.cache[k]; return null; } return e.v; },
      put: function (k, v, sec) { state.cache[k] = { v: String(v), x: nowFn() + (sec || 600) * 1000 }; },
      remove: function (k) { delete state.cache[k]; }
    };
    function fmt(date, tz, f) {
      var d = new Date(date.getTime() + 7 * 3600 * 1000), p = function (n) { return (n < 10 ? '0' : '') + n; };
      return f.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss/g, function (m, q) {
        if (q != null) return q;
        return { yyyy: d.getUTCFullYear(), MM: p(d.getUTCMonth() + 1), dd: p(d.getUTCDate()), HH: p(d.getUTCHours()), mm: p(d.getUTCMinutes()), ss: p(d.getUTCSeconds()) }[m];
      });
    }
    var G = {
      SpreadsheetApp: {
        getActiveSpreadsheet: function () { return Book(state.active); },
        openById: function (id) { return Book(id); }
      },
      CacheService: { getScriptCache: function () { return cache; } },
      LockService: { getScriptLock: function () { return { tryLock: function () { return true; }, waitLock: function () {}, releaseLock: function () {} }; } },
      PropertiesService: { getScriptProperties: function () {
        return { getProperty: function (k) { return state.props[k] == null ? null : state.props[k]; }, setProperty: function (k, v) { state.props[k] = String(v); } };
      } },
      Utilities: {
        DigestAlgorithm: { SHA_256: 'SHA_256', MD5: 'MD5' }, Charset: { UTF_8: 'UTF_8' },
        formatDate: fmt,
        getUuid: function () { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }); },
        computeDigest: function (alg, s) { if (alg === 'SHA_256') return sha256(utf8(String(s))); return []; },
        computeHmacSha256Signature: function (value, key) { return hmac256(value, key); },
        base64Encode: b64enc,
        base64Decode: function () { return []; },
        newBlob: function (data, mime, name) { return { name: name, getBytes: function () { return (typeof data === 'string' ? utf8(data) : data).map(function (b) { return b > 127 ? b - 256 : b; }); } }; }
      },
      HtmlService: {
        createHtmlOutputFromFile: function (n) { return { getContent: function () { return (opts.files || {})[n]; } }; },
        XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' }
      },
      DriveApp: {
        getFolderById: function (id) { return folder(id); }, createFolder: function () { return folder('FOLDER'); },
        getFileById: function () { var done = false; return { getParents: function () { return { hasNext: function () { return !done; }, next: function () { done = true; return { createFolder: function () { return folder('SUB'); } }; } }; } }; }
      },
      MailApp: { sendEmail: function (m) { state.mails.push(m); } },
      ScriptApp: { getService: function () { return { getUrl: function () { return '#'; } }; } },
      Session: { getScriptTimeZone: function () { return 'Asia/Bangkok'; } },
      Logger: { log: function (m) { (opts.log || function () {})(m); } }
    };
    function folder(id) {
      return { getId: function () { return id; }, createFolder: function () { return folder('SUB'); }, createFile: function (blob) {
        state.files++; var n = blob.name;
        return { getName: function () { return n; }, getUrl: function () { return '#file-' + state.files; } };
      } };
    }
    return {
      globals: G, state: state, persist: persist,
      addBook: function (id, sheets) { state.books[id] = { sheets: sheets || {} }; },
      hasBook: function (id) { return !!state.books[id]; },
      sha256hex: function (s) { return sha256(utf8(s)).map(function (b) { var h = ((b + 256) % 256).toString(16); return h.length < 2 ? '0' + h : h; }).join(''); }
    };
  }

  /* google.script.run จำลอง: เรียกฟังก์ชัน server ในหน้าเดียวกันแบบ async */
  function makeRun(api, after, delay) {
    function builder(ok, fail) {
      var o = {
        withSuccessHandler: function (h) { return builder(h, fail); },
        withFailureHandler: function (h) { return builder(ok, h); },
        withUserObject: function () { return builder(ok, fail); }
      };
      return new Proxy(o, { get: function (t, k) {
        if (k in t) return t[k];
        return function () {
          var args = JSON.parse(JSON.stringify(Array.prototype.slice.call(arguments)));
          setTimeout(function () {
            var res;
            try {
              if (typeof api[k] !== 'function') throw new Error('Script function not found: ' + String(k));
              res = api[k].apply(null, args);
              if (after) after();
            } catch (e) { if (fail) return fail(e); throw e; }
            if (ok) ok(res === undefined ? null : JSON.parse(JSON.stringify(res)));
          }, delay == null ? 80 : delay);
        };
      } });
    }
    return builder(null, null);
  }
  return { create: create, makeRun: makeRun };
})();
if (typeof module !== 'undefined') module.exports = FakeGAS;
