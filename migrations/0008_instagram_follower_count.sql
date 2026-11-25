-- Métrica diária da API de Insights, separada da contagem total do perfil (followers).
ALTER TABLE ig_daily ADD COLUMN follower_count INTEGER;
