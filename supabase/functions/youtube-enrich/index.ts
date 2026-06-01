// =====================================================
// YOUTUBE ENRICH — popula/refresh do cache de vídeos
// URL: https://<project>.functions.supabase.co/youtube-enrich
//
// POST body: { ws: "<workspace_id>", video_ids?: ["uuid1","uuid2"], all_stale?: boolean }
//
// Usado pra:
// - Re-enriquecer vídeos manualmente (botão "Atualizar views" no dashboard)
// - Cron: refresh diário de view_count dos vídeos top
// =====================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fetchYoutubeVideo, parseSrc } from '../_shared/youtube.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...corsHeaders },
    });
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

    const body = await req.json().catch(() => ({}));
    const workspaceId = body.ws as string;
    const videoIds = (body.video_ids as string[] | undefined) || [];
    const allStale = !!body.all_stale;

    if (!workspaceId) return json({ error: 'missing ws' }, 400);

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const { data: cfg } = await sb
        .from('tracker_config')
        .select('youtube_api_key')
        .eq('workspace_id', workspaceId)
        .maybeSingle();

    if (!cfg?.youtube_api_key) return json({ error: 'YouTube API key not configured' }, 400);

    // monta a lista de vídeos a enriquecer
    let q = sb.from('tracker_videos').select('id, src, video_id, enriquecido_em').eq('workspace_id', workspaceId);
    if (videoIds.length) q = q.in('id', videoIds);
    else if (allStale) {
        // stale = não enriquecido OU enriquecido há mais de 24h
        const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        q = q.or(`enriquecido_em.is.null,enriquecido_em.lt.${cutoff}`);
    } else {
        // padrão: só os ainda não enriquecidos
        q = q.is('enriquecido_em', null);
    }
    q = q.limit(50);

    const { data: vids, error: listErr } = await q;
    if (listErr) return json({ error: listErr.message }, 500);
    if (!vids?.length) return json({ ok: true, enriched: 0, message: 'nothing to enrich' });

    let enriched = 0;
    let failed = 0;

    for (const v of vids) {
        const vidId = v.video_id || parseSrc(v.src).video_id_yt;
        if (!vidId) { failed++; continue; }
        const yt = await fetchYoutubeVideo(vidId, cfg.youtube_api_key);
        if (!yt) { failed++; continue; }
        const { error: upErr } = await sb
            .from('tracker_videos')
            .update({
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
            })
            .eq('id', v.id);
        if (upErr) failed++;
        else enriched++;
    }

    return json({ ok: true, enriched, failed, total: vids.length });
});
