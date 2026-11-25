const FIELDS = ['utm_source', 'utm_medium', 'utm_campaign'] as const;
type Campaign = Partial<Record<(typeof FIELDS)[number], string>>;

/** Retém somente códigos de campanha curtos. URLs, e-mails e tokens do link não fazem parte da atribuição. */
export function readCampaign(get: (key: string) => unknown): Campaign {
  const campaign: Campaign = {};
  for (const key of FIELDS) {
    const value = get(key);
    if (typeof value !== 'string') continue;
    const code = value.trim().toLowerCase();
    if (/^[a-z0-9][a-z0-9._-]{0,39}$/.test(code)) campaign[key] = code;
  }
  return campaign.utm_source ? campaign : {};
}

export function campaignFromQuery(search: string): Campaign {
  const query = new URLSearchParams(search);
  return readCampaign((key) => query.get(key));
}
