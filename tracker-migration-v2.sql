-- =====================================================
-- DARKTUBE TRACKER — Migração v2: Pessoas + Redes + Canal com link
-- Rode no SQL Editor do Supabase APÓS o tracker-schema.sql
-- =====================================================

-- 1) PESSOAS (quem opera os canais)
create table if not exists public.tracker_pessoas (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid references public.workspaces(id) on delete cascade not null,
    nome text not null,
    slug text not null,
    email text,
    obs text,
    created_at timestamptz default now(),
    created_by uuid references auth.users(id),
    unique (workspace_id, slug)
);

-- 2) REDES (grupo de canais; cada rede pertence a 1 pessoa)
create table if not exists public.tracker_redes (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid references public.workspaces(id) on delete cascade not null,
    pessoa_id uuid references public.tracker_pessoas(id) on delete set null,
    nome text not null,
    slug text not null,
    tema text,
    obs text,
    created_at timestamptz default now(),
    created_by uuid references auth.users(id),
    unique (workspace_id, slug)
);

-- 3) CANAIS: adiciona rede_id, hotmart_url, hotmart_id
alter table public.tracker_canais add column if not exists rede_id uuid references public.tracker_redes(id) on delete set null;
alter table public.tracker_canais add column if not exists hotmart_url text;
alter table public.tracker_canais add column if not exists hotmart_id text;
alter table public.tracker_canais add column if not exists pais text;

-- 4) EVENTOS: adiciona pessoa_id e rede_id pra consultas rápidas
alter table public.tracker_eventos add column if not exists pessoa_id uuid references public.tracker_pessoas(id) on delete set null;
alter table public.tracker_eventos add column if not exists rede_id uuid references public.tracker_redes(id) on delete set null;

-- 5) VIDEOS: adiciona pessoa_id e rede_id
alter table public.tracker_videos add column if not exists pessoa_id uuid references public.tracker_pessoas(id) on delete set null;
alter table public.tracker_videos add column if not exists rede_id uuid references public.tracker_redes(id) on delete set null;
alter table public.tracker_videos add column if not exists numero int;  -- número sequencial do vídeo dentro do canal

-- =====================================================
-- ÍNDICES
-- =====================================================
create index if not exists idx_tracker_pessoas_ws  on public.tracker_pessoas(workspace_id);
create index if not exists idx_tracker_redes_ws    on public.tracker_redes(workspace_id);
create index if not exists idx_tracker_redes_pessoa on public.tracker_redes(pessoa_id);
create index if not exists idx_tracker_canais_rede on public.tracker_canais(rede_id);
create index if not exists idx_tracker_canais_hotmartid on public.tracker_canais(workspace_id, hotmart_id);
create index if not exists idx_tracker_eventos_pessoa on public.tracker_eventos(pessoa_id);
create index if not exists idx_tracker_eventos_rede   on public.tracker_eventos(rede_id);
create index if not exists idx_tracker_videos_canal_numero on public.tracker_videos(canal_id, numero);

-- =====================================================
-- RLS
-- =====================================================
alter table public.tracker_pessoas enable row level security;
alter table public.tracker_redes enable row level security;

create policy "tpes_select" on public.tracker_pessoas for select using (public.is_workspace_member(workspace_id));
create policy "tpes_insert" on public.tracker_pessoas for insert with check (public.has_workspace_write(workspace_id));
create policy "tpes_update" on public.tracker_pessoas for update using (public.has_workspace_write(workspace_id));
create policy "tpes_delete" on public.tracker_pessoas for delete using (public.has_workspace_write(workspace_id));

create policy "tred_select" on public.tracker_redes for select using (public.is_workspace_member(workspace_id));
create policy "tred_insert" on public.tracker_redes for insert with check (public.has_workspace_write(workspace_id));
create policy "tred_update" on public.tracker_redes for update using (public.has_workspace_write(workspace_id));
create policy "tred_delete" on public.tracker_redes for delete using (public.has_workspace_write(workspace_id));

