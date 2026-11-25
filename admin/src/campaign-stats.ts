// A venda usa o primeiro formulário ou agendamento identificado antes do fechamento.
export const CAMPAIGN_STATS = `
WITH campaign_actions AS (
  SELECT CASE WHEN json_valid(meta) THEN meta ELSE '{}' END meta, type, lead_id, ref, id
  FROM events
  WHERE created_at>=? AND (
    (source='site' AND type IN ('page_view','demo_started','form_submit','meeting_booked')) OR
    (source='agent' AND type IN ('email_sent','email_click')) OR
    (source='ava' AND type='detailing_demo_reply')
  )
  UNION ALL
  SELECT e.meta, 'won', l.id, NULL, e.id
  FROM leads l
  JOIN events e ON e.id = (
    SELECT first_touch.id FROM events first_touch
    WHERE first_touch.lead_id=l.id AND first_touch.source='site'
      AND first_touch.type IN ('form_submit','meeting_booked') AND first_touch.created_at<=l.closed_at
      AND NULLIF(json_extract(CASE WHEN json_valid(first_touch.meta) THEN first_touch.meta ELSE '{}' END, '$.utm_source'), '') IS NOT NULL
    ORDER BY first_touch.created_at, first_touch.id LIMIT 1
  )
  WHERE l.stage='won' AND l.closed_at>=?
)
SELECT json_extract(meta, '$.utm_source') origin,
       json_extract(meta, '$.utm_medium') medium,
       json_extract(meta, '$.utm_campaign') campaign,
       COUNT(DISTINCT CASE WHEN type='email_sent' THEN COALESCE(json_extract(meta, '$.send_id'), 'event:' || id) END) accepted,
       COUNT(DISTINCT CASE WHEN type='email_click' THEN ref END) clicks,
       SUM(type='page_view') views,
       SUM(type='demo_started' AND COALESCE(json_extract(meta, '$.offer'),'') NOT IN ('detailing_quote','detailing_booking')) demos,
       COUNT(DISTINCT CASE WHEN type='detailing_demo_reply' AND json_extract(meta, '$.mode')='customer' THEN ref END) ava,
       SUM(type='demo_started' AND json_extract(meta, '$.offer') IN ('detailing_quote','detailing_booking')) sample_quotes,
       COUNT(DISTINCT CASE WHEN type='form_submit' THEN lead_id END) forms,
       SUM(type='meeting_booked') meetings,
       SUM(type='won') wins
FROM campaign_actions
WHERE NULLIF(json_extract(meta, '$.utm_source'), '') IS NOT NULL
GROUP BY origin, medium, campaign
ORDER BY wins DESC, meetings DESC, forms DESC, ava DESC, views DESC, accepted DESC, origin, medium, campaign
`;
