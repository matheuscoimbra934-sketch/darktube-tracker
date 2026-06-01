// =====================================================
// TRACKER CLICK — rastreador de cliques
// URL: https://<project>.functions.supabase.co/tracker-click?ws=<workspace_id>&src=<src>&to=<hotmart_url_base64>
//
// Uso na descrição do YouTube:
//   https://<project>.functions.supabase.co/tracker-click?ws=...&src=gospel_abc123&pid=<produto_uuid>
//
// Ou direto com to=:
//   ?ws=...&src=gospel_abc123&to=aHR0cHM6Ly9wYXkuaG90bWFydC5jb20vTTEyMzQ1Njc4WA==
//
// Registra o clique e redireciona pro hotmart_url do produto com ?src= anexado.
// =====================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseSrc, parseVideoNumber, fetchYoutubeVideo } from '../_shared/youtube.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get('ws');
    const src = url.searchParams.get('src');
    const pid = url.searchParams.get('pid');     // produto uuid
    const to = url.searchParams.get('to');       // hotmart_url base64

    if (!workspaceId || !src) {
        return new Response('Missing ?ws=<workspace_id>&src=<src>', { status: 400 });
    }

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // resolve hotmart_url: prioridade 1) URL base64 explícita, 2) cid (canal), 3) pid (produto legado)
    const cid = url.searchParams.get('cid');  // canal_id
    let hotmartUrl: string | null = null;
    let canal_id: string | null = null;
    let rede_id: string | null = null;
    let pessoa_id: string | null = null;

    if (to) {
        try { hotmartUrl = atob(to); } catch {}
    }

    if (cid) {
        const { data: c } = await sb
            .from('tracker_canais')
            .select('id, rede_id, hotmart_url, tracker_redes(pessoa_id)')
            .eq('workspace_id', workspaceId)
            .eq('id', cid)
            .maybeSingle();
        if (c) {
            canal_id = c.id;
            rede_id = c.rede_id;
            pessoa_id = (c as any).tracker_redes?.pessoa_id ?? null;
            if (!hotmartUrl) hotmartUrl = c.hotmart_url ?? null;
        }
    }

    if (!hotmartUrl && pid) {
        const { data: p } = await sb
            .from('tracker_produtos')
            .select('hotmart_url')
            .eq('workspace_id', workspaceId)
            .eq('id', pid)
            .maybeSingle();
        hotmartUrl = p?.hotmart_url ?? null;
    }

    if (!hotmartUrl) {
        return new Response('No destination URL — provide ?cid=<canal_id> or ?to=<base64>', { status: 404 });
    }

    // fallback: resolve canal pelo prefix do src (compat com convenção antiga)
    const { canal_slug, video_id_yt } = parseSrc(src);
    if (!canal_id && canal_slug) {
        const { data: c } = await sb
            .from('tracker_canais')
            .select('id, rede_id, tracker_redes(pessoa_id)')
            .eq('workspace_id', workspaceId)
            .eq('slug', canal_slug)
            .maybeSingle();
        if (c) {
            canal_id = c.id;
            rede_id = c.rede_id;
            pessoa_id = (c as any).tracker_redes?.pessoa_id ?? null;
        }
    }

    const videoNumero = parseVideoNumber(src);

    // resolve ou cria vídeo + tenta enriquecimento se nova
    let video_uuid: string | null = null;
    if (src) {
        const { data: existing } = await sb
            .from('tracker_videos')
            .select('id')
            .eq('workspace_id', workspaceId)
            .eq('src', src)
            .maybeSingle();

        if (existing) {
            video_uuid = existing.id;
        } else {
            const { data: cfg } = await sb
                .from('tracker_config')
                .select('youtube_api_key')
                .eq('workspace_id', workspaceId)
                .maybeSingle();
            let enrich: any = {};
            if (cfg?.youtube_api_key && video_id_yt) {
                const yt = await fetchYoutubeVideo(video_id_yt, cfg.youtube_api_key);
                if (yt) {
                    enrich = {
                        titulo: yt.titulo,
                        descricao: yt.descricao,
                        thumb_url: yt.thumb_url,
                        view_count: yt.view_count,
                        like_count: yt.like_count,
                        comment_count: yt.comment_count,
                        duracao_segundos: yt.duracao_segundos,
                        youtube_url: yt.youtube_url,
                        youtube_channel_title: yt.youtube_channel_title,
                        published_at: yt.published_at,
                        enriquecido_em: new Date().toISOString(),
                    };
                }
            }
            const { data: created } = await sb
                .from('tracker_videos')
                .insert({
                    workspace_id: workspaceId,
                    canal_id,
                    rede_id,
                    pessoa_id,
                    src,
                    video_id: video_id_yt,
                    numero: videoNumero,
                    ...enrich,
                })
                .select('id')
                .single();
            video_uuid = created?.id ?? null;
        }
    }

    // registra clique (não bloqueia o redirect)
    sb.from('tracker_eventos').insert({
        workspace_id: workspaceId,
        canal_id,
        rede_id,
        pessoa_id,
        video_id: video_uuid,
        src,
        canal_slug,
        video_id_yt,
        event_type: 'CLICK',
        ip: req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? null,
        user_agent: req.headers.get('user-agent') ?? null,
        raw_payload: { referer: req.headers.get('referer') ?? null },
    }).then(() => {});

    // monta URL final com ?src= e redireciona
    let target: URL;
    try {
        target = new URL(hotmartUrl);
        target.searchParams.set('src', src);
    } catch {
        return new Response('Invalid destination URL', { status: 500 });
    }

    return Response.redirect(target.toString(), 302);
});
