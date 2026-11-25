import { campaignFromQuery } from '../../shared/campaign';

const KEY = 'phs-campaign';
const MAX_AGE = 30 * 60 * 1000;

export function campaignFromBrowser() {
  const tagged = campaignFromQuery(location.search);
  try {
    if (tagged.utm_source) {
      sessionStorage.setItem(KEY, JSON.stringify({ search: new URLSearchParams(tagged).toString(), at: Date.now() }));
    } else {
      const stored = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      if (stored?.search && Number.isFinite(stored.at) && Date.now() - stored.at < MAX_AGE) return campaignFromQuery(stored.search);
    }
  } catch { /* attribution remains available from the current URL */ }
  return tagged;
}
