// =====================================================
// TRACKER WEBHOOK — Hotmart Postback receiver
// URL: https://<project>.functions.supabase.co/tracker-webhook?ws=<workspace_id>
//
// Fluxo:
// 1. Recebe postback Hotmart 1.0 ou 2.0
// 2. Valida Hottok (config por workspace)
// 3. Extrai src → parseia canal_slug + video_id_yt
// 4. Procura canal pelo slug → vincula
// 5. Procura ou CRIA vídeo (auto-discovery) → vincula
// 6. Se houver YouTube API key e vídeo for novo → enriquece (título, thumb, views)
// 7. Insere evento com FKs resolvidas
// =====================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseSrc, parseVideoNumber, fetchYoutubeVideo } from '../_shared/youtube.ts';

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

    const url = new URL(req.url);
    const workspaceId = url.searchParams.get('ws');
    if (!workspaceId) return json({ error: 'missing ?ws=<workspace_id>' }, 400);

    let payload: any;
    try { payload = await req.json(); }
    catch { return json({ error: 'invalid json' }, 400); }

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // valida config + hottok
    const { data: cfg } = await sb
        .from('tracker_config')
        .select('hottok, youtube_api_key')
        .eq('workspace_id', workspaceId)
        .maybeSingle();

    if (!cfg) return json({ error: 'workspace not configured' }, 403);
    if (cfg.hottok && payload.hottok !== cfg.hottok) {
        return json({ error: 'invalid hottok' }, 401);
    }

    // parse Hotmart v1.0 ou v2.0
    const isV2 = !!payload.event && !!payload.data;
    let eventType: string;
    let src: string | null = null;
    let valor: number | null = null;
    let moeda: string | null = null;
    let comprador_nome: string | null = null;
    let comprador_email: string | null = null;
    let transaction_id: string | null = null;
    let produto_nome: string | null = null;
    let produto_hotmart_id: string | null = null;
    let pais: string | null = null;

    if (isV2) {
        eventType = String(payload.event || 'UNKNOWN').toUpperCase();
        const d = payload.data || {};
        src = d?.purchase?.tracking?.source
            ?? d?.tracking?.source
            ?? d?.subscription?.tracking?.source
            ?? d?.checkout?.tracking?.source
            ?? null;
        // Tenta de TUDO quanto é lugar onde o valor pode estar
        const rawValor =
            d?.purchase?.price?.value
            ?? d?.purchase?.full_price?.value
            ?? d?.purchase?.offer?.price?.value
            ?? d?.purchase?.original_offer_price?.value
            ?? d?.purchase?.recurrence_price?.value
            ?? d?.commissions?.[0]?.value
            ?? d?.commissions?.[0]?.amount
            ?? d?.subscription?.plan?.recurrency_period?.value
            ?? null;
        valor = rawValor != null ? Number(rawValor) : null;
        if (valor != null && Number.isNaN(valor)) valor = null;

        moeda = (d?.purchase?.price?.currency_value
            ?? d?.purchase?.full_price?.currency_value
            ?? d?.purchase?.offer?.price?.currency_value
            ?? d?.purchase?.original_offer_price?.currency_value
            ?? d?.commissions?.[0]?.currency_value
            ?? null);
        if (typeof moeda === 'string') moeda = moeda.toUpperCase();

        comprador_nome = d?.buyer?.name ?? null;
        comprador_email = d?.buyer?.email ?? d?.subscriber?.email ?? null;
        transaction_id = d?.purchase?.transaction ?? d?.subscription?.subscriber?.code ?? null;
        produto_nome = d?.product?.name ?? null;
        produto_hotmart_id = d?.product?.ucode ?? (d?.product?.id != null ? String(d.product.id) : null);
        pais = d?.purchase?.checkout_country?.iso ?? d?.buyer?.address?.country_iso ?? null;
    } else {
        const statusMap: Record<string, string> = {
            'approved': 'PURCHASE_APPROVED',
            'refunded': 'PURCHASE_REFUNDED',
            'chargeback': 'PURCHASE_CHARGEBACK',
            'canceled': 'PURCHASE_CANCELED',
            'expired': 'PURCHASE_EXPIRED',
            'pending_payment': 'PURCHASE_BILLET_PRINTED',
        };
        eventType = statusMap[String(payload.status || '').toLowerCase()] ?? 'UNKNOWN';
        src = payload.src ?? payload.xcod ?? null;
        valor = payload.prod_price ? Number(payload.prod_price) : null;
        moeda = payload.currency ?? null;
        comprador_nome = payload.name ?? null;
        comprador_email = payload.email ?? null;
        transaction_id = payload.transaction ?? null;
        produto_nome = payload.prod ?? null;
    }

    // ===== RESOLUÇÃO DE CANAL =====
    // Estratégia nova: cada canal tem seu link Hotmart fixo, então identificamos
    // o canal pelo PRODUCT ID que vem no postback (não mais pelo prefixo do src).
    // Fallback pra slug do src se canal não tiver hotmart_id ainda.
    let canal_id: string | null = null;
    let pessoa_id: string | null = null;
    let rede_id: string | null = null;

    if (produto_hotmart_id) {
        const { data: c } = await sb
            .from('tracker_canais')
            .select('id, rede_id, tracker_redes(pessoa_id)')
            .eq('workspace_id', workspaceId)
            .eq('hotmart_id', produto_hotmart_id)
            .maybeSingle();
        if (c) {
            canal_id = c.id;
            rede_id = c.rede_id;
            pessoa_id = (c as any).tracker_redes?.pessoa_id ?? null;
        }
    }

    // Fallback antigo: tenta resolver pelo slug no src
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

    // Número sequencial do vídeo dentro do canal
    const videoNumero = parseVideoNumber(src);

    // ===== RESOLUÇÃO OU CRIAÇÃO DO VÍDEO =====
    let video_uuid: string | null = null;
    if (src) {
        // procura por src completo OU por (canal_id + numero)
        let existing: any = null;
        const { data: bySrc } = await sb
            .from('tracker_videos')
            .select('id')
            .eq('workspace_id', workspaceId)
            .eq('src', src)
            .maybeSingle();
        existing = bySrc;

        if (!existing && canal_id && videoNumero !== null) {
            const { data: byNum } = await sb
                .from('tracker_videos')
                .select('id')
                .eq('workspace_id', workspaceId)
                .eq('canal_id', canal_id)
                .eq('numero', videoNumero)
                .maybeSingle();
            existing = byNum;
        }

        if (existing) {
            video_uuid = existing.id;
        } else {
            // cria entrada nova; enriquecimento via YouTube API se houver key + video_id_yt
            let enrich: any = {};
            if (cfg.youtube_api_key && video_id_yt) {
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
            const { data: created, error: createErr } = await sb
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
            if (createErr) console.error('video insert error', createErr);
            video_uuid = created?.id ?? null;
        }
    }

    // ===== INSERE EVENTO =====
    const { error } = await sb.from('tracker_eventos').insert({
        workspace_id: workspaceId,
        canal_id,
        rede_id,
        pessoa_id,
        video_id: video_uuid,
        src,
        canal_slug,
        video_id_yt,
        event_type: eventType,
        valor,
        moeda,
        comprador_nome,
        comprador_email,
        transaction_id,
        produto_nome,
        pais,
        raw_payload: payload,
    });

    if (error) {
        console.error('event insert error', error);
        return json({ error: 'failed to record event', detail: error.message }, 500);
    }

    return json({
        ok: true,
        event: eventType,
        src,
        canal_resolved: !!canal_id,
        rede_resolved: !!rede_id,
        pessoa_resolved: !!pessoa_id,
        video_numero: videoNumero,
        video_resolved: !!video_uuid,
    });
});
