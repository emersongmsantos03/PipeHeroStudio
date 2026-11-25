export async function detailingStats(db: D1Database) {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [metrics, regions, today, inbox] = await db.batch([
    db.prepare(`SELECT
      COALESCE(SUM(type='page_view'),0) visits,
      COALESCE(SUM(type='demo_started' AND json_extract(meta,'$.offer')='detailing'),0) starts,
      COALESCE(SUM(type='demo_started' AND json_extract(meta,'$.offer') IN ('detailing_quote','detailing_booking')),0) quotes,
      COALESCE(SUM(type='detailing_demo_reply' AND json_extract(meta,'$.mode')='customer'),0) customer_replies,
      COALESCE(SUM(type='detailing_demo_reply' AND json_extract(meta,'$.photo')=1),0) photos,
      COALESCE(SUM(type='detailing_demo_reply' AND json_extract(meta,'$.mode')='owner'),0) owner_replies,
      COALESCE(SUM(type='detailing_demo_error'),0) errors,
      COALESCE(SUM(type='form_submit' AND lead_id IS NOT NULL),0) requests
      FROM events WHERE created_at >= ? AND
      ((type IN ('page_view','demo_started') AND ref='/en/demo/') OR
      type IN ('detailing_demo_reply','detailing_demo_error') OR
      (type='form_submit' AND json_extract(meta,'$.detailing')=1))`).bind(since),
    db.prepare(`SELECT country, COUNT(*) prospects, SUM(CASE WHEN score>=6 AND do_not_contact=0 THEN 1 ELSE 0 END) scored
      FROM prospects WHERE lower(category) LIKE '%detailing%' GROUP BY country ORDER BY prospects DESC LIMIT 15`),
    db.prepare('SELECT value FROM settings WHERE key=?').bind('detailing_demo_calls:' + new Date().toISOString().slice(0, 10)),
    db.prepare("SELECT id, business, country, stage FROM leads WHERE business_type='auto-detailing' ORDER BY created_at DESC LIMIT 8"),
  ]);
  return { metrics: metrics.results[0], regions: regions.results, today: Number(today.results[0]?.value || 0), leads: inbox.results };
}
