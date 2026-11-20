# Pipe Hero Studio — site

Site estático em [Astro](https://astro.build), em português de Portugal, inglês e espanhol.
O conceito é um pipeline: uma linha que desce pela página e liga as "estações" 01 Site, 02 Chat, 03 CRM e 04 Agente.

## Correr localmente

Precisa de Node.js 22 (22.22 ou mais recente).

```bash
npm install
npm run dev          # http://localhost:4321 com recarregamento automático
npm run build        # gera o site final em dist/
npm run preview      # serve dist/ para ver o resultado final
npm run check:links  # depois do build: verifica links internos e o seletor de idioma
```

O formulário só envia com o site publicado (no computador mostra um aviso).

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
- `formWebhook`: URL do webhook do n8n. Vazio usa o Netlify Forms.
  - No n8n, o nó Webhook deve aceitar `POST` e permitir a origem `https://pipeherostudio.digital` (CORS).
  - Os campos chegam como formulário: `nome`, `negocio`, `pais`, `email`, `telefone`, `servico`, `mensagem`, `privacidade`, `tipo`, `idioma`, `pagina`.
- `chatWebhook` + `chatEnabled`: liga o chat de IA no canto do ecrã.
  - O webhook recebe JSON `{ sessionId, message, lang, page }`.
  - Deve responder `{ "reply": "..." }`.
- `sitePrice`: preço do site em EUR (PT e ES) e USD (EN).
- `maintenanceFrom`, `crmFrom`, `agentsFrom`: `null` mostra "Sob consulta". Com um valor, mostra "A partir de …".
- `legal`: nome legal, NIF e morada para a privacidade e os termos.

## Publicar (GitHub → Netlify)

1. Faça push para o GitHub (`main`).
2. Ligue o repositório ao Netlify:
   - Em Netlify → **Add new site** → **Import an existing project** → **GitHub**, escolha `PipeHeroStudio`.
   - O `netlify.toml` já define o comando (`npm run build`), a pasta (`dist`) e o Node 22. Clique em **Deploy**.
3. A partir daí, cada `git push` para `main` publica automaticamente.

### Formulário (Netlify Forms, enquanto não houver webhook)

1. **Site configuration → Forms**: ative a deteção de formulários e faça um novo deploy (**Deploys → Trigger deploy**).
2. **Forms → Form notifications → Add notification → Email notification**, para `emerson@pipeherostudio.digital`.
3. Faça um envio de teste no site publicado.

### Domínio pipeherostudio.digital

Em **Domain management → Add a domain**, escreva `pipeherostudio.digital` e escolha uma de duas opções:

- **Recomendado: DNS da Netlify.** Siga o assistente e troque os nameservers no registador do domínio pelos 4 que a Netlify indicar.
- **DNS no registador.** Crie estes registos (confirme os valores no painel da Netlify):
  - `A`, nome `@`: `75.2.60.5`
  - `CNAME`, nome `www`: `<nome-do-site>.netlify.app`

O certificado HTTPS (Let's Encrypt) é criado automaticamente quando o DNS propagar.

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
public/                  fontes (subconjunto latino), favicon, robots.txt
```

Sem cookies de rastreio nem analytics. Se um dia forem precisos, acrescente antes um aviso de consentimento.
