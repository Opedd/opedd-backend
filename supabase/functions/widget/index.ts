import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// This Edge Function serves the embeddable widget.js script.
// Publishers add: <script src="https://{supabase-url}/functions/v1/widget" data-asset-id="..." />

const WIDGET_JS = `
(function() {
  "use strict";

  var scripts = document.querySelectorAll('script[data-asset-id], script[data-publisher-id]');
  var script = scripts[scripts.length - 1];
  if (!script) return;

  var assetId = script.getAttribute('data-asset-id');
  var publisherId = script.getAttribute('data-publisher-id');
  var color = script.getAttribute('data-color') || '#4A26ED';
  var text = script.getAttribute('data-text') || 'License this content';
  var theme = script.getAttribute('data-theme') || 'light';
  var radius = script.getAttribute('data-radius') || '16';
  var position = script.getAttribute('data-position') || 'inline';
  var mode = script.getAttribute('data-mode') || 'card'; // card, badge, compact
  var supabaseUrl = 'https://djdzcciayennqchjgybx.supabase.co';
  var anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqZHpjY2lheWVubnFjaGpneWJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5MTEyODIsImV4cCI6MjA4NDQ4NzI4Mn0.yy8AU2uOMMjqyGsjWLNlzsUp93Z9UQ7N-PRe90qDG3E';

  var container = document.createElement('div');
  container.id = 'opedd-widget-' + (assetId || publisherId || 'default');
  var shadow = container.attachShadow({ mode: 'open' });

  var isDark = theme === 'dark';
  var bgColor = isDark ? 'hsl(244,100%,10%)' : '#ffffff';
  var textColor = isDark ? 'hsl(210,100%,99%)' : 'hsl(244,100%,8%)';
  var mutedColor = isDark ? 'hsl(210,60%,80%)' : 'hsla(244,100%,8%,0.5)';
  var borderColor = isDark ? 'hsla(210,100%,99%,0.12)' : 'hsl(210,100%,97%)';
  var inputBg = isDark ? 'hsla(210,100%,99%,0.08)' : '#ffffff';
  var inputBorder = isDark ? 'hsla(210,100%,99%,0.15)' : '#e2e8f0';
  var priceBg = isDark ? 'hsl(244,50%,18%)' : 'hsl(210,100%,97%)';
  var statBg = isDark ? 'hsla(244,50%,18%,0.6)' : 'hsl(210,100%,97%)';
  var cardShadow = isDark ? '0 8px 32px hsla(244,100%,5%,0.5)' : '0 10px 15px -3px rgba(0,0,0,0.1),0 4px 6px -4px rgba(0,0,0,0.1)';
  var compactShadow = isDark ? '0 4px 16px hsla(244,100%,5%,0.4)' : '0 4px 6px -1px rgba(0,0,0,0.1),0 2px 4px -2px rgba(0,0,0,0.1)';
  var badgeShadow = isDark ? '0 2px 8px hsla(244,100%,5%,0.3)' : '0 1px 2px rgba(0,0,0,0.05)';
  var gradient = 'linear-gradient(to right,hsl(245,83%,54%),hsl(245,83%,62%))';
  var hoverGlow = '0 0 20px hsla(245,83%,54%,0.4)';
  var focusRing = 'hsl(245,83%,54%)';
  var successGreen = '#00B3A4';
  var errorRed = '#dc2626';

  // Opedd icon SVG
  var opeddIconSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 73.58 88.17" style="width:100%;height:100%;display:block"><path fill="#4c0082" d="M14.15,40.06c0,.45,0,.89,0,1.34A21.31,21.31,0,0,0,40.37,11.72h0C26.1,13.2,14.75,25.53,14.15,40.06Z"/><path fill="#d1009a" d="M14.15,40.06c.6-14.53,12-26.86,26.21-28.34h0A21.33,21.33,0,1,0,14.12,41.4C14.13,41,14.13,40.51,14.15,40.06Z"/><path fill="#4a26ed" d="M72.64,33.71C69,19.51,55.32,10.17,40.37,11.72A21.3,21.3,0,0,1,14.12,41.4a44.15,44.15,0,0,0,8.36,26.25A69.2,69.2,0,0,0,44.31,87.74a2.92,2.92,0,0,0,4.44-2.49V74a4.22,4.22,0,0,1,2.78-4c1.26-.46,2.49-.91,3.7-1.41A29.73,29.73,0,0,0,72.64,33.71Z"/></svg>';

  var positionStyles = '';
  if (position === 'bottom-right') {
    positionStyles = 'position:fixed;bottom:24px;right:24px;z-index:9999;';
  } else if (position === 'bottom-left') {
    positionStyles = 'position:fixed;bottom:24px;left:24px;z-index:9999;';
  }

  var fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
  shadow.appendChild(fontLink);

  var styles = document.createElement('style');
  styles.textContent = [
    '@keyframes opedd-pulse{0%,100%{opacity:0.4;}50%{opacity:1;}}',
    '.opedd-root{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' + positionStyles + '}',
    // Card
    '.opedd-card{background:' + bgColor + ';border:1px solid ' + borderColor + ';border-radius:' + radius + 'px;max-width:360px;box-shadow:' + cardShadow + ';overflow:hidden;}',
    // Header
    '.opedd-header{display:flex;align-items:center;gap:10px;padding:16px 20px 12px;border-bottom:1px solid ' + borderColor + ';}',
    '.opedd-logo{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden;' + (isDark ? '' : 'background:#040042;padding:4px;') + '}',
    '.opedd-brand{font-size:11px;font-weight:600;color:' + mutedColor + ';text-transform:uppercase;letter-spacing:0.08em;}',
    // Title
    '.opedd-title-section{padding:16px 20px 12px;}',
    '.opedd-title{font-size:14px;font-weight:600;color:' + textColor + ';margin:0;line-height:1.4;}',
    // Description
    '.opedd-desc{font-size:12px;color:' + mutedColor + ';margin:0 0 16px;line-height:1.5;padding:0 20px;}',
    // Stats bar
    '.opedd-stats{display:flex;margin:0 20px 16px;border-radius:8px;overflow:hidden;background:' + statBg + ';}',
    '.opedd-stat{flex:1;text-align:center;padding:8px 0;}',
    '.opedd-stat-divider{width:1px;background:' + borderColor + ';}',
    '.opedd-stat-label{font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:' + mutedColor + ';}',
    '.opedd-stat-value{font-size:14px;font-weight:700;color:' + textColor + ';}',
    // Price selector (segmented control)
    '.opedd-prices{display:flex;gap:8px;margin:0 20px 16px;padding:4px;border-radius:12px;background:' + priceBg + ';}',
    '.opedd-price{flex:1;padding:8px 0;border:none;border-radius:8px;text-align:center;cursor:pointer;transition:all 0.2s;background:transparent;font-size:12px;font-weight:600;color:' + mutedColor + ';font-family:inherit;}',
    '.opedd-price.active{background:' + gradient + ';color:#ffffff;box-shadow:none;}',
    // Buttons
    '.opedd-btn{display:block;width:100%;height:40px;border:none;border-radius:12px;background:' + gradient + ';color:#ffffff;font-size:14px;font-weight:600;cursor:pointer;text-align:center;text-decoration:none;transition:all 0.3s ease;box-sizing:border-box;font-family:inherit;}',
    '.opedd-btn:hover{box-shadow:' + hoverGlow + ';}',
    '.opedd-btn:disabled{opacity:0.5;cursor:not-allowed;box-shadow:none;}',
    // Form
    '.opedd-form{padding:0 20px 12px;}',
    '.opedd-form-inner{display:flex;flex-direction:column;gap:10px;}',
    '.opedd-row{display:flex;gap:8px;}',
    '.opedd-row .opedd-input{flex:1;min-width:0;}',
    '.opedd-input{display:block;width:100%;height:36px;padding:0 12px;border:1px solid ' + inputBorder + ';border-radius:8px;font-size:12px;color:' + textColor + ';background:' + inputBg + ';box-sizing:border-box;outline:none;font-family:inherit;}',
    '.opedd-input:focus{box-shadow:0 0 0 1px ' + focusRing + ';border-color:' + focusRing + ';}',
    '.opedd-input::placeholder{color:#94a3b8;}',
    '.opedd-select{display:block;width:100%;height:36px;padding:0 12px;border:1px solid ' + inputBorder + ';border-radius:8px;font-size:12px;color:' + textColor + ';background:' + inputBg + ';box-sizing:border-box;outline:none;-webkit-appearance:none;appearance:none;cursor:pointer;font-family:inherit;}',
    '.opedd-select:focus{box-shadow:0 0 0 1px ' + focusRing + ';border-color:' + focusRing + ';}',
    // Checkbox
    '.opedd-checkbox-row{display:flex;align-items:center;gap:8px;cursor:pointer;}',
    '.opedd-checkbox-box{width:16px;height:16px;border-radius:4px;border:1px solid ' + inputBorder + ';display:flex;align-items:center;justify-content:center;transition:all 0.15s;flex-shrink:0;}',
    '.opedd-checkbox-box.checked{background:hsl(245,83%,54%);border-color:hsl(245,83%,54%);}',
    '.opedd-checkbox-label{font-size:12px;color:' + mutedColor + ';user-select:none;}',
    // Button section
    '.opedd-btn-section{padding:0 20px 12px;}',
    // Messages
    '.opedd-msg{padding:10px;border-radius:8px;font-size:12px;margin-bottom:10px;line-height:1.4;}',
    '.opedd-msg-success{background:rgba(0,179,164,0.1);color:' + successGreen + ';border:1px solid rgba(0,179,164,0.3);}',
    '.opedd-msg-error{background:#fef2f2;color:' + errorRed + ';border:1px solid #fecaca;}',
    // Footer
    '.opedd-footer{display:flex;align-items:center;justify-content:center;gap:6px;padding:12px 20px;border-top:1px solid ' + borderColor + ';}',
    '.opedd-footer-icon{width:12px;height:12px;opacity:0.5;display:flex;align-items:center;justify-content:center;}',
    '.opedd-footer-text{font-size:10px;color:' + mutedColor + ';}',
    // Loading / Error
    '.opedd-loading{text-align:center;padding:24px;color:' + mutedColor + ';font-size:13px;animation:opedd-pulse 1.5s ease-in-out infinite;}',
    '.opedd-error{text-align:center;padding:16px;color:' + errorRed + ';font-size:13px;}',
    // Badge mode
    '.opedd-badge{display:inline-flex;align-items:center;gap:8px;padding:6px 12px 6px 8px;background:' + bgColor + ';border:1px solid ' + borderColor + ';border-radius:9999px;cursor:pointer;text-decoration:none;transition:all 0.2s;box-shadow:' + badgeShadow + ';}',
    '.opedd-badge:hover{border-color:' + color + ';box-shadow:0 2px 6px rgba(0,0,0,0.1);}',
    '.opedd-badge-icon{width:20px;height:20px;display:flex;align-items:center;justify-content:center;}',
    '.opedd-badge-text{font-size:12px;font-weight:600;color:' + textColor + ';}',
    '.opedd-badge-count{font-size:10px;color:' + mutedColor + ';}',
    // Compact mode
    '.opedd-compact{background:' + bgColor + ';border:1px solid ' + borderColor + ';border-radius:12px;padding:12px 16px;max-width:360px;box-shadow:' + compactShadow + ';}',
    '.opedd-compact-row{display:flex;align-items:center;justify-content:space-between;gap:12px;}',
    '.opedd-compact-info{flex:1;min-width:0;}',
    '.opedd-compact-title{font-size:12px;font-weight:600;color:' + textColor + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.opedd-compact-meta{font-size:10px;color:' + mutedColor + ';margin-top:2px;}',
    '.opedd-compact-btn{flex-shrink:0;height:32px;padding:0 16px;border:none;border-radius:8px;background:' + gradient + ';color:#fff;font-size:12px;font-weight:600;cursor:pointer;text-decoration:none;transition:all 0.3s ease;font-family:inherit;}',
    '.opedd-compact-btn:hover{box-shadow:0 0 15px hsla(245,83%,54%,0.4);}',
  ].join('\\n');
  shadow.appendChild(styles);

  var root = document.createElement('div');
  root.className = 'opedd-root';

  if (mode === 'badge') {
    root.innerHTML = '<a class="opedd-badge" target="_blank" rel="noopener"><div class="opedd-badge-icon">' + opeddIconSvg + '</div><span class="opedd-badge-text">Licensed</span></a>';
  } else if (mode === 'compact') {
    root.innerHTML = '<div class="opedd-compact"><div class="opedd-loading">Loading...</div></div>';
  } else {
    root.innerHTML = '<div class="opedd-card"><div class="opedd-loading">Loading...</div></div>';
  }

  shadow.appendChild(root);
  script.parentNode.insertBefore(container, script.nextSibling);

  // === Metadata extraction for auto-registration ===
  function getPageMeta(name) {
    var el = document.querySelector('meta[property="' + name + '"], meta[name="' + name + '"]');
    return el ? el.getAttribute('content') : null;
  }

  function getCategoryFromUrl() {
    var path = window.location.pathname.split('/').filter(Boolean);
    for (var i = 0; i < Math.min(path.length, 2); i++) {
      var seg = path[i];
      if (seg.length < 30 && !/^\\d{4}$/.test(seg) && !/^\\d+$/.test(seg)) {
        return seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' ');
      }
    }
    return null;
  }

  function getPageMetadata() {
    var canon = document.querySelector('link[rel="canonical"]');
    return {
      title: getPageMeta('og:title') || document.title || (document.querySelector('h1') || {}).textContent || '',
      description: getPageMeta('og:description') || getPageMeta('description') || '',
      category: getPageMeta('article:section') || getCategoryFromUrl(),
      url: getPageMeta('og:url') || (canon ? canon.href : null) || window.location.href,
      published_at: getPageMeta('article:published_time') || null,
      thumbnail_url: getPageMeta('og:image') || null
    };
  }

  function autoRegister() {
    var meta = getPageMetadata();
    if (!meta.title) { showError('Unable to detect article metadata'); return; }

    fetch(supabaseUrl + '/functions/v1/lookup-article', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publisher_id: publisherId,
        url: meta.url,
        title: meta.title,
        description: meta.description || '',
        category: meta.category,
        published_at: meta.published_at,
        thumbnail_url: meta.thumbnail_url
      })
    })
    .then(function(res) { return res.json(); })
    .then(function(result) {
      if (result.success && result.data) {
        var article = result.data;
        injectLicenseMeta(article);
        if (mode === 'badge') renderBadge(article);
        else if (mode === 'compact') renderCompact(article);
        else renderWidget(article);
      } else {
        showError('Content not available for licensing');
      }
    })
    .catch(function() { showError('Unable to register content'); });
  }

  function fetchArticle() {
    var url;
    if (assetId) {
      url = supabaseUrl + '/rest/v1/assets?select=id,title,description,human_price,ai_price,licensing_enabled,human_licenses_sold,ai_licenses_sold&id=eq.' + assetId + '&limit=1';
    } else if (publisherId) {
      url = supabaseUrl + '/functions/v1/lookup-article?url=' + encodeURIComponent(window.location.href);
    } else {
      showError('No asset-id or publisher-id configured');
      return;
    }

    var headers = { 'apikey': anonKey, 'Accept': 'application/json' };

    fetch(url, { headers: headers })
      .then(function(res) {
        if (res.status === 404 && publisherId) { autoRegister(); return null; }
        return res.json();
      })
      .then(function(data) {
        if (!data) return;

        var article;
        if (Array.isArray(data)) {
          article = data[0];
        } else if (data.success && data.data) {
          article = data.data;
        }

        if (!article || !article.id) {
          if (publisherId) { autoRegister(); return; }
          showError('Content not available for licensing');
          return;
        }

        if (article.licensing_enabled === false) {
          showError('Licensing not enabled');
          return;
        }

        injectLicenseMeta(article);

        if (mode === 'badge') {
          renderBadge(article);
        } else if (mode === 'compact') {
          renderCompact(article);
        } else {
          renderWidget(article);
        }
      })
      .catch(function() {
        showError('Unable to load licensing data');
      });
  }

  function injectLicenseMeta(article) {
    if (document.querySelector('meta[name="license:protocol"]')) return;
    var metas = [
      { name: 'license:protocol', content: 'opedd/1.0' },
      { name: 'license:publisher', content: publisherId || '' },
      { name: 'license:type', content: (article.human_price > 0 || article.ai_price > 0) ? 'commercial' : 'free' },
      { name: 'license:human_price', content: (article.human_price || 0).toString() },
      { name: 'license:ai_price', content: (article.ai_price || 0).toString() },
      { name: 'license:api', content: supabaseUrl + '/functions/v1/api' }
    ];
    var head = document.head || document.getElementsByTagName('head')[0];
    for (var i = 0; i < metas.length; i++) {
      var tag = document.createElement('meta');
      tag.setAttribute('name', metas[i].name);
      tag.setAttribute('content', metas[i].content);
      head.appendChild(tag);
    }
  }

  function showError(msg) {
    var el = root.querySelector('.opedd-card') || root.querySelector('.opedd-compact');
    if (el) {
      el.innerHTML = '<div class="opedd-error">' + msg + '</div>';
    } else if (mode === 'badge') {
      root.innerHTML = '';
    }
  }

  // === Badge mode ===
  function renderBadge(article) {
    var totalLicenses = (article.human_licenses_sold || 0) + (article.ai_licenses_sold || 0);
    var badge = root.querySelector('.opedd-badge');
    if (!badge) return;

    var frontendUrl = script.getAttribute('data-frontend-url') || 'https://opedd.com';
    badge.href = frontendUrl + '/l/' + article.id;

    var hasPrice = (article.human_price && article.human_price > 0) || (article.ai_price && article.ai_price > 0);
    var minPrice = 0;
    if (article.human_price > 0 && article.ai_price > 0) {
      minPrice = Math.min(parseFloat(article.human_price), parseFloat(article.ai_price));
    } else {
      minPrice = parseFloat(article.human_price || article.ai_price || 0);
    }

    badge.querySelector('.opedd-badge-text').textContent = hasPrice ? 'From $' + minPrice.toFixed(2) : 'Free License';

    if (totalLicenses > 0) {
      var countEl = document.createElement('span');
      countEl.className = 'opedd-badge-count';
      countEl.textContent = '\\u00b7 ' + totalLicenses;
      badge.appendChild(countEl);
    }
  }

  // === Compact mode ===
  function renderCompact(article) {
    var hasHuman = article.human_price && article.human_price > 0;
    var hasAi = article.ai_price && article.ai_price > 0;
    var isFree = !hasHuman && !hasAi;
    var totalLicenses = (article.human_licenses_sold || 0) + (article.ai_licenses_sold || 0);

    var wrapper = root.querySelector('.opedd-compact');
    wrapper.innerHTML = '';

    var row = document.createElement('div');
    row.className = 'opedd-compact-row';

    var info = document.createElement('div');
    info.className = 'opedd-compact-info';

    var titleEl = document.createElement('div');
    titleEl.className = 'opedd-compact-title';
    titleEl.textContent = article.title || 'License this content';
    info.appendChild(titleEl);

    var meta = document.createElement('div');
    meta.className = 'opedd-compact-meta';
    var parts = [];
    if (hasHuman || hasAi) {
      var minPrice = 0;
      if (hasHuman && hasAi) {
        minPrice = Math.min(parseFloat(article.human_price), parseFloat(article.ai_price));
      } else {
        minPrice = parseFloat(article.human_price || article.ai_price || 0);
      }
      parts.push('From $' + minPrice.toFixed(2));
    }
    if (isFree) parts.push('Free license');
    if (totalLicenses > 0) parts.push(totalLicenses + ' licenses');
    meta.textContent = parts.join(' \\u00b7 ');
    info.appendChild(meta);
    row.appendChild(info);

    var compactBtn = document.createElement('button');
    compactBtn.className = 'opedd-compact-btn';
    if (isFree) {
      compactBtn.textContent = 'Get License';
      compactBtn.addEventListener('click', function() {
        showFreeForm(article, wrapper);
      });
    } else {
      compactBtn.textContent = 'License';
      compactBtn.addEventListener('click', function() {
        wrapper.innerHTML = '';
        wrapper.className = 'opedd-card';
        renderWidget(article);
      });
    }
    row.appendChild(compactBtn);

    wrapper.appendChild(row);
  }

  // === Full card mode ===
  function renderWidget(article) {
    var hasHuman = article.human_price && article.human_price > 0;
    var hasAi = article.ai_price && article.ai_price > 0;
    var isFree = !hasHuman && !hasAi;
    var totalLicenses = (article.human_licenses_sold || 0) + (article.ai_licenses_sold || 0);

    var selectedType = hasHuman ? 'human' : 'ai';

    var card = root.querySelector('.opedd-card');
    card.innerHTML = '';

    // Header
    var header = document.createElement('div');
    header.className = 'opedd-header';
    header.innerHTML = '<div class="opedd-logo">' + opeddIconSvg + '</div><span class="opedd-brand">Opedd License</span>';
    card.appendChild(header);

    // Title
    if (article.title) {
      var titleSection = document.createElement('div');
      titleSection.className = 'opedd-title-section';
      var title = document.createElement('h3');
      title.className = 'opedd-title';
      title.textContent = article.title;
      titleSection.appendChild(title);
      card.appendChild(titleSection);
    }

    // Stats bar
    if (totalLicenses > 0) {
      var stats = document.createElement('div');
      stats.className = 'opedd-stats';

      var humanStat = document.createElement('div');
      humanStat.className = 'opedd-stat';
      humanStat.innerHTML = '<div class="opedd-stat-label">Human</div><div class="opedd-stat-value">' + (article.human_licenses_sold || 0) + '</div>';
      stats.appendChild(humanStat);

      var divider = document.createElement('div');
      divider.className = 'opedd-stat-divider';
      stats.appendChild(divider);

      var aiStat = document.createElement('div');
      aiStat.className = 'opedd-stat';
      aiStat.innerHTML = '<div class="opedd-stat-label">AI</div><div class="opedd-stat-value">' + (article.ai_licenses_sold || 0) + '</div>';
      stats.appendChild(aiStat);

      card.appendChild(stats);
    }

    // Free license flow
    if (isFree) {
      var desc = document.createElement('p');
      desc.className = 'opedd-desc';
      desc.textContent = 'This content is available for free licensing. Fill in your details to receive a license key.';
      card.appendChild(desc);

      showFreeForm(article, card);
      appendFooter(card);
      return;
    }

    // Price selector (segmented control)
    if (hasHuman && hasAi) {
      var prices = document.createElement('div');
      prices.className = 'opedd-prices';

      var humanBtn = document.createElement('button');
      humanBtn.className = 'opedd-price' + (selectedType === 'human' ? ' active' : '');
      humanBtn.textContent = 'Human \\u00b7 $' + parseFloat(article.human_price).toFixed(2);
      humanBtn.addEventListener('click', function() {
        selectedType = 'human';
        humanBtn.classList.add('active');
        aiBtn.classList.remove('active');
      });
      prices.appendChild(humanBtn);

      var aiBtn = document.createElement('button');
      aiBtn.className = 'opedd-price' + (selectedType === 'ai' ? ' active' : '');
      aiBtn.textContent = 'AI Training \\u00b7 $' + parseFloat(article.ai_price).toFixed(2);
      aiBtn.addEventListener('click', function() {
        selectedType = 'ai';
        aiBtn.classList.add('active');
        humanBtn.classList.remove('active');
      });
      prices.appendChild(aiBtn);

      card.appendChild(prices);
    } else {
      var price = hasHuman ? article.human_price : article.ai_price;
      var label = hasHuman ? 'Human License' : 'AI Training License';
      var priceDiv = document.createElement('div');
      priceDiv.className = 'opedd-desc';
      priceDiv.textContent = label + ' \\u2014 $' + parseFloat(price).toFixed(2);
      card.appendChild(priceDiv);
    }

    // Buyer form for paid flow
    showPaidForm(article, selectedType, card);

    appendFooter(card);
  }

  // === Free license form ===
  function showFreeForm(article, parent) {
    var existing = parent.querySelector('.opedd-form');
    if (existing) return;

    buildBuyerForm(parent, 'Get Free License', function(data) {
      var btn = parent.querySelector('.opedd-btn');
      btn.disabled = true;
      btn.textContent = 'Issuing...';

      fetch(supabaseUrl + '/functions/v1/issue-license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          article_id: article.id,
          buyer_email: data.email,
          buyer_name: data.firstName + ' ' + data.lastName,
          buyer_organization: data.company,
          intended_use: data.intendedUse,
          license_type: 'human'
        })
      })
      .then(function(res) { return res.json(); })
      .then(function(result) {
        if (result.success && result.data && result.data.license_key) {
          var form = parent.querySelector('.opedd-form');
          form.innerHTML = '<div class="opedd-msg opedd-msg-success">License issued! Your key: <strong>' + result.data.license_key + '</strong><br>Check your email for the full certificate.</div>';
        } else {
          showMessage(parent.querySelector('.opedd-form'), result.error || 'Failed to issue license.', 'error');
          btn.disabled = false;
          btn.textContent = 'Get Free License';
        }
      })
      .catch(function() {
        showMessage(parent.querySelector('.opedd-form'), 'Network error. Please try again.', 'error');
        btn.disabled = false;
        btn.textContent = 'Get Free License';
      });
    });
  }

  // === Checkout result polling (after Stripe return) ===
  function showCheckoutResult(sessionId) {
    var card = root.querySelector('.opedd-card') || root.querySelector('.opedd-compact');
    if (!card) { root.innerHTML = '<div class="opedd-card"></div>'; card = root.querySelector('.opedd-card'); }
    card.innerHTML = '<div class="opedd-loading">Processing payment...</div>';

    var attempts = 0;
    var poll = setInterval(function() {
      attempts++;
      fetch(supabaseUrl + '/functions/v1/checkout-status?session_id=' + sessionId, {
        headers: { 'apikey': anonKey }
      })
      .then(function(res) { return res.json(); })
      .then(function(result) {
        if (result.success && result.data) {
          if (result.data.status === 'completed') {
            clearInterval(poll);
            card.innerHTML = '<div class="opedd-header"><div class="opedd-logo">' + opeddIconSvg + '</div><span class="opedd-brand">Opedd License</span></div>'
              + '<div style="padding:20px"><div class="opedd-msg opedd-msg-success">License issued! Your key: <strong>' + result.data.license_key + '</strong><br>Check your email for the full certificate.</div></div>';
            appendFooter(card);
          } else if (result.data.status === 'failed') {
            clearInterval(poll);
            card.innerHTML = '<div style="padding:20px"><div class="opedd-msg opedd-msg-error">Payment failed or expired. Please try again.</div></div>';
          }
        }
      });
      if (attempts > 30) { clearInterval(poll); card.innerHTML = '<div style="padding:20px"><div class="opedd-msg opedd-msg-error">Timeout. Check your email for the license key.</div></div>'; }
    }, 2000);
  }

  // === Shared buyer info form builder ===
  function buildBuyerForm(parent, buttonText, onSubmit) {
    var existing = parent.querySelector('.opedd-form');
    if (existing) return;

    var form = document.createElement('div');
    form.className = 'opedd-form';

    var inner = document.createElement('div');
    inner.className = 'opedd-form-inner';

    // First + Last name row
    var nameRow = document.createElement('div');
    nameRow.className = 'opedd-row';

    var firstInput = document.createElement('input');
    firstInput.className = 'opedd-input';
    firstInput.type = 'text';
    firstInput.placeholder = 'First name';
    nameRow.appendChild(firstInput);

    var lastInput = document.createElement('input');
    lastInput.className = 'opedd-input';
    lastInput.type = 'text';
    lastInput.placeholder = 'Last name';
    nameRow.appendChild(lastInput);

    inner.appendChild(nameRow);

    // Email
    var emailInput = document.createElement('input');
    emailInput.className = 'opedd-input';
    emailInput.type = 'email';
    emailInput.placeholder = 'Email address';
    inner.appendChild(emailInput);

    // Company
    var companyInput = document.createElement('input');
    companyInput.className = 'opedd-input';
    companyInput.type = 'text';
    companyInput.placeholder = 'Company / Organization';
    inner.appendChild(companyInput);

    // Individual checkbox (custom styled)
    var isIndividual = false;
    var checkRow = document.createElement('div');
    checkRow.className = 'opedd-checkbox-row';

    var checkBox = document.createElement('div');
    checkBox.className = 'opedd-checkbox-box';

    var checkLabel = document.createElement('span');
    checkLabel.className = 'opedd-checkbox-label';
    checkLabel.textContent = 'Individual (no organization)';

    checkRow.appendChild(checkBox);
    checkRow.appendChild(checkLabel);
    inner.appendChild(checkRow);

    checkRow.addEventListener('click', function() {
      isIndividual = !isIndividual;
      if (isIndividual) {
        checkBox.classList.add('checked');
        checkBox.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        companyInput.style.display = 'none';
        companyInput.value = '';
      } else {
        checkBox.classList.remove('checked');
        checkBox.innerHTML = '';
        companyInput.style.display = 'block';
      }
    });

    // Intended use
    var useSelect = document.createElement('select');
    useSelect.className = 'opedd-select';
    var useOptions = [
      { value: '', label: 'Intended use' },
      { value: 'personal', label: 'Personal Use' },
      { value: 'editorial', label: 'Editorial Use' },
      { value: 'commercial', label: 'Commercial Use' },
      { value: 'ai_training', label: 'AI Training' },
      { value: 'corporate', label: 'Corporate Use' }
    ];
    for (var i = 0; i < useOptions.length; i++) {
      var opt = document.createElement('option');
      opt.value = useOptions[i].value;
      opt.textContent = useOptions[i].label;
      if (i === 0) opt.disabled = true; opt.selected = (i === 0);
      useSelect.appendChild(opt);
    }
    inner.appendChild(useSelect);

    form.appendChild(inner);
    parent.appendChild(form);

    // Submit button (in its own section for proper padding)
    var btnSection = document.createElement('div');
    btnSection.className = 'opedd-btn-section';
    var submitBtn = document.createElement('button');
    submitBtn.className = 'opedd-btn';
    submitBtn.textContent = buttonText;
    submitBtn.type = 'button';
    btnSection.appendChild(submitBtn);
    parent.appendChild(btnSection);

    submitBtn.addEventListener('click', function() {
      // Clear previous errors
      var prevMsg = form.querySelector('.opedd-msg');
      if (prevMsg) prevMsg.remove();

      var firstName = firstInput.value.trim();
      var lastName = lastInput.value.trim();
      var email = emailInput.value.trim();
      var company = isIndividual ? 'Individual' : companyInput.value.trim();
      var intendedUse = useSelect.value;

      if (!firstName) { showMessage(inner, 'First name is required.', 'error'); return; }
      if (!lastName) { showMessage(inner, 'Last name is required.', 'error'); return; }
      if (!email || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) { showMessage(inner, 'Please enter a valid email address.', 'error'); return; }
      if (!company) { showMessage(inner, 'Company is required (or check "Individual").', 'error'); return; }
      if (!intendedUse) { showMessage(inner, 'Please select an intended use.', 'error'); return; }

      onSubmit({ firstName: firstName, lastName: lastName, email: email, company: company, intendedUse: intendedUse });
    });
  }

  // === Preload Stripe.js early ===
  function preloadStripeJs() {
    if (window.Stripe || document.querySelector('script[src*="js.stripe.com"]')) return;
    var s = document.createElement('script');
    s.src = 'https://js.stripe.com/v3/';
    s.async = true;
    document.head.appendChild(s);
  }

  // === Paid license form (embedded Stripe Checkout) ===
  function showPaidForm(article, selectedType, parent) {
    preloadStripeJs();
    buildBuyerForm(parent, 'Proceed to Payment', function(data) {
      var btn = parent.querySelector('.opedd-btn');
      btn.disabled = true;
      btn.textContent = 'Loading checkout...';

      var returnUrl = window.location.href.split('?')[0] + '?opedd_session={CHECKOUT_SESSION_ID}';

      fetch(supabaseUrl + '/functions/v1/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          article_id: article.id,
          buyer_email: data.email,
          buyer_name: data.firstName + ' ' + data.lastName,
          buyer_organization: data.company,
          intended_use: data.intendedUse,
          license_type: selectedType,
          embedded: true,
          return_url: returnUrl
        })
      })
      .then(function(res) { return res.json(); })
      .then(function(result) {
        if (result.success && result.data && result.data.client_secret) {
          mountStripeCheckout(result.data.client_secret, result.data.publishable_key);
        } else {
          showMessage(parent.querySelector('.opedd-form'), result.error || result.message || 'Failed to start checkout.', 'error');
          btn.disabled = false;
          btn.textContent = 'Proceed to Payment';
        }
      })
      .catch(function() {
        showMessage(parent.querySelector('.opedd-form'), 'Network error. Please try again.', 'error');
        btn.disabled = false;
        btn.textContent = 'Proceed to Payment';
      });
    });
  }

  // === Load Stripe.js dynamically ===
  function loadStripeJs(publishableKey, callback) {
    if (window.Stripe) { callback(window.Stripe(publishableKey)); return; }
    var s = document.createElement('script');
    s.src = 'https://js.stripe.com/v3/';
    s.onload = function() { callback(window.Stripe(publishableKey)); };
    s.onerror = function() { showError('Failed to load payment system'); };
    document.head.appendChild(s);
  }

  // === Mount Stripe Embedded Checkout (outside shadow DOM) ===
  function mountStripeCheckout(clientSecret, publishableKey) {
    var card = root.querySelector('.opedd-card') || root.querySelector('.opedd-compact');
    if (card) card.style.display = 'none';

    var stripeContainer = document.createElement('div');
    stripeContainer.id = 'opedd-stripe-' + (assetId || publisherId || 'default');
    stripeContainer.style.cssText = 'max-width:360px;' + (positionStyles || '');
    container.parentNode.insertBefore(stripeContainer, container.nextSibling);

    loadStripeJs(publishableKey, function(stripe) {
      stripe.initEmbeddedCheckout({ clientSecret: clientSecret })
        .then(function(checkout) {
          checkout.mount(stripeContainer);
        });
    });
  }

  function showMessage(parent, msg, type) {
    var existing = parent.querySelector('.opedd-msg');
    if (existing) existing.remove();
    var el = document.createElement('div');
    el.className = 'opedd-msg opedd-msg-' + type;
    el.textContent = msg;
    parent.insertBefore(el, parent.firstChild);
  }

  function appendFooter(parent) {
    var footer = document.createElement('div');
    footer.className = 'opedd-footer';
    footer.innerHTML = '<span class="opedd-footer-icon">' + opeddIconSvg + '</span><span class="opedd-footer-text">Powered by Opedd Protocol</span>';
    parent.appendChild(footer);
  }

  // Detect return from Stripe Embedded Checkout
  var urlParams = new URLSearchParams(window.location.search);
  var returnSessionId = urlParams.get('opedd_session');
  if (returnSessionId) {
    var cleanUrl = window.location.href.split('?')[0];
    urlParams.delete('opedd_session');
    var remaining = urlParams.toString();
    if (remaining) cleanUrl += '?' + remaining;
    window.history.replaceState({}, '', cleanUrl);
    showCheckoutResult(returnSessionId);
  } else {
    fetchArticle();
  }
})();
`;

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "public, max-age=3600",
    "Content-Type": "application/javascript; charset=utf-8",
  };

  if (req.method === "OPTIONS") {
    return new Response("", { headers: corsHeaders });
  }

  return new Response(WIDGET_JS, {
    status: 200,
    headers: corsHeaders,
  });
});
