// Helpers compartilhados pra falar com a YouTube Data API v3

export interface YoutubeVideoData {
    titulo: string | null;
    descricao: string | null;
    thumb_url: string | null;
    view_count: number | null;
    like_count: number | null;
    comment_count: number | null;
    duracao_segundos: number | null;
    youtube_channel_title: string | null;
    published_at: string | null;
    youtube_url: string;
}

// Converte ISO 8601 (PT#H#M#S) em segundos
export function parseIsoDuration(iso: string | undefined): number | null {
    if (!iso) return null;
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return null;
    const h = parseInt(m[1] || '0', 10);
    const min = parseInt(m[2] || '0', 10);
    const s = parseInt(m[3] || '0', 10);
    return h * 3600 + min * 60 + s;
}

export async function fetchYoutubeVideo(videoId: string, apiKey: string): Promise<YoutubeVideoData | null> {
    if (!apiKey || !videoId) return null;
    const url = `https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(videoId)}&part=snippet,statistics,contentDetails&key=${apiKey}`;
    try {
        const resp = await fetch(url);
        if (!resp.ok) {
            console.error('YouTube API error', resp.status, await resp.text());
            return null;
        }
        const data = await resp.json();
        const v = data.items?.[0];
        if (!v) return null;
        const snippet = v.snippet || {};
        const stats = v.statistics || {};
        const details = v.contentDetails || {};
        const thumbs = snippet.thumbnails || {};
        const thumb = thumbs.maxres?.url || thumbs.standard?.url || thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || null;
        return {
            titulo: snippet.title || null,
            descricao: snippet.description || null,
            thumb_url: thumb,
            view_count: stats.viewCount ? Number(stats.viewCount) : null,
            like_count: stats.likeCount ? Number(stats.likeCount) : null,
            comment_count: stats.commentCount ? Number(stats.commentCount) : null,
            duracao_segundos: parseIsoDuration(details.duration),
            youtube_channel_title: snippet.channelTitle || null,
            published_at: snippet.publishedAt || null,
            youtube_url: `https://www.youtube.com/watch?v=${videoId}`,
        };
    } catch (err) {
        console.error('fetchYoutubeVideo failed', err);
        return null;
    }
}

// Extrai canal_slug e video_id de um src com convenção `<slug>_<video_id>`
// Mantido pra compatibilidade — não é mais o caminho principal de atribuição.
export function parseSrc(src: string | null | undefined): { canal_slug: string | null; video_id_yt: string | null } {
    if (!src) return { canal_slug: null, video_id_yt: null };
    const trimmed = src.trim();
    const idx = trimmed.indexOf('_');
    if (idx === -1) return { canal_slug: trimmed, video_id_yt: null };
    return {
        canal_slug: trimmed.slice(0, idx),
        video_id_yt: trimmed.slice(idx + 1) || null,
    };
}

// Tenta extrair o ucode do produto Hotmart de uma URL.
// Formatos suportados:
//   pay.hotmart.com/M12345678X         → "M12345678X"
//   pay.hotmart.com/M12345678X?off=abc → "M12345678X"
//   hotmart.com/produto/M12345678X     → "M12345678X"
//   hotm.io/IB2kx0OW                   → null (precisa resolver redirect)
export function extractUcodeFromUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    try {
        const u = new URL(url);
        if (u.hostname.includes('hotm.io')) return null; // short link
        // padrão Hotmart: letra + 8-12 chars alfanum
        const m = u.pathname.match(/\/([A-Z][0-9A-Z]{6,15})(?:\/|$|\?)/);
        return m ? m[1] : null;
    } catch {
        return null;
    }
}

// Tenta extrair o código de short link hotm.io
export function extractHotmIoCode(url: string | null | undefined): string | null {
    if (!url) return null;
    try {
        const u = new URL(url);
        if (!u.hostname.includes('hotm.io')) return null;
        const code = u.pathname.replace(/^\//, '').split('/')[0];
        return code || null;
    } catch {
        return null;
    }
}

// Parseia número do src: se for "42", retorna 42. Se for "alemao_42", retorna 42. Se for "abc", retorna null.
export function parseVideoNumber(src: string | null | undefined): number | null {
    if (!src) return null;
    const tail = src.includes('_') ? src.slice(src.lastIndexOf('_') + 1) : src;
    const n = parseInt(tail, 10);
    return Number.isFinite(n) ? n : null;
}