-- =====================================================
-- REALTIME
-- =====================================================
alter publication supabase_realtime add table public.tracker_pessoas;
alter publication supabase_realtime add table public.tracker_redes;

-- =====================================================
-- VIEWS — recriar com hierarquia
-- =====================================================

-- VIEW: stats por pessoa
create or replace view public.tracker_pessoa_stats as
select
    p.id                                                                            as pessoa_id,
    p.workspace_id,
    p.nome,
    p.slug,
    count(distinct r.id)                                                            as redes,
    count(distinct c.id)                                                            as canais,
    count(distinct v.id)                                                            as videos,
    count(case when e.event_type = 'CLICK' then 1 end)::int                         as cliques,
    count(case when e.event_type = 'PURCHASE_APPROVED' then 1 end)::int             as vendas,
    coalesce(sum(case when e.event_type = 'PURCHASE_APPROVED' then e.valor end), 0) as receita,
    max(e.created_at)                                                               as ultimo_evento
from public.tracker_pessoas p
left join public.tracker_redes r on r.pessoa_id = p.id
left join public.tracker_canais c on c.rede_id = r.id
left join public.tracker_videos v on v.canal_id = c.id
left join public.tracker_eventos e on e.pessoa_id = p.id
group by p.id, p.workspace_id, p.nome, p.slug;

-- VIEW: stats por rede
create or replace view public.tracker_rede_stats as
select
    r.id                                                                            as rede_id,
    r.workspace_id,
    r.pessoa_id,
    p.nome                                                                          as pessoa_nome,
    r.nome,
    r.slug,
    r.tema,
    count(distinct c.id)                                                            as canais,
    count(distinct v.id)                                                            as videos,
    count(case when e.event_type = 'CLICK' then 1 end)::int                         as cliques,
    count(case when e.event_type = 'PURCHASE_APPROVED' then 1 end)::int             as vendas,
    coalesce(sum(case when e.event_type = 'PURCHASE_APPROVED' then e.valor end), 0) as receita,
    max(e.created_at)                                                               as ultimo_evento
from public.tracker_redes r
left join public.tracker_pessoas p on p.id = r.pessoa_id
left join public.tracker_canais c on c.rede_id = r.id
left join public.tracker_videos v on v.canal_id = c.id
left join public.tracker_eventos e on e.rede_id = r.id
group by r.id, r.workspace_id, r.pessoa_id, p.nome, r.nome, r.slug, r.tema;

-- VIEW: stats por canal (recriada com hierarquia)
drop view if exists public.tracker_canal_stats;
create or replace view public.tracker_canal_stats as
select
    c.id                                                                            as canal_id,
    c.workspace_id,
    c.rede_id,
    r.pessoa_id,
    p.nome                                                                          as pessoa_nome,
    r.nome                                                                          as rede_nome,
    c.nome,
    c.slug,
    c.tema,
    c.pais,
    c.hotmart_url,
    c.youtube_url,
    count(distinct v.id)                                                            as videos,
    count(case when e.event_type = 'CLICK' then 1 end)::int                         as cliques,
    count(case when e.event_type = 'PURCHASE_OUT_OF_SHOPPING_CART' then 1 end)::int as abandonos,
    count(case when e.event_type = 'PURCHASE_APPROVED' then 1 end)::int             as vendas,
    coalesce(sum(case when e.event_type = 'PURCHASE_APPROVED' then e.valor end), 0) as receita,
    max(e.created_at)                                                               as ultimo_evento
from public.tracker_canais c
left join public.tracker_redes r on r.id = c.rede_id
left join public.tracker_pessoas p on p.id = r.pessoa_id
left join public.tracker_videos v on v.canal_id = c.id
left join public.tracker_eventos e on e.canal_id = c.id
group by c.id, c.workspace_id, c.rede_id, r.pessoa_id, p.nome, r.nome, c.nome, c.slug, c.tema, c.pais, c.hotmart_url, c.youtube_url;
