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
  var radius = script.getAttribute('data-radius') || '10';
  var position = script.getAttribute('data-position') || 'inline';
  var mode = script.getAttribute('data-mode') || 'card'; // card, badge, compact
  var supabaseUrl = 'https://djdzcciayennqchjgybx.supabase.co';
  var anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqZHpjY2lheWVubnFjaGpneWJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5MTEyODIsImV4cCI6MjA4NDQ4NzI4Mn0.yy8AU2uOMMjqyGsjWLNlzsUp93Z9UQ7N-PRe90qDG3E';

  var container = document.createElement('div');
  container.id = 'opedd-widget-' + (assetId || publisherId || 'default');
  var shadow = container.attachShadow({ mode: 'open' });

  var isDark = theme === 'dark';
  var bgColor = isDark ? '#1a1a2e' : '#ffffff';
  var textColor = isDark ? '#ffffff' : '#040042';
  var mutedColor = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(4,0,66,0.6)';
  var borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(4,0,66,0.1)';
  var successGreen = '#16a34a';
  var errorRed = '#dc2626';

  var positionStyles = '';
  if (position === 'bottom-right') {
    positionStyles = 'position:fixed;bottom:24px;right:24px;z-index:9999;';
  } else if (position === 'bottom-left') {
    positionStyles = 'position:fixed;bottom:24px;left:24px;z-index:9999;';
  }

  var btnRadius = Math.max(4, parseInt(radius) - 2);
  var innerRadius = Math.max(4, parseInt(radius) - 4);

  var styles = document.createElement('style');
  styles.textContent = [
    '.opedd-root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' + positionStyles + '}',
    '.opedd-card{background:' + bgColor + ';border:1px solid ' + borderColor + ';border-radius:' + radius + 'px;padding:20px;max-width:360px;box-shadow:0 2px 8px rgba(0,0,0,0.08);}',
    '.opedd-header{display:flex;align-items:center;gap:8px;margin-bottom:12px;}',
    '.opedd-logo{width:16px;height:16px;border-radius:3px;background:' + color + ';display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;font-weight:700;}',
    '.opedd-brand{font-size:11px;font-weight:600;color:' + mutedColor + ';text-transform:uppercase;letter-spacing:1.5px;}',
    '.opedd-title{font-size:14px;font-weight:600;color:' + textColor + ';margin:0 0 4px;line-height:1.4;}',
    '.opedd-desc{font-size:12px;color:' + mutedColor + ';margin:0 0 16px;line-height:1.5;}',
    '.opedd-prices{display:flex;gap:8px;margin-bottom:16px;}',
    '.opedd-price{flex:1;padding:10px;border:1px solid ' + borderColor + ';border-radius:' + innerRadius + 'px;text-align:center;cursor:pointer;transition:all 0.2s;background:transparent;}',
    '.opedd-price:hover{border-color:' + color + ';background:' + color + '0d;}',
    '.opedd-price.active{border-color:' + color + ';background:' + color + '14;box-shadow:0 0 0 1px ' + color + ';}',
    '.opedd-price-label{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:' + mutedColor + ';margin-bottom:4px;}',
    '.opedd-price-value{font-size:18px;font-weight:700;color:' + textColor + ';}',
    '.opedd-btn{display:block;width:100%;padding:12px;border:none;border-radius:' + btnRadius + 'px;background:' + color + ';color:#ffffff;font-size:14px;font-weight:600;cursor:pointer;text-align:center;text-decoration:none;transition:opacity 0.2s;box-sizing:border-box;}',
    '.opedd-btn:hover{opacity:0.9;}',
    '.opedd-btn:disabled{opacity:0.5;cursor:not-allowed;}',
    '.opedd-stats{display:flex;gap:12px;margin-bottom:14px;padding:8px 0;border-top:1px solid ' + borderColor + ';border-bottom:1px solid ' + borderColor + ';}',
    '.opedd-stat{flex:1;text-align:center;}',
    '.opedd-stat-value{font-size:16px;font-weight:700;color:' + textColor + ';}',
    '.opedd-stat-label{font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:' + mutedColor + ';margin-top:2px;}',
    '.opedd-form{margin-bottom:12px;}',
    '.opedd-input{display:block;width:100%;padding:10px 12px;border:1px solid ' + borderColor + ';border-radius:' + innerRadius + 'px;font-size:13px;color:' + textColor + ';background:' + bgColor + ';box-sizing:border-box;outline:none;margin-bottom:8px;}',
    '.opedd-input:focus{border-color:' + color + ';}',
    '.opedd-input::placeholder{color:' + mutedColor + ';}',
    '.opedd-msg{padding:10px;border-radius:' + innerRadius + 'px;font-size:12px;margin-bottom:10px;line-height:1.4;}',
    '.opedd-msg-success{background:#f0fdf4;color:' + successGreen + ';border:1px solid #bbf7d0;}',
    '.opedd-msg-error{background:#fef2f2;color:' + errorRed + ';border:1px solid #fecaca;}',
    '.opedd-footer{margin-top:12px;text-align:center;font-size:10px;color:' + mutedColor + ';}',
    '.opedd-footer a{color:' + color + ';text-decoration:none;font-weight:600;}',
    '.opedd-loading{text-align:center;padding:24px;color:' + mutedColor + ';font-size:13px;}',
    '.opedd-error{text-align:center;padding:16px;color:' + errorRed + ';font-size:13px;}',
    // Badge mode
    '.opedd-badge{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;background:' + bgColor + ';border:1px solid ' + borderColor + ';border-radius:20px;cursor:pointer;text-decoration:none;transition:all 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.06);}',
    '.opedd-badge:hover{border-color:' + color + ';box-shadow:0 2px 6px rgba(0,0,0,0.1);}',
    '.opedd-badge-icon{width:14px;height:14px;border-radius:3px;background:' + color + ';display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff;font-weight:700;}',
    '.opedd-badge-text{font-size:12px;font-weight:600;color:' + textColor + ';}',
    '.opedd-badge-count{font-size:11px;color:' + mutedColor + ';padding-left:6px;border-left:1px solid ' + borderColor + ';}',
    // Compact mode
    '.opedd-compact{background:' + bgColor + ';border:1px solid ' + borderColor + ';border-radius:' + radius + 'px;padding:14px 16px;max-width:360px;box-shadow:0 1px 4px rgba(0,0,0,0.06);}',
    '.opedd-compact-row{display:flex;align-items:center;justify-content:space-between;gap:12px;}',
    '.opedd-compact-info{flex:1;min-width:0;}',
    '.opedd-compact-title{font-size:12px;font-weight:600;color:' + textColor + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.opedd-compact-meta{font-size:10px;color:' + mutedColor + ';margin-top:2px;}',
    '.opedd-compact-btn{flex-shrink:0;padding:8px 16px;border:none;border-radius:' + btnRadius + 'px;background:' + color + ';color:#fff;font-size:12px;font-weight:600;cursor:pointer;text-decoration:none;transition:opacity 0.2s;}',
    '.opedd-compact-btn:hover{opacity:0.9;}',
  ].join('\\n');
  shadow.appendChild(styles);

  var root = document.createElement('div');
  root.className = 'opedd-root';

  if (mode === 'badge') {
    root.innerHTML = '<a class="opedd-badge" target="_blank" rel="noopener"><div class="opedd-badge-icon">O</div><span class="opedd-badge-text">Licensed</span></a>';
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
      countEl.textContent = totalLicenses + ' issued';
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
    if (hasHuman) parts.push('Human $' + parseFloat(article.human_price).toFixed(2));
    if (hasAi) parts.push('AI $' + parseFloat(article.ai_price).toFixed(2));
    if (isFree) parts.push('Free license');
    if (totalLicenses > 0) parts.push(totalLicenses + ' issued');
    meta.textContent = parts.join(' · ');
    info.appendChild(meta);
    row.appendChild(info);

    if (isFree) {
      var btn = document.createElement('button');
      btn.className = 'opedd-compact-btn';
      btn.textContent = 'Get License';
      btn.addEventListener('click', function() {
        showFreeForm(article, wrapper);
      });
      row.appendChild(btn);
    } else {
      var link = document.createElement('a');
      link.className = 'opedd-compact-btn';
      link.textContent = text;
      var frontendUrl = script.getAttribute('data-frontend-url') || 'https://opedd.com';
      link.href = frontendUrl + '/l/' + article.id;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      row.appendChild(link);
    }

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
    header.innerHTML = '<div class="opedd-logo">O</div><span class="opedd-brand">Opedd License</span>';
    card.appendChild(header);

    // Title
    if (article.title) {
      var title = document.createElement('p');
      title.className = 'opedd-title';
      title.textContent = article.title;
      card.appendChild(title);
    }

    // Stats bar
    if (totalLicenses > 0) {
      var stats = document.createElement('div');
      stats.className = 'opedd-stats';

      if (article.human_licenses_sold > 0) {
        var humanStat = document.createElement('div');
        humanStat.className = 'opedd-stat';
        humanStat.innerHTML = '<div class="opedd-stat-value">' + article.human_licenses_sold + '</div><div class="opedd-stat-label">Human Licenses</div>';
        stats.appendChild(humanStat);
      }

      if (article.ai_licenses_sold > 0) {
        var aiStat = document.createElement('div');
        aiStat.className = 'opedd-stat';
        aiStat.innerHTML = '<div class="opedd-stat-value">' + article.ai_licenses_sold + '</div><div class="opedd-stat-label">AI Licenses</div>';
        stats.appendChild(aiStat);
      }

      if (article.human_licenses_sold > 0 && article.ai_licenses_sold > 0) {
        var totalStat = document.createElement('div');
        totalStat.className = 'opedd-stat';
        totalStat.innerHTML = '<div class="opedd-stat-value">' + totalLicenses + '</div><div class="opedd-stat-label">Total</div>';
        stats.appendChild(totalStat);
      }

      card.appendChild(stats);
    }

    // Free license flow
    if (isFree) {
      var desc = document.createElement('p');
      desc.className = 'opedd-desc';
      desc.textContent = 'This content is available for free licensing. Enter your email to receive a license key.';
      card.appendChild(desc);

      showFreeForm(article, card);
      appendFooter(card);
      return;
    }

    // Prices
    if (hasHuman && hasAi) {
      var prices = document.createElement('div');
      prices.className = 'opedd-prices';

      var humanBtn = document.createElement('div');
      humanBtn.className = 'opedd-price' + (selectedType === 'human' ? ' active' : '');
      humanBtn.innerHTML = '<div class="opedd-price-label">Human</div><div class="opedd-price-value">$' + parseFloat(article.human_price).toFixed(2) + '</div>';
      humanBtn.addEventListener('click', function() {
        selectedType = 'human';
        humanBtn.classList.add('active');
        aiBtn.classList.remove('active');
      });
      prices.appendChild(humanBtn);

      var aiBtn = document.createElement('div');
      aiBtn.className = 'opedd-price' + (selectedType === 'ai' ? ' active' : '');
      aiBtn.innerHTML = '<div class="opedd-price-label">AI Training</div><div class="opedd-price-value">$' + parseFloat(article.ai_price).toFixed(2) + '</div>';
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
      priceDiv.textContent = label + ' — $' + parseFloat(price).toFixed(2);
      card.appendChild(priceDiv);
    }

    // CTA button
    var btn = document.createElement('a');
    btn.className = 'opedd-btn';
    btn.textContent = text;
    var frontendUrl = script.getAttribute('data-frontend-url') || 'https://opedd.com';
    btn.href = frontendUrl + '/l/' + article.id;
    btn.target = '_blank';
    btn.rel = 'noopener noreferrer';
    card.appendChild(btn);

    appendFooter(card);
  }

  // === Free license form ===
  function showFreeForm(article, parent) {
    // Remove existing form if any
    var existing = parent.querySelector('.opedd-form');
    if (existing) return;

    var form = document.createElement('div');
    form.className = 'opedd-form';

    var emailInput = document.createElement('input');
    emailInput.className = 'opedd-input';
    emailInput.type = 'email';
    emailInput.placeholder = 'Your email address';
    emailInput.required = true;
    form.appendChild(emailInput);

    var nameInput = document.createElement('input');
    nameInput.className = 'opedd-input';
    nameInput.type = 'text';
    nameInput.placeholder = 'Your name (optional)';
    form.appendChild(nameInput);

    var submitBtn = document.createElement('button');
    submitBtn.className = 'opedd-btn';
    submitBtn.textContent = 'Get Free License';
    submitBtn.type = 'button';
    form.appendChild(submitBtn);

    parent.appendChild(form);

    submitBtn.addEventListener('click', function() {
      var email = emailInput.value.trim();
      if (!email || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
        showMessage(form, 'Please enter a valid email address.', 'error');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Issuing...';

      var payload = {
        article_id: article.id,
        buyer_email: email,
        license_type: 'human'
      };
      var name = nameInput.value.trim();
      if (name) payload.buyer_name = name;

      fetch(supabaseUrl + '/functions/v1/issue-license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      .then(function(res) { return res.json(); })
      .then(function(result) {
        if (result.success && result.data && result.data.license_key) {
          form.innerHTML = '';
          var msg = document.createElement('div');
          msg.className = 'opedd-msg opedd-msg-success';
          msg.innerHTML = 'License issued! Your key: <strong>' + result.data.license_key + '</strong><br>Check your email for the full certificate.';
          form.appendChild(msg);
        } else {
          showMessage(form, result.error || 'Failed to issue license. Please try again.', 'error');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Get Free License';
        }
      })
      .catch(function() {
        showMessage(form, 'Network error. Please try again.', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Get Free License';
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
    footer.innerHTML = 'Powered by <a href="https://opedd.com" target="_blank" rel="noopener">Opedd Protocol</a>';
    parent.appendChild(footer);
  }

  fetchArticle();
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
