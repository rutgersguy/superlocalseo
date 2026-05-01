/* SuperLocalSEO Review Widget — v1 */
(function () {
  'use strict';

  var API_ORIGIN = (function () {
    var scripts = document.querySelectorAll('script[data-sls-key]');
    if (scripts.length) {
      var src = scripts[scripts.length - 1].src;
      try { return new URL(src).origin; } catch (e) { return ''; }
    }
    return '';
  })();

  var STAR_FILLED = '<svg viewBox="0 0 20 20" fill="currentColor" style="display:inline-block;width:14px;height:14px;"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.956a1 1 0 00.95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.37 2.449a1 1 0 00-.364 1.118l1.286 3.956c.3.921-.755 1.688-1.54 1.118L10 15.347l-3.37 2.449c-.784.57-1.838-.197-1.539-1.118l1.286-3.956a1 1 0 00-.364-1.118L2.643 9.383c-.783-.57-.38-1.81.588-1.81h4.162a1 1 0 00.95-.69l1.286-3.956z"/></svg>';
  var STAR_EMPTY = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" style="display:inline-block;width:14px;height:14px;"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.956a1 1 0 00.95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.37 2.449a1 1 0 00-.364 1.118l1.286 3.956c.3.921-.755 1.688-1.54 1.118L10 15.347l-3.37 2.449c-.784.57-1.838-.197-1.539-1.118l1.286-3.956a1 1 0 00-.364-1.118L2.643 9.383c-.783-.57-.38-1.81.588-1.81h4.162a1 1 0 00.95-.69l1.286-3.956z"/></svg>';

  var PLATFORM_COLORS = {
    google: '#4285F4',
    yelp: '#D32323',
    facebook: '#1877F2',
  };

  function stars(rating) {
    var s = '';
    for (var i = 1; i <= 5; i++) {
      s += i <= rating ? STAR_FILLED : STAR_EMPTY;
    }
    return s;
  }

  function timeAgo(dateStr) {
    var d = new Date(dateStr);
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 86400 * 30) return Math.floor(diff / 86400) + 'd ago';
    if (diff < 86400 * 365) return Math.floor(diff / 86400 / 30) + 'mo ago';
    return Math.floor(diff / 86400 / 365) + 'y ago';
  }

  function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len).trim() + '…' : str;
  }

  function render(container, data) {
    var cfg = data.config;
    var isDark = cfg.theme === 'dark';
    var bg = isDark ? '#1a1a2e' : '#ffffff';
    var cardBg = isDark ? '#16213e' : '#f9fafb';
    var textMain = isDark ? '#f1f5f9' : '#111827';
    var textMuted = isDark ? '#94a3b8' : '#6b7280';
    var starColor = '#f59e0b';
    var borderColor = isDark ? '#334155' : '#e5e7eb';
    var scrollBg = isDark ? '#0f3460' : '#f3f4f6';

    var headerHtml = '<div style="padding:12px 16px 8px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid ' + borderColor + ';">' +
      '<span style="font-size:13px;font-weight:600;color:' + textMain + ';">' + escHtml(data.businessName) + ' Reviews</span>' +
      '<span style="font-size:11px;color:' + textMuted + ';">' + data.reviews.length + ' reviews</span>' +
      '</div>';

    var cardsHtml = data.reviews.map(function (r) {
      var platformLabel = r.platform ? (r.platform.charAt(0).toUpperCase() + r.platform.slice(1)) : '';
      var platformColor = PLATFORM_COLORS[r.platform] || '#6b7280';
      var badge = cfg.showPlatformBadge && r.platform
        ? '<span style="font-size:10px;font-weight:600;color:#fff;background:' + platformColor + ';padding:1px 6px;border-radius:10px;margin-left:6px;">' + escHtml(platformLabel) + '</span>'
        : '';

      return '<div style="min-width:220px;max-width:260px;flex:0 0 auto;background:' + cardBg + ';border:1px solid ' + borderColor + ';border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:6px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;">' +
          '<span style="font-size:12px;font-weight:600;color:' + textMain + ';">' + escHtml(r.authorName || 'Anonymous') + '</span>' +
          '<span style="font-size:10px;color:' + textMuted + ';">' + timeAgo(r.reviewDate) + badge + '</span>' +
        '</div>' +
        '<div style="color:' + starColor + ';display:flex;gap:1px;">' + stars(r.rating || 0) + '</div>' +
        '<p style="font-size:12px;line-height:1.5;color:' + textMuted + ';margin:0;">' + escHtml(truncate(r.body, 180)) + '</p>' +
      '</div>';
    }).join('');

    container.innerHTML =
      '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;background:' + bg + ';border:1px solid ' + borderColor + ';border-radius:12px;overflow:hidden;max-width:100%;">' +
        headerHtml +
        '<div style="overflow-x:auto;padding:12px 16px 14px;">' +
          '<div style="display:flex;gap:10px;width:max-content;">' + cardsHtml + '</div>' +
        '</div>' +
        '<div style="padding:6px 16px 10px;text-align:right;">' +
          '<a href="https://superlocalseo.com" target="_blank" rel="noopener" style="font-size:10px;color:' + textMuted + ';text-decoration:none;opacity:0.6;">powered by SuperLocalSEO</a>' +
        '</div>' +
      '</div>';
  }

  function escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function init() {
    var containers = document.querySelectorAll('[data-sls-key]');
    if (!containers.length) return;

    containers.forEach(function (el) {
      var key = el.getAttribute('data-sls-key');
      if (!key) return;

      el.innerHTML = '<div style="padding:20px;text-align:center;color:#9ca3af;font-size:13px;">Loading reviews…</div>';

      fetch(API_ORIGIN + '/api/widget/' + encodeURIComponent(key))
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res.success && res.data) {
            render(el, res.data);
          } else {
            el.innerHTML = '';
          }
        })
        .catch(function () { el.innerHTML = ''; });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
