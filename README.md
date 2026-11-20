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
- `chatWebhook` + `chatEnabled`: liga o chat de IA no canto do ecrã.
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

1. **Email → Email Routing**: ative-o para o domínio. Crie a regra `emerson@pipeherostudio.digital` → a sua caixa pessoal.
2. Confirme a caixa pessoal no link que a Cloudflare envia.

### 3. Enviar o formulário por e-mail

1. Vá a **Compute → Email Service → Email Sending → Onboard Domain** e escolha `pipeherostudio.digital`. Os registos DNS são criados automaticamente.
2. O remetente dos e-mails é `site@pipeherostudio.digital`. Não precisa de existir como caixa.
3. Plano necessário:
   - **Plano Free:** o envio só funciona para endereços de destino verificados. Em **Settings → Variables and Secrets**, crie a variável `CONTACT_TO` com a sua caixa pessoal verificada; ela não é apagada nos deploys (`keep_vars`).
   - **Workers Paid:** envia para qualquer endereço, com 3 000 e-mails por mês incluídos. Confirme o preço atual no painel.

### 4. Ligar o GitHub (deploy automático)

1. Abra **Workers & Pages → Create → Import a repository → GitHub** e escolha `PipeHeroStudio`.
2. Configure assim:
   - Nome do Worker: `pipeherostudio` (tem de ser igual ao `name` do `wrangler.jsonc`)
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - Branch: `main`
3. A partir daí, cada `git push` para `main` publica sozinho.

### 5. Apontar o domínio para o Worker

1. Descomente o bloco `routes` no fim do `wrangler.jsonc`, faça commit e push. Em alternativa, use **Worker → Settings → Domains & Routes → Add → Custom domain**.
2. Para `www`, crie em **Rules → Redirect Rules** um redirecionamento 301 de `www.pipeherostudio.digital/*` para `https://pipeherostudio.digital/${1}`. O `www` precisa de um registo DNS com proxy ativo, por exemplo `A www 192.0.2.1` com a nuvem laranja.

### Notas

- Páginas 404 por idioma: `scripts/postbuild.mjs` cria `pt/404.html`, `en/404.html` e `es/404.html`. A Cloudflare serve a mais próxima.
- Cabeçalhos de segurança e cache: `public/_headers`.
- Logs do Worker: `npx wrangler tail pipeherostudio`.

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
worker/index.ts          Worker da Cloudflare: /api/contact (formulário → e-mail)
wrangler.jsonc           configuração da Cloudflare
public/                  fontes (subconjunto latino), favicon, robots.txt
```

Sem cookies de rastreio nem analytics. Se um dia forem precisos, acrescente antes um aviso de consentimento.
