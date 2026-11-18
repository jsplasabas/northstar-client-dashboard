(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var NS = 'http://www.w3.org/2000/svg';
  var params = new URLSearchParams(location.search);
  var pathSlug = (location.pathname.match(/\/client\/([a-z0-9-]+)/) || [])[1];
  var slug = pathSlug || params.get('slug');
  var token = params.get('k');
  var demo = params.get('demo') === '1';
  var state = { range: 'last_week', data: null, first: true };
  var sample = null;

  // Keep the token out of the address bar and history after load.
  if (token && history.replaceState) { try { history.replaceState(null, '', location.pathname + (demo ? '?demo=1&slug=' + slug : '')); } catch (e) {} }

  function el(tag, attrs, text) { var n = document.createElement(tag); if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]); if (text != null) n.textContent = text; return n; }
  function sv(tag, attrs) { var n = document.createElementNS(NS, tag); if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]); return n; }
  function show(id) { ['loading', 'problem', 'empty', 'report'].forEach(function (x) { $(x).hidden = x !== id; }); }
  var fmtInt = function (n) { return Number(n).toLocaleString('en-US'); };
  var money = function (n) { return '$' + Number(n).toLocaleString('en-US'); };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function d(iso) { var p = iso.split('-'); return MON[+p[1] - 1] + ' ' + +p[2]; }

  function load(range) {
    if (demo) {
      var p = sample ? Promise.resolve(sample) : fetch('/sample.json').then(function (r) { if (!r.ok) throw new Error('nodemo'); return r.json(); }).then(function (j) { sample = j; return j; });
      return p.then(function (j) { var c = j[slug]; if (!c) throw { status: 404 }; return c[range]; });
    }
    var q = '/api/report?slug=' + encodeURIComponent(slug) + '&range=' + range + '&k=' + encodeURIComponent(token);
    return fetch(q, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw { status: r.status }; return r.json(); });
  }

  function go(range) {
    state.range = range;
    document.querySelectorAll('.seg button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.range === range)); });
    if (state.first) show('loading'); else $('kpis').style.opacity = '0.5';
    load(range).then(function (data) {
      state.data = data; $('kpis').style.opacity = '';
      if (!data.has_data) { show('empty'); return; }
      show('report'); render(data); state.first = false;
    }).catch(function (e) {
      if (e && e.status === 404 || !slug || (!token && !demo)) { $('problem-title').textContent = 'This link does not work'; $('problem-text').textContent = 'Check that you copied the whole link from your email. If it still fails, reply to that email and we will send a new one.'; }
      else { $('problem-title').textContent = 'Numbers are not loading right now'; $('problem-text').textContent = 'This is on our side and your data is safe. Please try again in a few minutes. If it keeps happening, reply to your weekly email.'; }
      show('problem');
    });
  }

  // ---------- render ----------
  function chip(change, unit, label) {
    var c = el('span', { class: 'chip' });
    if (change == null) { c.textContent = 'No earlier period to compare'; return c; }
    var up = change > 0, flat = change === 0;
    c.className = 'chip ' + (flat ? '' : up ? 'up' : 'down');
    if (!flat) { var s = sv('svg', { viewBox: '0 0 10 10', 'aria-hidden': 'true' }); s.appendChild(sv('path', { d: up ? 'M5 1 L9 8 L1 8 Z' : 'M5 9 L9 2 L1 2 Z', fill: 'currentColor' })); c.appendChild(s); }
    c.appendChild(document.createTextNode((flat ? 'No change' : (up ? 'Up ' : 'Down ') + Math.abs(change) + unit) + ' ' + label));
    return c;
  }

  function kpi(label, value, sub, empty) {
    var k = el('div', { class: 'kpi' });
    k.appendChild(el('span', { class: 'label' }, label));
    var v = el('span', { class: 'value num' + (empty ? ' is-empty' : '') }, value); k.appendChild(v);
    k.appendChild(sub); return k;
  }

  function render(data) {
    var c = data.current, ch = data.change;
    var vs = data.range === 'this_week' ? 'vs same days last week' : data.range === 'last_30' ? 'vs the 30 days before' : 'vs the week before';
    $('who').textContent = data.client.name;
    $('title').textContent = data.label;
    $('rangeline').textContent = d(data.from) + ' to ' + d(data.to) + (data.range === 'this_week' ? ' (week still in progress)' : '') + '. Compared with ' + d(data.compare.from) + ' to ' + d(data.compare.to) + '.';
    document.title = data.client.name + ' · ' + data.label;

    var k = $('kpis'); k.textContent = '';
    k.appendChild(kpi('New leads', fmtInt(c.leads), data.has_data && c.leads === 0 ? el('span', { class: 'chip' }, 'No new leads in this period') : chip(ch.leads, '%', vs)));
    k.appendChild(kpi('Booked a call', fmtInt(c.bookings), chip(ch.bookings, '%', vs)));
    var srSub = c.show_rate == null ? el('span', { class: 'chip' }, 'No completed calls yet') : chip(ch.show_rate_points, ' pts', vs);
    k.appendChild(kpi('Showed up', c.show_rate == null ? 'n/a' : c.show_rate + '%', srSub, c.show_rate == null));
    if (c.revenue_tracked) k.appendChild(kpi('Sales closed', money(c.revenue), chip(ch.revenue, '%', vs)));
    else k.appendChild(kpi('Sales closed', 'Not tracked', el('span', { class: 'chip' }, fmtInt(c.won) + ' new ' + (c.won === 1 ? 'policy' : 'policies') + '. Deal values are not entered.'), true));

    renderNote(data);
    renderChart(data);
    renderFunnel(data);
    renderSources(data);
    renderFacts(data);
    $('footer').textContent = (data.mode === 'demo' ? 'Demo data. Everything on this page is fictional and was created to show how the report works. ' : '') + 'Numbers come from your GoHighLevel account and update every night' + (data.last_synced ? '. Last update: ' + new Date(data.last_synced).toUTCString().replace(' GMT', ' UTC') : '') + '.';
  }

  function renderNote(data) {
    var s = data.summary, box = $('note-body'); box.textContent = '';
    if (!s) { $('note').hidden = false; box.appendChild(el('p', { class: 'muted' }, 'The first weekly note arrives on Monday morning.')); return; }
    $('note-h').textContent = s.headline;
    var ul = el('ul'); s.bullets.forEach(function (b) { ul.appendChild(el('li', null, b)); }); box.appendChild(ul);
    var dl = el('dl'); dl.style.marginTop = 'var(--s4)';
    [['Went well', s.win], ['Worth watching', s.watch], ['Our next step', s.next_step]].forEach(function (p) { if (p[1]) { var w = el('div'); w.appendChild(el('dt', null, p[0])); w.appendChild(el('dd', null, p[1])); dl.appendChild(w); } });
    box.appendChild(dl);
    box.appendChild(el('p', { class: 'when', style: 'margin-top:var(--s3)' }, 'Written by Claude from the numbers below. Week of ' + d(s.week_start) + '.'));
  }

  // ---------- chart ----------
  var SERIES = [{ key: 'leads', name: 'New leads', color: '--series-1' }, { key: 'bookings', name: 'Booked a call', color: '--series-2' }, { key: 'showed', name: 'Showed up', color: '--series-3' }];
  function renderChart(data) {
    var lg = $('legend'); lg.textContent = '';
    SERIES.forEach(function (s) { var sp = el('span'); var i = el('i'); i.style.background = 'var(' + s.color + ')'; sp.appendChild(i); sp.appendChild(document.createTextNode(s.name)); lg.appendChild(sp); });
    draw(data);
    // table view
    var tw = $('tablewrap'); tw.textContent = '';
    var t = el('table', { class: 'data' }); t.appendChild(el('caption', null, 'Weekly totals, Monday to Sunday'));
    var hr = el('tr'); ['Week of', 'Leads', 'Booked', 'Showed', 'Show-up rate'].forEach(function (h) { hr.appendChild(el('th', { scope: 'col' }, h)); }); var th = el('thead'); th.appendChild(hr); t.appendChild(th);
    var tb = el('tbody'); data.weeks.slice().reverse().forEach(function (w) { var r = el('tr'); [d(w.week_start), fmtInt(w.leads), fmtInt(w.bookings), fmtInt(w.showed), w.show_rate == null ? 'n/a' : w.show_rate + '%'].forEach(function (v, i) { r.appendChild(el(i ? 'td' : 'th', i ? null : { scope: 'row' }, v)); }); tb.appendChild(r); }); t.appendChild(tb); tw.appendChild(t);
  }
  function draw(data) {
    var box = $('chart'); box.textContent = '';
    var W = Math.max(box.clientWidth, 260), H = W < 520 ? 220 : 280;
    var m = { l: 34, r: 12, t: 12, b: 26 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    var weeks = data.weeks, n = weeks.length;
    var max = 0; weeks.forEach(function (w) { SERIES.forEach(function (s) { max = Math.max(max, w[s.key]); }); });
    var step = max <= 10 ? 2 : max <= 30 ? 5 : max <= 60 ? 10 : 20; var top = Math.max(step, Math.ceil(max / step) * step);
    var x = function (i) { return m.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw); }, y = function (v) { return m.t + ih - (v / top) * ih; };
    var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': 'Line chart of weekly leads, booked calls and show-ups for the last 12 weeks. The same numbers are in the table below.' });
    for (var g = 0; g <= top; g += step) { svg.appendChild(sv('line', { x1: m.l, x2: W - m.r, y1: y(g), y2: y(g), class: g === 0 ? 'axis' : 'grid' })); var tx = sv('text', { x: m.l - 6, y: y(g) + 4, 'text-anchor': 'end' }); tx.textContent = g; svg.appendChild(tx); }
    var every = W < 520 ? 3 : 2;
    weeks.forEach(function (w, i) { if ((n - 1 - i) % every === 0) { var tl = sv('text', { x: x(i), y: H - 6, 'text-anchor': 'middle' }); tl.textContent = d(w.week_start); svg.appendChild(tl); } });
    SERIES.forEach(function (s) {
      var p = weeks.map(function (w, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(w[s.key]).toFixed(1); }).join(' ');
      svg.appendChild(sv('path', { d: p, class: 'ln', stroke: 'var(' + s.color + ')' }));
      var li = n - 1; svg.appendChild(sv('circle', { cx: x(li), cy: y(weeks[li][s.key]), r: 4, class: 'dot', fill: 'var(' + s.color + ')' }));
    });
    var cross = sv('line', { class: 'cross', y1: m.t, y2: m.t + ih }); svg.appendChild(cross);
    var dots = SERIES.map(function (s) { var c = sv('circle', { r: 4.5, class: 'dot', fill: 'var(' + s.color + ')', opacity: 0 }); svg.appendChild(c); return c; });
    var hit = sv('rect', { x: m.l, y: m.t, width: iw, height: ih, class: 'hit' }); svg.appendChild(hit);
    box.appendChild(svg);
    var tip = el('div', { class: 'tip', role: 'status' }); box.appendChild(tip);
    function at(clientX) {
      var r = svg.getBoundingClientRect(); var px = (clientX - r.left) * (W / r.width);
      var i = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
      var w = weeks[i]; cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.style.opacity = 1;
      dots.forEach(function (c, k) { c.setAttribute('cx', x(i)); c.setAttribute('cy', y(w[SERIES[k].key])); c.setAttribute('opacity', 1); });
      tip.textContent = ''; tip.appendChild(el('b', null, 'Week of ' + d(w.week_start)));
      SERIES.forEach(function (s) { var row = el('div'); row.appendChild(el('span', null, s.name)); row.appendChild(el('b', { class: 'num', style: 'display:inline;margin:0' }, fmtInt(w[s.key]))); tip.appendChild(row); });
      var sx = (x(i) / W) * r.width; tip.style.left = Math.max(0, Math.min(r.width - 160, sx + 12)) + 'px'; tip.style.top = '0px'; tip.classList.add('on');
    }
    function off() { cross.style.opacity = 0; dots.forEach(function (c) { c.setAttribute('opacity', 0); }); tip.classList.remove('on'); }
    hit.addEventListener('pointermove', function (e) { at(e.clientX); });
    hit.addEventListener('pointerdown', function (e) { at(e.clientX); });
    hit.addEventListener('pointerleave', off);
  }

  // ---------- funnel and sources ----------
  function bars(ul, items, colorFor, first, note) {
    ul.textContent = '';
    var max = Math.max.apply(null, items.map(function (i) { return i.n; }).concat([1]));
    items.forEach(function (it, idx) {
      var li = el('li', { class: 'bar' }); var row = el('div', { class: 'row' }); row.appendChild(el('span', null, it.label)); row.appendChild(el('b', { class: 'num' }, fmtInt(it.n) + (it.extra ? ' · ' + it.extra : ''))); li.appendChild(row);
      var tr = el('div', { class: 'track', 'aria-hidden': 'true' }); var f = el('div', { class: 'fill' }); f.style.background = 'var(' + colorFor(idx) + ')'; var w = it.n / max; f.style.width = '100%';
      if (first && !matchMedia('(prefers-reduced-motion: reduce)').matches) { f.style.transform = 'scaleX(0)'; requestAnimationFrame(function () { requestAnimationFrame(function () { f.style.transform = 'scaleX(' + w + ')'; }); }); } else f.style.transform = 'scaleX(' + w + ')';
      tr.appendChild(f); li.appendChild(tr); if (it.step) li.appendChild(el('span', { class: 'step' }, it.step)); ul.appendChild(li);
    });
  }
  function renderFunnel(data) {
    var c = data.current; var f = data.funnel;
    $('funnel-lede').textContent = 'Each step is counted on its own dates, so a lead from last week can book or show up this week.';
    var items = f.map(function (s) { return { label: s.label, n: s.n, extra: null, step: null }; });
    if (c.leads > 0) items[1].extra = c.booking_rate + '% of leads';
    if (c.show_rate != null) items[2].extra = c.show_rate + '% of calls held';
    bars($('funnel'), items, function (i) { return ['--series-1', '--series-2', '--series-3', '--muted'][i]; }, state.first);
  }
  function renderSources(data) {
    var s = data.sources, ul = $('sources');
    if (!s.length) { ul.textContent = ''; ul.appendChild(el('li', { class: 'muted' }, 'No leads in this period.')); $('src-lede').textContent = ''; return; }
    var total = s.reduce(function (a, b) { return a + b.leads; }, 0);
    $('src-lede').textContent = 'Share of the ' + fmtInt(total) + ' new leads in this period.';
    bars(ul, s.map(function (x) { return { label: x.name, n: x.leads, extra: Math.round((x.leads / total) * 100) + '%' }; }), function () { return '--series-1'; }, state.first);
  }
  function renderFacts(data) {
    var c = data.current, f = $('facts'); f.textContent = '';
    var rows = [
      ['New policies', fmtInt(c.won)],
      ['Calls held (showed or no-show)', fmtInt(c.showed + c.noshow)],
      ['Time to first reply (middle value)', c.speed_median_min == null ? 'n/a' : c.speed_median_min + ' min'],
      ['Cost per lead', c.cost_per_lead == null ? 'Ad spend not entered' : '$' + c.cost_per_lead.toFixed(2)],
      ['Cost per booked call', c.cost_per_booking == null ? 'Ad spend not entered' : '$' + c.cost_per_booking.toFixed(2)],
      ['Leads that became a booked call', c.booking_rate == null ? 'n/a' : c.booking_rate + '%']
    ];
    rows.forEach(function (r) { var x = el('div', { class: 'fact' }); x.appendChild(el('span', null, r[0])); x.appendChild(el('b', { class: 'num' }, r[1])); f.appendChild(x); });
    var old = f.parentNode.querySelector('.few-note'); if (old) old.remove();
    if (data.flags.indexOf('few_appointments') >= 0) { var n = el('p', { class: 'sourcebox few-note', style: 'margin-top:var(--s4)' }, 'Fewer than 8 calls were held, so the show-up rate can swing a lot from one week to the next.'); f.parentNode.appendChild(n); }
  }

  // ---------- wiring ----------
  document.querySelectorAll('.seg button').forEach(function (b) { b.addEventListener('click', function () { if (b.dataset.range !== state.range) go(b.dataset.range); }); });
  $('tabletoggle').addEventListener('click', function () { var o = $('tablewrap').hidden; $('tablewrap').hidden = !o; this.setAttribute('aria-expanded', String(o)); this.textContent = o ? 'Hide the table' : 'Show as a table'; });
  var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (state.data && !$('report').hidden) draw(state.data); }, 150); });
  go('last_week');
})();
