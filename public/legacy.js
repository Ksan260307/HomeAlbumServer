// 古いブラウザ (Fire OS 4 の Silk = Chrome 81 相当 など) 向けの補い
// どのブラウザでも読めるよう、このファイルだけは古い書き方 (var・function) で書いている
(function () {
  'use strict';

  // ---- canvas の角丸四角形 (Chrome 99 より前にはない) ----
  var C2D = window.CanvasRenderingContext2D;
  if (C2D && !C2D.prototype.roundRect) {
    C2D.prototype.roundRect = function (x, y, w, h, radii) {
      var r = typeof radii === 'number' ? radii : (radii && radii.length ? radii[0] : 0) || 0;
      r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
      this.moveTo(x + r, y);
      this.arcTo(x + w, y, x + w, y + h, r);
      this.arcTo(x + w, y + h, x, y + h, r);
      this.arcTo(x, y + h, x, y, r);
      this.arcTo(x, y, x + w, y, r);
      this.closePath();
    };
  }

  // ---- 古いブラウザにない便利な関数を足す ----
  function define(obj, name, fn) {
    if (obj && !obj[name]) Object.defineProperty(obj, name, { value: fn, configurable: true, writable: true });
  }

  define(Object, 'values', function (o) { return Object.keys(o).map(function (k) { return o[k]; }); });
  define(Object, 'entries', function (o) { return Object.keys(o).map(function (k) { return [k, o[k]]; }); });
  define(Object, 'fromEntries', function (list) {
    var out = {};
    Array.from(list, function (e) { out[e[0]] = e[1]; });
    return out;
  });
  define(Array.prototype, 'includes', function (v, from) {
    for (var i = from || 0; i < this.length; i++) {
      if (this[i] === v || (v !== v && this[i] !== this[i])) return true;
    }
    return false;
  });
  define(Array.prototype, 'flat', function (depth) {
    var d = depth === undefined ? 1 : depth;
    return this.reduce(function (acc, v) {
      return acc.concat(Array.isArray(v) && d > 0 ? v.flat(d - 1) : [v]);
    }, []);
  });
  define(Array.prototype, 'flatMap', function (fn, self) { return this.map(fn, self).flat(1); });
  function pad(str, len, fill, atStart) {
    var s = String(str);
    var f = fill === undefined ? ' ' : String(fill);
    if (s.length >= len || !f) return s;
    var add = '';
    while (add.length < len - s.length) add += f;
    add = add.slice(0, len - s.length);
    return atStart ? add + s : s + add;
  }
  define(String.prototype, 'padStart', function (len, fill) { return pad(this, len, fill, true); });
  define(String.prototype, 'padEnd', function (len, fill) { return pad(this, len, fill, false); });
  if (window.NodeList) define(NodeList.prototype, 'forEach', Array.prototype.forEach);
  if (window.Promise) {
    define(Promise.prototype, 'finally', function (fn) {
      return this.then(
        function (v) { return Promise.resolve(fn()).then(function () { return v; }); },
        function (e) { return Promise.resolve(fn()).then(function () { throw e; }); }
      );
    });
  }

  // append / prepend (Chrome 54 より前にはない)
  function toNode(v) { return v instanceof Node ? v : document.createTextNode(String(v)); }
  [Element.prototype, Document.prototype, DocumentFragment.prototype].forEach(function (proto) {
    define(proto, 'append', function () {
      for (var i = 0; i < arguments.length; i++) this.appendChild(toNode(arguments[i]));
    });
    define(proto, 'prepend', function () {
      var first = this.firstChild;
      for (var i = 0; i < arguments.length; i++) this.insertBefore(toNode(arguments[i]), first);
    });
  });

  // URLSearchParams にオブジェクトを渡す使い方 (Chrome 61 より前は効かない)
  var USP = window.URLSearchParams;
  if (USP) {
    var recordOk = false;
    try { recordOk = new USP({ a: '1' }).get('a') === '1'; } catch (e) { /* 効かない */ }
    if (!recordOk) {
      var Wrapped = function (init) {
        if (init && typeof init === 'object' && !(init instanceof USP)) {
          var p = new USP();
          Object.keys(init).forEach(function (k) { p.append(k, init[k]); });
          return p;
        }
        return new USP(init);
      };
      Wrapped.prototype = USP.prototype;
      window.URLSearchParams = Wrapped;
    }
  }

  // 全画面表示 (Chrome 71 より前は webkit 付きの名前)
  var docProto = Document.prototype;
  if (!('fullscreenElement' in document) && 'webkitFullscreenElement' in document) {
    Object.defineProperty(docProto, 'fullscreenElement', { get: function () { return this.webkitFullscreenElement; }, configurable: true });
    Object.defineProperty(docProto, 'fullscreenEnabled', { get: function () { return this.webkitFullscreenEnabled; }, configurable: true });
    define(docProto, 'exitFullscreen', function () {
      if (this.webkitExitFullscreen) this.webkitExitFullscreen();
      return Promise.resolve();
    });
    define(Element.prototype, 'requestFullscreen', function () {
      if (this.webkitRequestFullscreen) this.webkitRequestFullscreen();
      return Promise.resolve();
    });
    document.addEventListener('webkitfullscreenchange', function () {
      var ev = document.createEvent('Event');
      ev.initEvent('fullscreenchange', true, false);
      document.dispatchEvent(ev);
    });
  }

  // 画面に入ったかを調べる仕組み (Chrome 58 より前にはない) — 定期的に位置を確かめる簡易版
  if (!window.IntersectionObserver) {
    var observers = [];
    var checkAll = function () { observers.forEach(function (o) { o._check(); }); };
    var SimpleIO = function (callback, options) {
      this._cb = callback;
      this._root = (options && options.root) || null;
      this._margin = parseFloat((options && options.rootMargin) || '0') || 0;
      this._targets = [];
    };
    SimpleIO.prototype.observe = function (el) {
      if (!this._targets.some(function (t) { return t.el === el; })) this._targets.push({ el: el, last: null });
      if (observers.indexOf(this) < 0) observers.push(this);
      var self = this;
      setTimeout(function () { self._check(); }, 0);
    };
    SimpleIO.prototype.unobserve = function (el) {
      this._targets = this._targets.filter(function (t) { return t.el !== el; });
    };
    SimpleIO.prototype.disconnect = function () {
      this._targets = [];
      var i = observers.indexOf(this);
      if (i >= 0) observers.splice(i, 1);
    };
    SimpleIO.prototype._check = function () {
      var m = this._margin;
      var rr = this._root ? this._root.getBoundingClientRect()
        : { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth };
      var entries = [];
      this._targets.forEach(function (t) {
        var r = t.el.getBoundingClientRect();
        var shown = !!t.el.offsetParent || r.width > 0 || r.height > 0;
        var hit = shown && r.bottom >= rr.top - m && r.top <= rr.bottom + m && r.right >= rr.left - m && r.left <= rr.right + m;
        if (hit !== t.last) {
          t.last = hit;
          entries.push({ target: t.el, isIntersecting: hit, intersectionRatio: hit ? 1 : 0, boundingClientRect: r });
        }
      });
      if (entries.length) this._cb(entries, this);
    };
    window.IntersectionObserver = SimpleIO;
    document.addEventListener('scroll', checkAll, true);
    window.addEventListener('resize', checkAll);
    setInterval(checkAll, 400);
  }

  // ---- フレックスボックスの gap (Chrome 84 より前は効かない) ----
  // 効かないブラウザでは、gap の値を子要素の余白 (margin) に置き換える
  function supportsFlexGap() {
    var box = document.createElement('div');
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.rowGap = '1px';
    box.appendChild(document.createElement('div'));
    box.appendChild(document.createElement('div'));
    document.documentElement.appendChild(box);
    var ok = box.scrollHeight === 1;
    box.parentNode.removeChild(box);
    return ok;
  }

  function gapSelectors() {
    var list = ['[style*="gap"]'];
    function walk(rules) {
      for (var i = 0; i < rules.length; i++) {
        var rule = rules[i];
        if (rule.cssRules) walk(rule.cssRules);
        var st = rule.style;
        if (st && rule.selectorText && (st.columnGap || st.rowGap || st.getPropertyValue('gap') || st.getPropertyValue('grid-gap'))) list.push(rule.selectorText);
      }
    }
    for (var i = 0; i < document.styleSheets.length; i++) {
      try { walk(document.styleSheets[i].cssRules); } catch (e) { /* 読めないスタイルシートは飛ばす */ }
    }
    return list.join(',');
  }

  function px(v) {
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  // CSS で余白が指定されている子要素 (margin-left: auto など) には手を付けない
  function setMargin(el, prop, value) {
    if (el.getAttribute('data-gapfix') !== '1' && px(getComputedStyle(el)[prop]) !== 0) return;
    el.style[prop] = value ? value + 'px' : '';
    el.setAttribute('data-gapfix', '1');
  }

  function startFlexGapFix(force) {
    if (!force && supportsFlexGap()) return;
    document.documentElement.className += ' no-flexgap';
    var selector = gapSelectors();
    var scheduled = false;

    function fix() {
      scheduled = false;
      var boxes = document.querySelectorAll(selector);
      for (var i = 0; i < boxes.length; i++) {
        var box = boxes[i];
        var cs = getComputedStyle(box);
        if (cs.display !== 'flex' && cs.display !== 'inline-flex') continue;
        // Chrome 66 より前は gap が読めないので、同じ値を書いた grid-gap から読む
        var colGap = px(cs.columnGap) || px(cs.gridColumnGap);
        var rowGap = px(cs.rowGap) || px(cs.gridRowGap);
        if (!colGap && !rowGap) continue;
        var column = cs.flexDirection.indexOf('column') === 0;
        var wrap = cs.flexWrap !== 'nowrap';
        var first = true;
        for (var c = box.firstElementChild; c; c = c.nextElementSibling) {
          var ccs = getComputedStyle(c);
          if (ccs.display === 'none' || ccs.position === 'absolute' || ccs.position === 'fixed') continue;
          if (wrap) {
            // 折り返す並びは、右と下に余白を付ける
            setMargin(c, 'marginRight', colGap);
            setMargin(c, 'marginBottom', rowGap);
          } else {
            setMargin(c, column ? 'marginTop' : 'marginLeft', first ? 0 : (column ? rowGap : colGap));
          }
          first = false;
        }
      }
    }

    function schedule() {
      if (scheduled) return;
      scheduled = true;
      setTimeout(fix, 30);
    }

    fix();
    new MutationObserver(schedule).observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'open'],
    });
    window.addEventListener('resize', schedule);
  }

  function init() {
    // ?legacy=1 で、新しいブラウザでも補いを試せる (動作確認用)
    startFlexGapFix(/[?&]legacy=1/.test(location.search));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
