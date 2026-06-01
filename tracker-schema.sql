-- =====================================================
-- DARKTUBE TRACKER — Schema
-- App dedicado a rastreamento de vendas YouTube → Hotmart
-- Cole no SQL Editor do Supabase e clique RUN
--
-- Reaproveita: workspaces, workspace_members, workspace_invites
-- do schema do darktube-finance-cloud. Se você ainda não rodou
-- aquele schema, rode antes.
-- =====================================================

-- 1) CONFIG geral por workspace
create table if not exists public.tracker_config (
    workspace_id uuid primary key references public.workspaces(id) on delete cascade,
    hottok text,                        -- token Hotmart Postback
    youtube_api_key text,               -- YouTube Data API v3 key
    moeda_padrao text default 'BRL',
    updated_at timestamptz default now()
);

-- 2) CANAIS YouTube
create table if not exists public.tracker_canais (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid references public.workspaces(id) on delete cascade not null,
    nome text not null,
    slug text not null,                 -- prefixo do src: ex "gospel", "culinaria"
    tema text,                          -- tema padrão dos vídeos desse canal
    youtube_channel_id text,            -- UCxxxxxxx
    youtube_url text,
    idioma text default 'pt',
    obs text,
    created_at timestamptz default now(),
    created_by uuid references auth.users(id),
    unique (workspace_id, slug)
);

-- 3) PRODUTOS Hotmart
create table if not exists public.tracker_produtos (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid references public.workspaces(id) on delete cascade not null,
    nome text not null,
    hotmart_id text,                    -- ex: M12345678X
    hotmart_url text not null,          -- ex: https://pay.hotmart.com/M12345678X
    preco numeric(12,2),
    moeda text default 'BRL',
    obs text,
    created_at timestamptz default now(),
    created_by uuid references auth.users(id)
);

-- 4) VÍDEOS — cache auto-enriquecido da YouTube API
create table if not exists public.tracker_videos (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid references public.workspaces(id) on delete cascade not null,
    canal_id uuid references public.tracker_canais(id) on delete set null,
    src text not null,                  -- src exato vindo dos eventos
    video_id text,                      -- ID YouTube (parte do src depois do _)
    titulo text,
    thumb_url text,
    descricao text,
    view_count bigint,
    like_count bigint,
    comment_count bigint,
    duracao_segundos int,
    youtube_url text,
    youtube_channel_title text,
    published_at timestamptz,
    tema text,                          -- override do tema do canal (opcional)
    enriquecido_em timestamptz,         -- última atualização via YouTube API
    obs text,
    created_at timestamptz default now(),
    unique (workspace_id, src)
);

-- 5) EVENTOS — postback + cliques
create table if not exists public.tracker_eventos (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid references public.workspaces(id) on delete cascade not null,
    canal_id uuid references public.tracker_canais(id) on delete set null,
    video_id uuid references public.tracker_videos(id) on delete set null,
    produto_id uuid references public.tracker_produtos(id) on delete set null,
    src text,
    canal_slug text,
    video_id_yt text,
    event_type text not null,
    valor numeric(12,2),
    moeda text,
    comprador_nome text,
    comprador_email text,
    transaction_id text,
    produto_nome text,
    pais text,
    ip text,
    user_agent text,
    raw_payload jsonb,
    created_at timestamptz default now()
);

-- =====================================================
-- ÍNDICES
-- =====================================================
create index if not exists idx_tracker_canais_ws       on public.tracker_canais(workspace_id);
create index if not exists idx_tracker_canais_slug     on public.tracker_canais(workspace_id, slug);
create index if not exists idx_tracker_produtos_ws     on public.tracker_produtos(workspace_id);
create index if not exists idx_tracker_videos_ws       on public.tracker_videos(workspace_id);
create index if not exists idx_tracker_videos_src      on public.tracker_videos(workspace_id, src);
create index if not exists idx_tracker_videos_canal    on public.tracker_videos(canal_id);
create index if not exists idx_tracker_eventos_ws      on public.tracker_eventos(workspace_id, created_at desc);
create index if not exists idx_tracker_eventos_src     on public.tracker_eventos(workspace_id, src);
create index if not exists idx_tracker_eventos_canal   on public.tracker_eventos(canal_id);
create index if not exists idx_tracker_eventos_video   on public.tracker_eventos(video_id);
create index if not exists idx_tracker_eventos_type    on public.tracker_eventos(workspace_id, event_type);
create index if not exists idx_tracker_eventos_tx      on public.tracker_eventos(transaction_id);

-- =====================================================
-- RLS
-- =====================================================
alter table public.tracker_config   enable row level security;
alter table public.tracker_canais   enable row level security;
alter table public.tracker_produtos enable row level security;
alter table public.tracker_videos   enable row level security;
alter table public.tracker_eventos  enable row level security;

-- config — só owner do workspace
create policy "tc_select" on public.tracker_config for select using (public.is_workspace_member(workspace_id));
create policy "tc_insert" on public.tracker_config for insert with check (public.is_workspace_owner(workspace_id));
create policy "tc_update" on public.tracker_config for update using (public.is_workspace_owner(workspace_id));
create policy "tc_delete" on public.tracker_config for delete using (public.is_workspace_owner(workspace_id));

