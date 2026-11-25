const INSTAGRAM_ACCOUNT = '17841455671491125';
const GRAPH_VERSION = 'v21.0';
const FACEBOOK_ORIGIN = 'https://graph.facebook.com';
const INSTAGRAM_ORIGIN = 'https://graph.instagram.com';

const CORE_METRICS = ['reach', 'profile_views', 'website_clicks'] as const;
const EXTRA_METRICS = ['follower_count', 'accounts_engaged'] as const;
const METRICS = [...CORE_METRICS, ...EXTRA_METRICS] as const;
type Metric = typeof METRICS[number];

export type InstagramProfile = {
  username: string;
  followers_count?: number;
  media_count?: number;
};

class InstagramError extends Error {}

export function instagramSource(token: string) {
  if (token.startsWith('EAA')) return 'facebook';
  if (token.startsWith('IG')) return 'instagram';
  return null;
}

function graphUrl(token: string, endpoint: '' | '/insights', params: Record<string, string>) {
  const source = instagramSource(token);
  if (!source) throw new InstagramError('O token salvo tem um formato desconhecido. Reconecte o Instagram.');
  const origin = source === 'facebook' ? FACEBOOK_ORIGIN : INSTAGRAM_ORIGIN;
  const url = new URL(`/${GRAPH_VERSION}/${INSTAGRAM_ACCOUNT}${endpoint}`, origin);
  url.search = new URLSearchParams(params).toString();
  return url;
}

function metaText(value: unknown, token: string) {
  if (typeof value !== 'string') return null;
  return value.replaceAll(token, '[credencial ocultada]')
    .replace(/\b(?:EAA|IG)[A-Za-z0-9]{50,}\b/g, '[credencial ocultada]')
    .trim().slice(0, 1000) || null;
}

async function igGet<T>(url: URL, token: string, tokenInQuery = false): Promise<T> {
  const requestInfo = { host: url.host, path: url.pathname, metric: url.searchParams.get('metric') || undefined };
  let response: Response;
  let body: unknown;
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (!tokenInQuery) headers.Authorization = `Bearer ${token}`;
    response = await fetch(url.href, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    try { body = await response.json(); }
    catch (e) { if (!(e instanceof SyntaxError)) throw e; }
  } catch (e) {
    const name = e instanceof Error ? e.name : 'Error';
    console.error('[Instagram] Falha de transporte', {
      ...requestInfo, type: name, message: metaText(e instanceof Error ? e.message : e, token),
    });
    throw new InstagramError(name === 'TimeoutError' || name === 'AbortError'
      ? 'A consulta à Meta excedeu o tempo limite.'
      : 'Falha de comunicação com a Meta. Consulte o registro do servidor.');
  }
  const graph = body && typeof body === 'object' && 'error' in body ? body.error : null;
  if (graph && typeof graph === 'object') {
    const error = graph as Record<string, unknown>;
    const message = metaText(error.message, token);
    console.error('[Instagram] Erro da Meta', {
      ...requestInfo, status: response.status, message,
      code: typeof error.code === 'number' ? error.code : null,
      type: metaText(error.type, token), fbtrace_id: metaText(error.fbtrace_id, token),
    });
    throw new InstagramError(message || `A Meta recusou a consulta (HTTP ${response.status}).`);
  }
  if (!response.ok || !body || typeof body !== 'object' || Array.isArray(body)) {
    console.error('[Instagram] Resposta inesperada da Meta', { ...requestInfo, status: response.status });
    throw new InstagramError(`A Meta respondeu sem os dados esperados (HTTP ${response.status}).`);
  }
  return body as T;
}

export function instagramErrorMessage(error: unknown) {
  return error instanceof InstagramError ? error.message : 'Não foi possível atualizar os dados do Instagram.';
}

export async function readInstagramProfile(token: string): Promise<InstagramProfile> {
  const url = graphUrl(token, '', { fields: 'username,followers_count,media_count' });
  const profile = await igGet<Partial<InstagramProfile>>(url, token);
  if (typeof profile.username !== 'string' || profile.username.toLowerCase() !== 'pipehero.studio') {
    throw new InstagramError('A Meta não retornou o perfil esperado de @pipehero.studio.');
  }
  return {
    username: profile.username,
    followers_count: typeof profile.followers_count === 'number' ? profile.followers_count : undefined,
    media_count: typeof profile.media_count === 'number' ? profile.media_count : undefined,
  };
}

export async function readInstagramInsights(token: string, since: number, until: number) {
  const vals = Object.fromEntries(METRICS.map((metric) => [metric, null])) as Record<Metric, number | null>;
  const groups: readonly (readonly Metric[])[] = instagramSource(token) === 'facebook'
    ? [CORE_METRICS, ...EXTRA_METRICS.map((metric) => [metric])]
    : METRICS.map((metric) => [metric]);
  const results = await Promise.allSettled(groups.map(async (group) => {
    const followerSeries = group[0] === 'follower_count';
    const params: Record<string, string> = {
      metric: group.join(','), period: 'day', since: String(since), until: String(until),
    };
    if (!followerSeries) params.metric_type = 'total_value';
    const url = graphUrl(token, '/insights', params);
    const body = await igGet<{
      data?: { name?: string; total_value?: { value?: unknown }; values?: { value?: unknown }[] }[];
    }>(url, token);
    if (!Array.isArray(body.data)) throw new InstagramError('A Meta retornou os insights em um formato inesperado.');
    for (const metric of group) {
      const row = body.data.find((item) => item?.name === metric);
      const value = followerSeries ? row?.values?.at(-1)?.value : row?.total_value?.value;
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) vals[metric] = value;
    }
  }));
  // A Meta limita essa série a contas com pelo menos 100 seguidores.
  const firstError = results.find((result, i) => result.status === 'rejected' && groups[i][0] !== 'follower_count');
  return { vals, error: firstError?.status === 'rejected' ? instagramErrorMessage(firstError.reason) : '' };
}

export async function refreshInstagramToken(token: string) {
  if (instagramSource(token) !== 'instagram') return null;
  // A renovação do login do Instagram usa access_token como parâmetro próprio do endpoint.
  const url = new URL('/refresh_access_token', INSTAGRAM_ORIGIN);
  url.search = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token }).toString();
  const result = await igGet<{ access_token?: string }>(url, token, true);
  return typeof result.access_token === 'string' && /^IG[A-Za-z0-9]{50,}$/.test(result.access_token)
    ? result.access_token : null;
}
