# Pipe Hero Studio — landing do assistente para clínicas

Site estático (HTML, CSS e JavaScript simples, sem build) em português de Portugal, inglês e espanhol.

## Estrutura

- `index.html` — deteta o idioma e redireciona para `/pt/`, `/en/` ou `/es/`
- `pt/`, `en/`, `es/` — página principal e política de privacidade de cada idioma
- `assets/` — estilos, script, ícones e imagens Open Graph
- `config.js` — e-mail, WhatsApp, link de agenda, nome do responsável e Instagram

## Correr localmente

```bash
python3 -m http.server 8000
```

Abrir http://localhost:8000. O formulário só envia depois de publicado no Netlify.

## Publicar no Netlify

1. Netlify → Add new site → Import an existing project → GitHub → este repositório.
2. Sem comando de build; pasta de publicação `.` (já definido em `netlify.toml`).
3. Site configuration → Forms → ativar a deteção de formulários e voltar a publicar.
4. Forms → Form notifications → notificação por e-mail para o endereço do estúdio.

Cada `git push` para `main` publica automaticamente.