-- canais
create policy "tcan_select" on public.tracker_canais for select using (public.is_workspace_member(workspace_id));
create policy "tcan_insert" on public.tracker_canais for insert with check (public.has_workspace_write(workspace_id));
create policy "tcan_update" on public.tracker_canais for update using (public.has_workspace_write(workspace_id));
create policy "tcan_delete" on public.tracker_canais for delete using (public.has_workspace_write(workspace_id));

-- produtos
create policy "tprod_select" on public.tracker_produtos for select using (public.is_workspace_member(workspace_id));
create policy "tprod_insert" on public.tracker_produtos for insert with check (public.has_workspace_write(workspace_id));
create policy "tprod_update" on public.tracker_produtos for update using (public.has_workspace_write(workspace_id));
create policy "tprod_delete" on public.tracker_produtos for delete using (public.has_workspace_write(workspace_id));

-- vídeos
create policy "tvid_select" on public.tracker_videos for select using (public.is_workspace_member(workspace_id));
create policy "tvid_insert" on public.tracker_videos for insert with check (public.has_workspace_write(workspace_id));
create policy "tvid_update" on public.tracker_videos for update using (public.has_workspace_write(workspace_id));
create policy "tvid_delete" on public.tracker_videos for delete using (public.has_workspace_write(workspace_id));

-- eventos — só leitura via app, INSERT via Edge Function (service_role)
create policy "tev_select" on public.tracker_eventos for select using (public.is_workspace_member(workspace_id));

-- =====================================================
-- VIEWS — analytics
-- =====================================================

-- VIEW 1: agregação por vídeo (com dados do YouTube cache)
create or replace view public.tracker_video_stats as
select
    v.id                                                                            as video_uuid,
    v.workspace_id,
    v.canal_id,
    c.nome                                                                          as canal_nome,
    c.slug                                                                          as canal_slug,
    coalesce(v.tema, c.tema)                                                        as tema,
    v.src,
    v.video_id,
    v.titulo,
    v.thumb_url,
    v.youtube_url,
    v.view_count,
    v.published_at,
    count(case when e.event_type = 'CLICK' then 1 end)::int                         as cliques,
    count(case when e.event_type = 'PURCHASE_OUT_OF_SHOPPING_CART' then 1 end)::int as abandonos,
    count(case when e.event_type = 'PURCHASE_BILLET_PRINTED' then 1 end)::int       as boletos,
    count(case when e.event_type = 'PURCHASE_APPROVED' then 1 end)::int             as vendas,
    count(case when e.event_type = 'PURCHASE_REFUNDED' then 1 end)::int             as reembolsos,
    count(case when e.event_type = 'PURCHASE_CHARGEBACK' then 1 end)::int           as chargebacks,
    coalesce(sum(case when e.event_type = 'PURCHASE_APPROVED' then e.valor end), 0) as receita,
    max(e.created_at)                                                               as ultimo_evento
from public.tracker_videos v
left join public.tracker_canais c on c.id = v.canal_id
left join public.tracker_eventos e on e.video_id = v.id
group by v.id, v.workspace_id, v.canal_id, c.nome, c.slug, v.tema, c.tema, v.src,
         v.video_id, v.titulo, v.thumb_url, v.youtube_url, v.view_count, v.published_at;

-- VIEW 2: agregação por canal
create or replace view public.tracker_canal_stats as
select
    c.id                                                                            as canal_id,
    c.workspace_id,
    c.nome,
    c.slug,
    c.tema,
    c.youtube_url,
    count(distinct v.id)                                                            as videos_ativos,
    count(case when e.event_type = 'CLICK' then 1 end)::int                         as cliques,
    count(case when e.event_type = 'PURCHASE_OUT_OF_SHOPPING_CART' then 1 end)::int as abandonos,
    count(case when e.event_type = 'PURCHASE_APPROVED' then 1 end)::int             as vendas,
    coalesce(sum(case when e.event_type = 'PURCHASE_APPROVED' then e.valor end), 0) as receita,
    max(e.created_at)                                                               as ultimo_evento
from public.tracker_canais c
left join public.tracker_eventos e on e.canal_id = c.id
left join public.tracker_videos v  on v.canal_id = c.id
group by c.id, c.workspace_id, c.nome, c.slug, c.tema, c.youtube_url;

-- VIEW 3: agregação por tema
create or replace view public.tracker_tema_stats as
select
    coalesce(v.tema, c.tema, 'Sem tema')                                            as tema,
    v.workspace_id,
    count(distinct v.id)                                                            as videos,
    count(distinct c.id)                                                            as canais,
    count(case when e.event_type = 'PURCHASE_APPROVED' then 1 end)::int             as vendas,
    coalesce(sum(case when e.event_type = 'PURCHASE_APPROVED' then e.valor end), 0) as receita,
    case when count(distinct v.id) > 0
         then round(coalesce(sum(case when e.event_type = 'PURCHASE_APPROVED' then e.valor end), 0)
                    / count(distinct v.id), 2)
         else 0 end                                                                 as receita_por_video
from public.tracker_videos v
left join public.tracker_canais c on c.id = v.canal_id
left join public.tracker_eventos e on e.video_id = v.id
group by coalesce(v.tema, c.tema, 'Sem tema'), v.workspace_id;

-- =====================================================
-- REALTIME
-- =====================================================
alter publication supabase_realtime add table public.tracker_canais;
alter publication supabase_realtime add table public.tracker_produtos;
alter publication supabase_realtime add table public.tracker_videos;
alter publication supabase_realtime add table public.tracker_eventos;
alter publication supabase_realtime add table public.tracker_config;
