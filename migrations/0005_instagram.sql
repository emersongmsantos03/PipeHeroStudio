-- Números diários do Instagram @pipehero.studio (lidos pela API oficial do Instagram, uma vez por dia).
CREATE TABLE IF NOT EXISTS ig_daily (
  day             TEXT PRIMARY KEY,   -- YYYY-MM-DD (UTC)
  followers       INTEGER,
  media           INTEGER,
  reach           INTEGER,
  views           INTEGER,
  profile_views   INTEGER,
  website_clicks  INTEGER,
  accounts_engaged INTEGER,
  interactions    INTEGER,
  fetched_at      TEXT
);
