// Vercel serverless function: GET /api/report?slug=maple&k=<share_token>&range=last_week
// The browser never sees the database. The service key lives only in Vercel environment variables.
const { buildReport } = require('./report-lib.js');
const safeEq = (a, b) => { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const { slug, k, range } = req.query || {};
  const URL_ = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!URL_ || !KEY) return res.status(500).json({ error: 'server_not_configured' });
  if (!slug || !k || !/^[a-z0-9-]{1,40}$/.test(slug)) return res.status(404).json({ error: 'not_found' });
  const h = { apikey: KEY, Authorization: 'Bearer ' + KEY };
  try {
    const cr = await fetch(`${URL_}/rest/v1/clients?slug=eq.${slug}&active=eq.true&select=id,slug,name,ad_spend_weekly,share_token`, { headers: h });
    if (!cr.ok) throw new Error('clients ' + cr.status);
    const client = (await cr.json())[0];
    // Same answer for "no such client" and "wrong token", so links cannot be guessed client by client.
    if (!client || !safeEq(client.share_token, k)) return res.status(404).json({ error: 'not_found' });
    const since = new Date(Date.now() - 100 * 864e5).toISOString().slice(0, 10);
    const [dr, sr] = await Promise.all([
      fetch(`${URL_}/rest/v1/daily_metrics?client_id=eq.${client.id}&day=gte.${since}&select=day,leads,leads_by_source,bookings,showed,noshow,won,revenue,revenue_tracked,speed_minutes,source_mode,synced_at&order=day.asc&limit=1000`, { headers: h }),
      fetch(`${URL_}/rest/v1/weekly_summaries?client_id=eq.${client.id}&select=week_start,summary,created_at&order=week_start.desc&limit=1`, { headers: h })
    ]);
    if (!dr.ok || !sr.ok) throw new Error('data ' + dr.status + '/' + sr.status);
    const rows = await dr.json(); const s = (await sr.json())[0] || null;
    const today = new Date().toISOString().slice(0, 10);
    const out = buildReport(client, rows, s && { week_start: s.week_start, created_at: s.created_at, ...s.summary }, range, today);
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: 'upstream', detail: String(e.message || e).slice(0, 120) });
  }
};
