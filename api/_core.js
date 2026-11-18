/* Core metric logic - pure JavaScript, no dependencies.
 * The same code is pasted into the n8n "Compute" Code nodes, and is unit-tested in Node and against the real GHL data.
 *
 * MODE = 'demo' | 'live'
 *   demo: dates for leads / bookings / wins come from the "Demo ... Date" custom fields (GHL cannot backdate them).
 *         Show / no-show dates are the REAL appointment start times (GHL can backdate those).
 *   live: lead date = contact.dateAdded, booking date = appointment.dateAdded, won date = opportunity.lastStatusChangeAt.
 */
(function (root) {
  const dayKey = (v) => new Date(v).toISOString().slice(0, 10);
  const lc = (s) => (s || '').toString().trim().toLowerCase();

  /** contacts: GHL contact objects ({id,email,source,tags,dateAdded,customFields:[{id,value}]})
   *  events:   GHL calendar events ({contactId,startTime,dateAdded,appointmentStatus})
   *  opps:     GHL opportunities ({contactId,status,monetaryValue,lastStatusChangeAt})
   *  client:   {id, slug, ghl_tag, ad_spend_weekly}
   *  cfg:      {mode, fieldIds:{demo_lead_date,demo_booked_date,demo_won_date,demo_first_message_at}}
   *  range:    {from:'YYYY-MM-DD', to:'YYYY-MM-DD'}   (inclusive, UTC days)
   *  returns:  {rows:[...one per day...], warnings:[...]} */
  function computeDaily(client, contacts, events, opps, cfg, range) {
    const warnings = [];
    const demo = cfg.mode === 'demo';
    const F = cfg.fieldIds || {};
    const cfv = (c, id) => { const f = (c.customFields || []).find(x => x.id === id); return f ? f.value : null; };

    // 1) this client's contacts, de-duplicated by email
    const mine = new Map();           // contactId -> info
    const seenEmail = new Set();
    let dupes = 0;
    for (const c of contacts) {
      if (!(c.tags || []).map(lc).includes(lc(client.ghl_tag))) continue;
      const email = lc(c.email);
      if (email && seenEmail.has(email)) { dupes++; continue; }
      if (email) seenEmail.add(email);
      const leadAt = demo ? cfv(c, F.demo_lead_date) : c.dateAdded;
      if (!leadAt) { continue; }       // demo mode: skip anything that is not a seeded record
      mine.set(c.id, {
        leadAt,
        source: c.source || 'Unknown',
        bookedAt: demo ? cfv(c, F.demo_booked_date) : null,
        wonAt: demo ? cfv(c, F.demo_won_date) : null,
        firstMsgAt: demo ? cfv(c, F.demo_first_message_at) : null
      });
    }
    if (dupes) warnings.push(dupes + ' duplicate contact(s) ignored for ' + client.slug);

    const days = {};
    const day = (d) => days[d] || (days[d] = { day: d, leads: 0, leads_by_source: {}, bookings: 0, showed: 0, noshow: 0, won: 0, revenue: 0, speed_minutes: [] });
    const inRange = (d) => d >= range.from && d <= range.to;

    // 2) leads + speed to lead
    for (const m of mine.values()) {
      const d = dayKey(m.leadAt); if (!inRange(d)) continue;
      const r = day(d); r.leads++; r.leads_by_source[m.source] = (r.leads_by_source[m.source] || 0) + 1;
      if (demo && m.firstMsgAt) { const mins = Math.round((Date.parse(m.firstMsgAt) - Date.parse(m.leadAt)) / 60000); if (mins >= 0) r.speed_minutes.push(mins); }
    }
    // 3) appointments: bookings (created) and show / no-show (due)
    const seenEvt = new Set();
    let missingStatus = 0;
    for (const e of events) {
      const m = mine.get(e.contactId); if (!m) continue;
      if (e.id) { if (seenEvt.has(e.id)) continue; seenEvt.add(e.id); }
      const bookedDay = dayKey(demo ? (m.bookedAt || e.dateAdded) : e.dateAdded);
      if (inRange(bookedDay)) day(bookedDay).bookings++;
      const due = dayKey(e.startTime);
      if (inRange(due)) {
        const s = lc(e.appointmentStatus);
        if (s === 'showed') day(due).showed++;
        else if (s === 'noshow') day(due).noshow++;
        else if (Date.parse(e.startTime) < Date.now() - 3 * 3600e3 && s !== 'cancelled') missingStatus++;
      }
    }
    if (missingStatus) warnings.push(missingStatus + ' past appointment(s) for ' + client.slug + ' have no showed/no-show status; left out of the show rate');
    // 4) revenue = value of opportunities moved to Won
    const seenOpp = new Set();
    for (const o of opps) {
      if (lc(o.status) !== 'won') continue;
      if (o.id) { if (seenOpp.has(o.id)) continue; seenOpp.add(o.id); }   // the same opportunity can come back twice when a node runs once per client
      const m = mine.get(o.contactId); if (!m) continue;
      const d = dayKey(demo ? (m.wonAt || o.lastStatusChangeAt) : o.lastStatusChangeAt); if (!inRange(d)) continue;
      const r = day(d); r.won++; r.revenue += Number(o.monetaryValue) || 0;
    }
    // 5) fill every day in range (zero rows are real data: "no leads that day")
    const out = [];
    for (let t = Date.parse(range.from + 'T00:00:00Z'); t <= Date.parse(range.to + 'T00:00:00Z'); t += 864e5) {
      const k = dayKey(t); const r = day(k);
      r.revenue_tracked = !(r.won > 0 && r.revenue === 0);
      r.ad_spend = client.ad_spend_weekly == null ? null : Math.round((client.ad_spend_weekly / 7) * 100) / 100;
      r.source_mode = cfg.mode;
      out.push(r);
    }
    return { rows: out, warnings };
  }

  // ---------- weekly numbers for the email / page ----------
  const sum = (a, f) => a.reduce((s, x) => s + (f(x) || 0), 0);
  function median(a) { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);          // 0-100, one decimal
  const change = (cur, prev) => (cur == null || prev == null || prev === 0 ? null : Math.round(((cur - prev) / prev) * 1000) / 10);

  function summarizeRows(rows, adSpendWeekly, weeksFactor) {
    const leads = sum(rows, r => r.leads), bookings = sum(rows, r => r.bookings), showed = sum(rows, r => r.showed), noshow = sum(rows, r => r.noshow);
    const won = sum(rows, r => r.won), revenue = sum(rows, r => r.revenue);
    const speeds = [].concat(...rows.map(r => r.speed_minutes || []));
    const spend = adSpendWeekly == null ? null : adSpendWeekly * (weeksFactor || 1);
    const revenueTracked = !(won > 0 && revenue === 0);
    return {
      leads, bookings, booking_rate: pct(bookings, leads), showed, noshow, show_rate: pct(showed, showed + noshow),
      won, revenue: revenueTracked ? Math.round(revenue) : null, revenue_tracked: revenueTracked,
      speed_median_min: median(speeds), ad_spend: spend,
      cost_per_lead: spend != null && leads > 0 ? Math.round((spend / leads) * 100) / 100 : null,
      cost_per_booking: spend != null && bookings > 0 ? Math.round((spend / bookings) * 100) / 100 : null
    };
  }

  /** rowsByDay: daily_metrics rows for one client (any order). weekStart = Monday 'YYYY-MM-DD' of the week to report. */
  function weeklyMetrics(rowsByDay, weekStart, adSpendWeekly) {
    const wk = (startISO, nDays) => { const s = Date.parse(startISO + 'T00:00:00Z'); const a = dayKey(s), b = dayKey(s + (nDays - 1) * 864e5); return rowsByDay.filter(r => r.day >= a && r.day <= b); };
    const addDays = (iso, n) => dayKey(Date.parse(iso + 'T00:00:00Z') + n * 864e5);
    const prevStart = addDays(weekStart, -7);
    const thisWeek = summarizeRows(wk(weekStart, 7), adSpendWeekly, 1);
    const prevWeek = summarizeRows(wk(prevStart, 7), adSpendWeekly, 1);
    const fourStart = addDays(weekStart, -28);
    const four = summarizeRows(wk(fourStart, 28), adSpendWeekly, 4);
    const avg = { leads: four.leads / 4, bookings: four.bookings / 4, show_rate: four.show_rate, won: four.won / 4, revenue: four.revenue == null ? null : four.revenue / 4 };
    const wow = { leads: change(thisWeek.leads, prevWeek.leads), bookings: change(thisWeek.bookings, prevWeek.bookings), show_rate_points: thisWeek.show_rate != null && prevWeek.show_rate != null ? Math.round((thisWeek.show_rate - prevWeek.show_rate) * 10) / 10 : null,
      won: change(thisWeek.won, prevWeek.won), revenue: change(thisWeek.revenue, prevWeek.revenue) };
    const flags = [];
    if (thisWeek.leads === 0) flags.push('zero_leads_this_week');
    if (wow.leads != null && wow.leads <= -30) flags.push('leads_dropped_sharply');
    if (wow.show_rate_points != null && wow.show_rate_points <= -10) flags.push('show_rate_dropped');
    if (thisWeek.show_rate != null && four.show_rate != null && thisWeek.show_rate <= four.show_rate - 10) flags.push('show_rate_below_4_week_average');
    if (!thisWeek.revenue_tracked) flags.push('revenue_not_tracked_for_this_account');
    if (adSpendWeekly == null) flags.push('ad_spend_not_entered');
    if (thisWeek.showed + thisWeek.noshow > 0 && thisWeek.showed + thisWeek.noshow < 8) flags.push('small_number_of_appointments');
    if (!wk(weekStart, 7).length) flags.push('no_data_synced_for_this_week');
    return { week_start: weekStart, week_end: addDays(weekStart, 6), this_week: thisWeek, previous_week: prevWeek, four_week_average: avg, week_over_week_change: wow, data_flags: flags };
  }

  const api = { computeDaily, weeklyMetrics, summarizeRows, dayKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NorthstarCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
