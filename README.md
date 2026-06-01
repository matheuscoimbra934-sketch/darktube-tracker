# DarkTube Tracker

Dashboard de rastreamento de vendas YouTube → Hotmart.

## O que faz

- Hierarquia: Pessoa → Rede → Canal (1 por país)
- Cada canal tem link Hotmart fixo + link do YouTube
- Quando vem uma venda da Hotmart (via Postback), o sistema atribui automaticamente:
  - Pessoa (operador)
  - Rede
  - Canal (país)
  - Número do vídeo (extraído do `?src=N`)
- Dashboard em tempo real com KPIs, top canais, vendas por pessoa
- Suporte a múltiplas moedas (BRL, USD, EUR…) com split separado

## Stack

- **Frontend:** HTML + CSS + JS puro (sem build)
- **Backend:** Supabase (Postgres + Auth + Realtime + Edge Functions Deno)
- **Hospedagem:** GitHub Pages (estático) ou Netlify/Vercel
- **Integração:** Hotmart Postback 2.0

## Estrutura

```
darktube-tracker/
├── index.html          # App
├── app.js              # Lógica
├── styles.css          # Tema
├── config.js           # Supabase URL + anon key (público, RLS protege os dados)
├── tracker-schema.sql  # Schema inicial Supabase
├── tracker-migration-v2.sql # Pessoas, Redes, hierarquia
├── supabase/functions/
│   ├── tracker-webhook/    # Recebe Postback Hotmart
│   ├── tracker-click/      # Rastreia clique + redireciona
│   └── youtube-enrich/     # Cache de vídeos YouTube
└── SETUP.md            # Guia completo de setup
```

## Rodar local

```bash
python -m http.server 5501
```

Abre http://localhost:5501

## Setup completo

Ver [SETUP.md](SETUP.md).
