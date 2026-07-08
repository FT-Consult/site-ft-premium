# Handoff — Site FT Consult (Protótipo)

## Repositório
- **GitHub:** `gilmarfavarin-ux/site-ft-premium`
- **Branch principal:** `main`
- **Deploy automático:** GitHub Actions → Cloudflare Workers (push em `main` dispara deploy)

## Contexto do projeto
Protótipo estático do novo site FT Consult, criado para servir de referência visual e de conteúdo para a equipe WordPress que vai implementar o site definitivo na hospedagem atual. **Não é o site de produção** — é um espelho funcional do que deve ser construído.

## Stack
- HTML/CSS/JS estático puro
- Cloudflare Workers (serve os assets via `_worker.js`)
- MailChannels API para envio de formulários (gratuito no Workers)
- GitHub Actions para deploy automático

## Estrutura de arquivos

```
/
├── index.html                  # Home
├── servicos.html               # Serviços
├── consultoria-microsoft.html  # Landing Microsoft (nova frente comercial)
├── cases.html                  # Cases de sucesso
├── quem-somos.html             # Quem Somos
├── contato.html                # Contato
├── blog.html                   # Blog (placeholder)
├── trabalhe-conosco.html       # Trabalhe Conosco + formulário
├── obrigado.html               # Página de confirmação pós-formulário
├── styleguide.html             # Guia de estilo completo (referência WP)
├── robots.txt                  # Disallow: / (bloqueia indexação no protótipo)
├── _worker.js                  # Cloudflare Worker (roteamento + formulários)
├── wrangler.toml               # Config Cloudflare
├── .assetsignore               # Exclui _worker.js do upload de assets
├── assets/
│   ├── css/style.css           # Todo o design system
│   └── js/main.js              # Scroll animations, header, WhatsApp
└── .github/workflows/deploy.yml
```

## Secrets necessários no repositório

Ao migrar para a nova conta/org, recriar estes secrets em **Settings → Secrets and variables → Actions**:

| Secret | Onde obter |
|--------|-----------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare Dashboard → My Profile → API Tokens → Create Token (template: Edit Cloudflare Workers) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Dashboard → lado direito da home → Account ID |
| `CONTACT_EMAIL` | Valor: `gilmar@ftconsult.com.br` |

## Variáveis de ambiente no `wrangler.toml`
```toml
name = "site-ft-premium"
compatibility_date = "2024-01-01"

[assets]
binding = "ASSETS"
```

## Formulários
Todos os formulários (contato, consultoria Microsoft, trabalhe conosco) fazem POST para `/api/contato` via `_worker.js`. O worker envia e-mail para `gilmar@ftconsult.com.br` usando MailChannels. Em caso de sucesso, redireciona para `/obrigado.html`.

Campos identificadores por página:
- Contato geral: `_type: 'contato'`
- Trabalhe Conosco: `_type: 'candidatura'`
- Consultoria Microsoft: campo `usuarios` e `plataforma` presentes

## Design system (resumo)

```css
--cyan:   #00ABFF   /* cor primária, CTAs */
--violet: #D96FED   /* acento gradiente */
--dark:   #071221   /* fundo escuro principal */
--card:   #0d1830   /* fundo cards */
```

**Seções:**
- `.section-white` — fundo branco
- `.section-soft` — fundo cinza claro `#f5f7fa`
- `.section-dark` — fundo escuro `#071221`
- `.section-contact` — gradiente para formulários

**Tipografia:** Inter (Google Fonts), pesos 300/400/500/600/700/800

**Referência completa:** abrir `styleguide.html` no browser

## Identidade visual
- Logo: SVG tipográfico "FT" com gradiente cyan→violet
- Microsoft logo: 4 quadrados (F25022, 7FBA00, 00A4EF, FFB900)
- Ícone WhatsApp flutuante fixo: `#25D366`

## Navegação (todas as páginas)
Serviços · Como Trabalhamos · Consultoria Microsoft · Cases · Quem Somos · Contato · Blog

## Contato da empresa
- **Telefone:** +55 (11) 4858-4850
- **Endereço:** Rua Gomes de Carvalho, 1581 — 8º andar, Vila Olímpia — São Paulo/SP
- **E-mail:** gilmar@ftconsult.com.br
- **Facebook:** https://web.facebook.com/ftconsult
- **Instagram:** https://www.instagram.com/ftconsult_/
- **LinkedIn:** https://www.linkedin.com/company/ft-consult/

## Comentários de seção nos HTMLs
Todos os arquivos HTML têm comentários `<!-- ═══ NOME DA SEÇÃO ═══ -->` para facilitar a identificação de blocos na migração para WordPress.

## O que está pendente / fora do escopo do protótipo
- **Cloudflare Web Analytics** — precisa de token do dashboard (Cloudflare → Web Analytics → Add Site)
- **RD Station** — integração de formulários com o CRM (foi explicitamente adiada)
- **robots.txt** — atualmente bloqueia toda indexação (`Disallow: /`). Ao publicar o site definitivo, remover ou ajustar
- **Blog** — página placeholder; conteúdo real a ser criado no WordPress

## Próximos passos para a equipe WordPress
1. Usar `styleguide.html` como referência de componentes, cores e tipografia
2. Usar os comentários `<!-- ═══ ... ═══ -->` para mapear cada seção
3. O formulário de contato deverá ser integrado via plugin WordPress + RD Station
4. Manter a mesma hierarquia de URLs para preservar SEO futuro
