/**
 * Aviso por WhatsApp para o Emerson (opcional), via CallMeBot (https://www.callmebot.com/blog/free-api-whatsapp-messages/).
 * Fica desligado até existirem as duas variáveis:
 *   - WHATSAPP_PHONE: o seu número com indicativo, só dígitos (ex. 351912345678). Painel: Settings → Variables.
 *   - CALLMEBOT_APIKEY: segredo (npx wrangler secret put CALLMEBOT_APIKEY).
 */
export interface NotifyEnv {
  WHATSAPP_PHONE?: string;
  CALLMEBOT_APIKEY?: string;
}

export async function notifyWhatsApp(env: NotifyEnv, text: string): Promise<boolean> {
  const phone = (env.WHATSAPP_PHONE || '').replace(/\D/g, '');
  if (!phone || !env.CALLMEBOT_APIKEY) return false;
  const url = new URL('https://api.callmebot.com/whatsapp.php');
  url.searchParams.set('phone', phone);
  url.searchParams.set('apikey', env.CALLMEBOT_APIKEY);
  url.searchParams.set('text', text.slice(0, 1500));
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) console.error('notify: whatsapp failed', res.status, (await res.text().catch(() => '')).slice(0, 200));
    return res.ok;
  } catch (e) {
    console.error('notify: whatsapp failed', (e as Error).message);
    return false;
  }
}
