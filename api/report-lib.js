// Pure report builder. Used by api/report.js (server) and by build-sample.js (demo preview). No network here.
const C = require('./_core.js');
const DAY = 864e5;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const ms = (d) => Date.parse(d + 'T00:00:00Z');
const addDays = (d, n) => iso(ms(d) + n * DAY);
const mondayOf = (d) => { const dow = (new Date(ms(d)).getUTCDay() + 6) % 7; return addDays(d, -dow); };
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const change = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);

function inRange(rows, from, to) { return rows.filter(r => r.day >= from && r.day <= to); }
function sources(rows) { const o = {}; rows.forEach(r => Object.entries(r.leads_by_source || {}).forEach(([k, v]) => { o[k] = (o[k] || 0) + v; })); return Object.entries(o).sort((a, b) => b[1] - a[1]).map(([name, leads]) => ({ name, leads })); }

/** range: 'this_week' | 'last_week' | 'last_30'. today: 'YYYY-MM-DD' (UTC). */
function buildReport(client, rows, summary, range, today) {
  const thisMon = mondayOf(today);
  let from, to, label;
  if (range === 'this_week') { from = thisMon; to = today; label = 'This week so far'; }
  else if (range === 'last_30') { to = today; from = addDays(today, -29); label = 'Last 30 days'; }
  else { range = 'last_week'; from = addDays(thisMon, -7); to = addDays(thisMon, -1); label = 'Last week'; }
  const len = Math.round((ms(to) - ms(from)) / DAY) + 1;
  // Compare "this week so far" against the same number of days of last week, so a Tuesday is not compared with a full week.
  const pTo = range === 'this_week' ? addDays(thisMon, -7 + (len - 1)) : addDays(from, -1);
  const pFrom = range === 'this_week' ? addDays(thisMon, -7) : addDays(from, -len);
  const cur = C.summarizeRows(inRange(rows, from, to), client.ad_spend_weekly, len / 7);
  const prev = C.summarizeRows(inRange(rows, pFrom, pTo), client.ad_spend_weekly, len / 7);
  const wow = { leads: change(cur.leads, prev.leads), bookings: change(cur.bookings, prev.bookings), won: change(cur.won, prev.won),
    show_rate_points: cur.show_rate != null && prev.show_rate != null ? Math.round((cur.show_rate - prev.show_rate) * 10) / 10 : null,
    revenue: cur.revenue != null && prev.revenue != null ? change(cur.revenue, prev.revenue) : null };
  // 12 full weeks ending last Sunday
  const weeks = [];
  for (let i = 12; i >= 1; i--) { const s = addDays(thisMon, -7 * i), e = addDays(s, 6); const w = C.summarizeRows(inRange(rows, s, e), client.ad_spend_weekly, 1); weeks.push({ week_start: s, leads: w.leads, bookings: w.bookings, showed: w.showed, noshow: w.noshow, show_rate: w.show_rate }); }
  const hasData = rows.length > 0;
  const flags = [];
  if (hasData && cur.leads === 0) flags.push('zero_leads');
  if (!cur.revenue_tracked) flags.push('revenue_not_tracked');
  if (client.ad_spend_weekly == null) flags.push('no_ad_spend');
  if (cur.showed + cur.noshow > 0 && cur.showed + cur.noshow < 8) flags.push('few_appointments');
  return {
    client: { name: client.name, slug: client.slug }, range, label, from, to, compare: { from: pFrom, to: pTo, days: len },
    current: cur, previous: prev, change: wow, weeks, sources: sources(inRange(rows, from, to)),
    funnel: [{ key: 'leads', label: 'New leads', n: cur.leads }, { key: 'bookings', label: 'Booked a call', n: cur.bookings }, { key: 'showed', label: 'Showed up', n: cur.showed }, { key: 'won', label: 'New policies', n: cur.won }],
    summary: summary || null, flags, has_data: hasData, last_synced: rows.reduce((m, r) => (r.synced_at && r.synced_at > m ? r.synced_at : m), '') || null,
    mode: (rows[0] && rows[0].source_mode) || null
  };
}
module.exports = { buildReport, mondayOf, addDays };
