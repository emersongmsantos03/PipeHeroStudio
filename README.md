# Pipe Hero Studio — site

Site estático em [Astro](https://astro.build), em português de Portugal, inglês e espanhol.
O conceito é um pipeline: uma linha que desce pela página e liga as "estações" 01 Site, 02 Chat, 03 CRM e 04 Agente.

## Correr localmente

Precisa de Node.js 22 (22.22 ou mais recente).

```bash
npm install
npm run dev          # http://localhost:4321, só o site (o formulário não envia)
npm run preview      # build + Worker local em http://localhost:8787, com /api/contact (e-mail simulado)
npm run build        # gera o site final em dist/
npm run check:links  # depois do build: verifica links internos e o seletor de idioma
npm run types        # regenera os tipos do Worker depois de mudar o wrangler.jsonc
```

## Onde editar

| O quê | Onde |
|---|---|
| E-mail, WhatsApp, webhooks, chat, preços | `src/config.ts` |
| Textos em português | `src/i18n/pt.ts` |
| Textos em inglês | `src/i18n/en.ts` |
| Textos em espanhol | `src/i18n/es.ts` |
| Textos curtos dos mockups da página inicial | `src/views/Home.astro` (objeto `V`) |
| Endereços das páginas (slugs) | `src/i18n/routes.ts` |
| Cores, fontes e espaçamentos (tokens) | `src/styles/global.css` (`:root`) |
| Cores dos mini-sites de exemplo | `src/lib/minisite.ts` |
| Testemunhos (escondidos até haver reais) | `src/components/Testimonials.astro` + `showTestimonials` no config |

### Valores do `src/config.ts`

- `email`: o único e-mail do site.
- `whatsapp`: só dígitos com indicativo (ex. `351912345678`). Vazio esconde todos os botões de WhatsApp.
- `formWebhook`: URL do webhook do n8n (opcional).
  - Vazio: o formulário envia para `/api/contact` (`worker/index.ts`), que manda o pedido por e-mail para `emerson@pipeherostudio.digital`, com Reply-To de quem preencheu.
  - Com URL: o nó Webhook do n8n deve aceitar `POST` e permitir a origem `https://pipeherostudio.digital` (CORS).
  - Os campos chegam como formulário: `nome`, `negocio`, `pais`, `email`, `telefone`, `servico`, `mensagem`, `privacidade`, `tipo`, `idioma`, `pagina`.
- `chatEnabled`: liga o chat de IA no canto do ecrã. O chat corre no Worker (`worker/chat.ts`, rota `/api/chat`) com o modelo `gpt-5.4-mini` da OpenAI.
  - Responde no idioma do visitante, tira dúvidas com base nos textos de `src/i18n/en.ts` e nos preços do config, e qualifica o lead.
  - Com autorização do visitante, envia ao Emerson um resumo (qualificação, contactos, próximo passo e conversa completa). O resumo é sempre guardado no KV `LEADS` (painel: Storage & Databases → KV) e também é enviado por e-mail quando o envio estiver ativo.
  - A chave da OpenAI é um segredo da Cloudflare: `npx wrangler secret put OPENAI_API_KEY`. Para testar localmente, ponha `OPENAI_API_KEY=...` em `.dev.vars` (o Git ignora este ficheiro).
  - Para trocar de modelo sem mexer no código, crie no painel a variável `OPENAI_MODEL`.
  - Proteções: só aceita pedidos do próprio site, 15 mensagens por minuto por visitante, mensagens até 1000 caracteres e respostas curtas. Defina também um limite de gastos mensal na OpenAI (Settings → Limits).
  - O webhook recebe JSON `{ sessionId, message, lang, page }`.
  - Deve responder `{ "reply": "..." }`.
- `sitePrice`: preço do site em EUR (PT e ES) e USD (EN).
- `maintenanceFrom`, `crmFrom`, `agentsFrom`: `null` mostra "Sob consulta". Com um valor, mostra "A partir de …".
- `legal`: nome legal, NIF e morada para a privacidade e os termos.

## Publicar na Cloudflare (Workers + GitHub)

O site é um Worker da Cloudflare com ficheiros estáticos. A configuração está em `wrangler.jsonc`: os ficheiros vêm de `dist/` e o Worker só corre em `/api/*`.

### 1. Domínio na Cloudflare

1. Em dash.cloudflare.com → **Add a domain**, escreva `pipeherostudio.digital` e escolha o plano Free.
2. No registador onde comprou o domínio, troque os nameservers pelos 2 que a Cloudflare indicar.
3. Espere até o domínio aparecer como **Active**.

### 2. Receber e-mail em emerson@pipeherostudio.digital

A caixa está no **Zoho** (registos MX do domínio). **Não ative o Email Routing** na raiz do domínio: isso troca os MX e o Zoho deixa de receber.

Para o site poder enviar para esta caixa no plano Free, ela tem de ser um **endereço de destino verificado** na conta Cloudflare (já criado: `npx wrangler email routing addresses create emerson@pipeherostudio.digital`). Abra o e-mail da Cloudflare no Zoho e clique em **Verify email address**. Sem isso, o envio falha com `E_RECIPIENT_NOT_ALLOWED`.

### 3. Enviar o formulário por e-mail

1. Vá a **Compute → Email Service → Email Sending → Onboard Domain** e escolha `pipeherostudio.digital`. Os registos DNS são criados automaticamente.
2. O remetente dos e-mails é `site@pipeherostudio.digital`. Não precisa de existir como caixa.
3. Plano necessário:
   - **Plano Free:** o envio só funciona para endereços de destino verificados. Em **Settings → Variables and Secrets**, crie a variável `CONTACT_TO` com a sua caixa pessoal verificada; ela não é apagada nos deploys (`keep_vars`).
   - **Workers Paid:** envia para qualquer endereço, com 3 000 e-mails por mês incluídos. Confirme o preço atual no painel.

### 3b. Aviso por WhatsApp (opcional)

Os leads do chat e os pedidos do formulário também podem chegar ao seu WhatsApp, através do CallMeBot (gratuito, para uso pessoal):

1. Siga as instruções em https://www.callmebot.com/blog/free-api-whatsapp-messages/ para receber a sua apikey no WhatsApp.
2. `npx wrangler secret put CALLMEBOT_APIKEY` (cole a apikey).
3. No painel, em **Settings → Variables**, crie `WHATSAPP_PHONE` com o seu número, só dígitos e com indicativo (ex. `351912345678`).

Sem estas duas variáveis, o aviso por WhatsApp fica desligado. Os leads do chat ficam sempre guardados no KV `LEADS`, mesmo que o e-mail e o WhatsApp falhem.

### 4. Ligar o GitHub (deploy automático)

1. Abra **Workers & Pages → Create → Import a repository → GitHub** e escolha `PipeHeroStudio`.
2. Configure assim:
   - Nome do Worker: `pipeherostudio` (tem de ser igual ao `name` do `wrangler.jsonc`)
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - Branch: `main`
3. A partir daí, cada `git push` para `main` publica sozinho.

### 5. Apontar o domínio para o Worker

1. O domínio já está no bloco `routes` do `wrangler.jsonc`: o deploy liga-o sozinho. Se falhar por já existir um registo DNS `A`/`CNAME` em `pipeherostudio.digital` a apontar para outro lado, apague esse registo e volte a fazer deploy.
2. Para `www`, crie em **Rules → Redirect Rules** um redirecionamento 301 de `www.pipeherostudio.digital/*` para `https://pipeherostudio.digital/${1}`. O `www` precisa de um registo DNS com proxy ativo, por exemplo `A www 192.0.2.1` com a nuvem laranja.

### Notas

- Páginas 404 por idioma: `scripts/postbuild.mjs` cria `pt/404.html`, `en/404.html` e `es/404.html`. A Cloudflare serve a mais próxima.
- Cabeçalhos de segurança e cache: `public/_headers`.
- Logs do Worker: `npx wrangler tail pipeherostudio`.

## Painel: CRM, financeiro e métricas (admin.pipeherostudio.digital)

Um segundo Worker (`admin/`, nome `pipehero-admin`) com login. Partilha com o site a base de dados D1 `pipehero-crm`.

- **Visão geral:** leads por origem, conversas da Ava, e-mails enviados, funil, follow-ups, receita, lucro, a receber, recorrente.
- **CRM:** quadro por etapas (arrastar e soltar), lista com filtros e exportação CSV, ficha do lead com notas, contactos, próxima ação, conversa da Ava e pagamentos.
- **Financeiro:** receitas e despesas, pendentes, recorrentes, categorias. Marcar um lead como “Ganho” pode lançar a receita sozinho.
- **Ava e agentes:** conversas, conversão, páginas, registo de todos os e-mails enviados (Ava, formulário, agentes externos, avisos).
- **Integrações (admin):** chave da API para agentes externos, prompt pronto para configurar o agente, e-mail de teste, resumo diário.
- **Usuários (admin):** quem se cadastra fica “à espera” até ser aprovado, e o Emerson recebe um e-mail.

Como os leads entram:
- Formulário do site → `/api/contact` grava no CRM (sem duplicar o mesmo e-mail com negócio aberto) e avisa por e-mail com link para a ficha.
- Ava → quando o visitante aceita, grava no CRM com qualificação, resumo e conversa. Cada mensagem conta para as métricas.
- Agentes externos (n8n, Make…) → `POST https://admin.pipeherostudio.digital/api/ingest/lead` e `/api/ingest/event`, com `Authorization: Bearer <chave>` (a chave e o prompt estão em Integrações).

E-mails: o Cloudflare Email Service não consegue entregar na caixa Zoho (`E_DELIVERY_FAILED`), por isso os envios caem no **Resend** (segredo `RESEND_API_KEY` do Worker do site). O painel envia pelo mesmo Resend através de uma ligação interna ao site (service binding `MAILER` → `Mailer`, sem acesso pela internet). Todos os envios, com sucesso ou falha, ficam no registo de e-mails do painel.

Comandos:

```bash
npm run dev:admin      # painel local em http://localhost:8788 (base de dados local)
npm run deploy:admin   # publica o painel (o push para main só publica o site)
npm run deploy:all     # site + painel
npm run db:migrate     # aplica migrations/ na base de dados de produção
```

Resumo diário: cron às 08:00 UTC (`admin/wrangler.jsonc`), só sai se houver novidades. Liga e desliga em Integrações.

## Estrutura

```
src/
  config.ts              variáveis do site
  i18n/                  textos (pt, en, es) e rotas traduzidas
  layouts/Base.astro     <head>: SEO, hreflang, Open Graph, schema.org
  components/            pipeline (Station, Elbow), telemóvel, mini-site, formulário, chat…
  views/                 uma vista por página
  scripts/               JavaScript das ilhas (gancho do hero, formulário, conversa de exemplo)
  pages/                 rotas: /[lang]/[...slug], raiz, 404, sitemap.xml, imagens OG
worker/index.ts          Worker do site: /api/contact (formulário → CRM + e-mail), /api/chat (Ava), Mailer (RPC)
shared/crm.ts            gravar leads, contar eventos e enviar e-mail (site e painel)
migrations/              esquema da base de dados D1 (pipehero-crm)
admin/                   painel admin.pipeherostudio.digital (src/ = API, public/ = aplicação)
wrangler.jsonc           configuração da Cloudflare
public/                  fontes (subconjunto latino), favicon, robots.txt
```

Sem cookies de rastreio nem analytics. Se um dia forem precisos, acrescente antes um aviso de consentimento.
