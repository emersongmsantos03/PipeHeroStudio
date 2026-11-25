/**
 * Tudo o que é variável no site está aqui.
 * Depois de alterar, faça commit e push: a Cloudflare (Workers Builds) publica sozinha.
 */

/** Preço por moeda. `null` mostra "Sob consulta" / "On request" / "Bajo consulta". */
export type Money = { EUR: number; USD: number } | null;

export const config = {
  siteUrl: 'https://pipeherostudio.digital',
  brand: 'Pipe Hero Studio',
  founder: 'Emerson',

  /** Único e-mail usado em todo o site. */
  email: 'emerson@pipeherostudio.digital',

  /** TODO: número de WhatsApp só com dígitos e indicativo, ex. "351912345678". Vazio = botões escondidos. */
  whatsapp: '',

  /** Utilizador do Instagram, sem @. */
  instagram: 'pipehero.studio',

  /** TODO (opcional): URL do webhook do n8n. Vazio = /api/contact (Worker da Cloudflare que envia e-mail). */
  formWebhook: '',

  /**
   * Chat do site respondido pelo Qwen no PC, com formulário quando indisponível.
   */
  chatEnabled: true,

  /** Preço do site profissional: euros em PT e ES, dólares em EN. */
  sitePrice: { EUR: 139, USD: 149 } as Money,

  /** Manutenção mensal do site. `null` = "Sob consulta". Ex.: { EUR: 15, USD: 15 } */
  maintenanceFrom: null as Money,

  /** "A partir de" da automação de CRM. `null` = "Sob consulta". */
  crmFrom: null as Money,

  /** "A partir de" dos agentes de IA. `null` = "Sob consulta". */
  agentsFrom: null as Money,

  /** TODO: ligar só quando houver testemunhos reais, com autorização (ver src/components/Testimonials.astro). */
  showTestimonials: false,

  /** TODO: dados legais que aparecem na política de privacidade e nos termos. Vazio = não aparece. */
  legal: {
    entity: '', // ex. "Emerson Santos, empresário em nome individual"
    taxId: '', // NIF / NIF-IVA
    address: '',
  },
};
