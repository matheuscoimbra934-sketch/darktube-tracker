# DarkTube Tracker — Setup

App dedicado a rastrear vendas Hotmart vindas dos seus canais do YouTube. Mostra qual vídeo / canal / tema mais vende.

## Pré-requisitos

- Já deve ter rodado o schema do **darktube-finance-cloud** no Supabase (precisa das tabelas `workspaces`, `workspace_members`, `workspace_invites` e das funções `is_workspace_member`, `has_workspace_write`, `is_workspace_owner`)
- Conta Google (pra criar a chave da YouTube Data API)
- Acesso de produtor na Hotmart (pra configurar Postback)

---

## Passo 1 — Rodar o schema do Tracker

1. Painel Supabase → SQL Editor → New query
2. Cola o conteúdo de [tracker-schema.sql](tracker-schema.sql) e clica **RUN**
3. Confirme que apareceram as 5 tabelas: `tracker_config`, `tracker_canais`, `tracker_produtos`, `tracker_videos`, `tracker_eventos`

> Já tinha rodado o `hotmart-schema.sql` antes? Sem problema, os nomes não conflitam.

---

## Passo 2 — Pegar a chave da YouTube Data API

1. Abre https://console.cloud.google.com/
2. Cria um projeto novo (ex: "DarkTube YouTube")
3. Menu lateral → **APIs & Services** → **Library**
4. Busca "YouTube Data API v3" → clica **Enable**
5. Menu lateral → **APIs & Services** → **Credentials**
6. Botão **+ Create credentials** → **API key**
7. Copia a key (algo tipo `AIzaSyD...`)

> Cota grátis: 10.000 unidades/dia. Cada vídeo consultado = 1 unidade. Sobra muito.

---

## Passo 3 — Edge Functions (já deployadas)

As 3 functions já estão no ar:

- `tracker-webhook` — recebe Postback Hotmart
- `tracker-click` — rastreia clique e redireciona
- `youtube-enrich` — chama YouTube API e popula cache

URLs:
```
https://gkxmgmzgsnxlsivxxwfp.functions.supabase.co/tracker-webhook?ws=<workspace_id>
https://gkxmgmzgsnxlsivxxwfp.functions.supabase.co/tracker-click?ws=<workspace_id>&src=<src>&pid=<produto_uuid>
https://gkxmgmzgsnxlsivxxwfp.functions.supabase.co/youtube-enrich
```

> Se precisar redeployar:
> ```powershell
> cd darktube-tracker
> $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
> supabase functions deploy tracker-webhook --no-verify-jwt
> supabase functions deploy tracker-click --no-verify-jwt
> supabase functions deploy youtube-enrich
> ```

---

## Passo 4 — Abrir o app

```powershell
cd darktube-tracker
python -m http.server 5501
```

Abre no navegador: **http://localhost:5501**

Loga com a mesma conta do Finance (ou cria nova). Vai criar um workspace "Tracker" automaticamente.

---

## Passo 5 — Configurações iniciais

Na aba **Configurações**:

1. **Hottok** — inventa uma senha forte (ex: `darktube_K9x_secret_2026`) e cola
2. **YouTube API Key** — cola a key que você pegou no passo 2
3. **Moeda padrão** — escolhe BRL/USD/etc
4. Salva

Copia também:
- **URL do Postback** — vai colar na Hotmart
- **URL do Click Tracker** — usar no gerador de link

---

## Passo 6 — Configurar Postback na Hotmart

1. Painel Hotmart → seu produto (onde você é **produtor principal**) → **Ferramentas → Postback / Webhook**
2. **Cadastrar nova URL** → cola a URL do Postback
3. **Token de segurança (Hottok)** → cola o MESMO Hottok que você botou no Tracker
4. Marca **todos** os eventos:
   - Compra aprovada
   - Compra completada
   - Boleto/PIX gerado
   - Aguardando pagamento
   - Pagamento atrasado
   - Compra reembolsada
   - Compra protestada
   - Chargeback
   - Compra cancelada
   - Compra expirada
   - Abandono de checkout
   - Cancelamento de assinatura
5. Salva

> Não é produtor principal? Pede pro produtor cadastrar a URL com o seu workspace_id. Cada produto rastreado precisa do Postback configurado.

---

## Passo 7 — Cadastrar canais e produtos

### Canais (aba Canais)

Pra cada canal do YouTube que vai vender:

- **Nome:** "Gospel Master" (livre)
- **Slug:** `gospel` (só letras minúsculas/números/underline, sem espaço/acento — vai virar prefixo do src)
- **Tema padrão:** "Oração" (livre — usado pro Top Temas)
- **YouTube channel ID:** opcional
- **URL do canal:** opcional

> Slug é o que importa. Convenção sugerida: usa o início do nome do canal.

### Produtos Hotmart (aba Produtos)

Pra cada produto Hotmart:

- **Nome:** "Curso Alma Gêmea"
- **Link Hotmart base:** `https://pay.hotmart.com/M12345678X` (sem `?src=`)
- **Hotmart ID:** opcional
- **Preço:** opcional (informativo)

---

## Passo 8 — Gerar link de cada vídeo

Na aba **Produtos**, role até o **Gerador de Link**:

1. Escolhe **Produto**
2. Escolhe **Canal**
3. Cola o **ID do vídeo do YouTube** (parte depois de `watch?v=` na URL — ex: `dQw4w9WgXcQ`)
4. Escolhe **tipo:**
   - **Rastreado** — registra clique antes de redirecionar (recomendado)
   - **Direto** — vai direto pra Hotmart, sem registro de clique
5. Clica **Copiar**
6. Cola na descrição do vídeo no YouTube

**Fim.** Não precisa cadastrar o vídeo no app — quando chegar a primeira venda ou clique, o sistema:
- Cria a entrada do vídeo automaticamente
- Chama a YouTube API e puxa título, thumb, views, link
- Aparece no Top Vídeos sem você fazer nada

---

## Como o sistema usa o SRC

Convenção: `<slug_do_canal>_<id_youtube_do_video>`

Exemplos:
- `gospel_dQw4w9WgXcQ`
- `culinaria_xY3z9KAB12`
- `misterio_aBcDeF1234`

Quando chega um evento (clique ou venda):
1. Extrai a parte antes do `_` → busca canal pelo slug
2. Extrai a parte depois → é o ID do YouTube
3. Se o vídeo não existe no cache → cria e chama YouTube API
4. Vincula o evento ao vídeo e ao canal

---

## Troubleshooting

**Eventos não chegam:**
- Histórico de envios na Hotmart está OK?
- Logs da function: Supabase → Edge Functions → `tracker-webhook` → Logs
- Hottok igual nos 2 lados?

**Vídeo não tem título/thumb:**
- YouTube API Key configurada e ativa?
- Vai pra aba Visão Geral → botão **Atualizar do YouTube** (faz batch dos vídeos pendentes)
- Verifica logs da function `youtube-enrich`

**SRC não tem `_`:**
- Sistema atribui ao canal pelo slug inteiro, sem video_id
- Use a convenção `slug_videoId` pra funcionar 100%

**Aba Top Temas vazia:**
- Cadastre `tema` nos canais primeiro
- Vai aparecer assim que tiver eventos

---

## Cota da YouTube API

- 10.000 unidades/dia grátis
- `videos.list` consome 1 unidade por vídeo
- Sistema chama 1 vez por vídeo novo + opcional batch de atualização (botão "Atualizar do YouTube")
- Pra 1000 vídeos novos/dia + refresh diário dos top 100 = ~1100 unidades. Tem folga gigante.

Quando ficar caro, dá pra ativar billing no Google Cloud (custa centavos).
