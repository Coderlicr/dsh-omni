// Lightweight runtime translator for the local console.
//
// The console is a single 300 KB Chinese page (plus experience.js), and most of
// its copy is generated dynamically. Rather than duplicating the whole app we
// keep one dictionary (i18n.en.json) and translate text nodes/attributes after
// render, plus a MutationObserver for the 3-second refresh cycles.
//
// Scope: this is a UI translation layer, not a data translator. It only replaces
// nodes whose whole trimmed text matches a dictionary key, so chat logs, group
// names, tokens and user content are left alone. Unknown strings fall back to
// Chinese instead of turning into half-English sentences.
(function () {
  var DICT_URL = '/console-assets/i18n.en.json';
  var STORAGE_KEY = 'qq-console-lang';
  var params = new URLSearchParams(location.search);
  var queryLang = params.get('lang');
  var saved = '';
  try { saved = localStorage.getItem(STORAGE_KEY) || ''; } catch (error) {}
  var lang = (queryLang === 'en' || queryLang === 'zh') ? queryLang : (saved === 'en' ? 'en' : 'zh');
  if (queryLang === 'en' || queryLang === 'zh') {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (error) {}
  }

  var root = document.documentElement;
  var button = document.getElementById('langToggle');

  function paintButton() {
    if (!button) return;
    var isEn = root.lang === 'en';
    button.textContent = isEn ? '中文' : 'EN';
    button.setAttribute('aria-label', isEn ? '切换到中文' : 'Switch to English');
    button.title = isEn ? '切换到中文' : 'Switch to English';
  }

  if (button) {
    button.addEventListener('click', function () {
      var next = root.lang === 'en' ? 'zh' : 'en';
      try { localStorage.setItem(STORAGE_KEY, next); } catch (error) {}
      var url = new URL(location.href);
      url.searchParams.set('lang', next);
      location.href = url.toString();
    });
  }

  if (lang !== 'en') {
    paintButton();
    return;
  }
  root.lang = 'en';

  var dict = null;
  var SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'PRE', 'CODE', 'KBD', 'SAMP']);
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  var CJK = /[\u4e00-\u9fff]/;
  var PATTERNS = [
    [/^管理员 (.+) · (\d+) 个白名单群 · (\d+) 位白名单好友$/, 'Admin $1 · $2 allowlisted groups · $3 allowlisted friends'],
    [/^状态同步于 (.+)$/, 'Synced at $1'],
    [/^(.+) 个会话$/, '$1 sessions'],
    [/^基础机会 (\d+)% · 偶尔主动找话题$/, 'Base chance $1% · occasionally starts a topic'],
    [/^摘要缓冲: (.+)$/, 'Summary buffer: $1'],
    [/^状态: (.+)$/, 'Status: $1'],
    [/^(.*) · dsh-omni 控制台$/, '$1 · dsh-omni Console']
  ];

  function normalize(value) {
    return String(value).replace(/\s+/g, ' ').trim();
  }

  function translate(value) {
    if (!dict || !value || !CJK.test(value)) return value;
    var key = normalize(value);
    if (!key) return value;
    var hit = dict[key];
    if (!hit) {
      for (var i = 0; i < PATTERNS.length; i += 1) {
        var match = key.match(PATTERNS[i][0]);
        if (match) { hit = key.replace(PATTERNS[i][0], PATTERNS[i][1]); break; }
      }
    }
    if (!hit) return value;
    var lead = (String(value).match(/^\s*/) || [''])[0];
    var tail = (String(value).match(/\s*$/) || [''])[0];
    return lead + hit + tail;
  }

  function skipped(el) {
    for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
      if (SKIP.has(node.tagName)) return true;
      if (node.id === 'activity' || node.id === 'v2ToolLog' || node.id === 'v2StateOutput' || node.id === 'langToggle') return true;
    }
    return false;
  }

  function translateTextNode(node) {
    if (!node || !node.nodeValue || !CJK.test(node.nodeValue)) return;
    if (skipped(node.parentElement)) return;
    var next = translate(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  }

  function translateAttrs(el) {
    if (!el || el.nodeType !== 1 || skipped(el)) return;
    for (var i = 0; i < ATTRS.length; i += 1) {
      var name = ATTRS[i];
      var value = el.getAttribute(name);
      if (!value || !CJK.test(value)) continue;
      var next = translate(value);
      if (next !== value) el.setAttribute(name, next);
    }
  }

  function walk(el) {
    if (!el || el.nodeType !== 1 || skipped(el)) return;
    translateAttrs(el);
    for (var child = el.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) translateTextNode(child);
      else if (child.nodeType === 1) walk(child);
    }
  }

  function translateTitle() {
    if (!document.title) return;
    var next = translate(document.title);
    if (next !== document.title) document.title = next;
  }

  function patchDialogs() {
    ['alert', 'confirm', 'prompt'].forEach(function (name) {
      var original = window[name];
      if (typeof original !== 'function' || original.__i18nPatched) return;
      var patched = function (message) {
        var args = Array.prototype.slice.call(arguments);
        args[0] = translate(String(message));
        return original.apply(window, args);
      };
      patched.__i18nPatched = true;
      window[name] = patched;
    });
  }

  function init() {
    paintButton();
    translateTitle();
    var titleEl = document.querySelector('title');
    if (titleEl) new MutationObserver(translateTitle).observe(titleEl, { childList: true, characterData: true, subtree: true });
    walk(document.body);
    patchDialogs();
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i += 1) {
        var mutation = mutations[i];
        if (mutation.type === 'characterData') translateTextNode(mutation.target);
        else if (mutation.type === 'attributes') translateAttrs(mutation.target);
        else {
          for (var j = 0; j < mutation.addedNodes.length; j += 1) {
            var node = mutation.addedNodes[j];
            if (node.nodeType === 3) translateTextNode(node);
            else if (node.nodeType === 1) walk(node);
          }
        }
      }
    });
    observer.observe(document.body, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ATTRS
    });
  }

  fetch(DICT_URL, { cache: 'no-store' })
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (data) {
      if (!data || typeof data !== 'object') {
        root.lang = 'zh-CN';
        paintButton();
        return;
      }
      dict = data;
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
      else init();
    })
    .catch(function () {
      root.lang = 'zh-CN';
      paintButton();
    });
})();
