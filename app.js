/* =====================================================
   DARKTUBE TRACKER — App
   YouTube × Hotmart sales tracker
===================================================== */

const sb = window.supabase.createClient(
    window.TRACKER_CONFIG.SUPABASE_URL,
    window.TRACKER_CONFIG.SUPABASE_ANON_KEY
);

const state = {
    user: null,
    workspaces: [],
    currentWorkspaceId: null,
    members: [],
    pessoas: [],
    redes: [],
    canais: [],
    produtos: [],
    videos: [],
    eventos: [],
    config: null,
};

let charts = {};
let realtimeChannel = null;
let currentTab = 'dashboard';
let editingItem = null;
let editingType = null;
let eventoFilter = 'all';

/* ========== HELPERS ========== */
const fmtBRL = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (n) => (Number(n) || 0).toLocaleString('pt-BR');
const fmtViews = (n) => {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toString();
};
const MOEDA_SYMBOL = { BRL: 'R$', USD: 'US$', EUR: '€', MXN: 'MX$', ARS: 'AR$', GBP: '£', JPY: '¥' };

// Países suportados (ordenados como o user pediu) com idioma e bandeira
const PAISES_LIST = [
    { nome: 'Alemão',       idioma: 'de', flag: '🇩🇪' },
    { nome: 'Brasil',       idioma: 'pt', flag: '🇧🇷' },
    { nome: 'Bulgária',     idioma: 'bg', flag: '🇧🇬' },
    { nome: 'Rep. Checa',   idioma: 'cs', flag: '🇨🇿' },
    { nome: 'Croácia',      idioma: 'hr', flag: '🇭🇷' },
    { nome: 'Eslováquia',   idioma: 'sk', flag: '🇸🇰' },
    { nome: 'Eslovênia',    idioma: 'sl', flag: '🇸🇮' },
    { nome: 'Espanha',      idioma: 'es', flag: '🇪🇸' },
    { nome: 'Filipinas',    idioma: 'tl', flag: '🇵🇭' },
    { nome: 'Finlândia',    idioma: 'fi', flag: '🇫🇮' },
    { nome: 'França',       idioma: 'fr', flag: '🇫🇷' },
    { nome: 'Grécia',       idioma: 'el', flag: '🇬🇷' },
    { nome: 'Holanda',      idioma: 'nl', flag: '🇳🇱' },
    { nome: 'Hungria',      idioma: 'hu', flag: '🇭🇺' },
    { nome: 'Inglês',       idioma: 'en', flag: '🇬🇧' },
    { nome: 'Itália',       idioma: 'it', flag: '🇮🇹' },
    { nome: 'Polônia',      idioma: 'pl', flag: '🇵🇱' },
    { nome: 'Romênia',      idioma: 'ro', flag: '🇷🇴' },
    { nome: 'Sérvia',       idioma: 'sr', flag: '🇷🇸' },
    { nome: 'Suécia',       idioma: 'sv', flag: '🇸🇪' },
];
const IDIOMAS_LIST = Array.from(new Set(['pt', ...PAISES_LIST.map(p => p.idioma)])).sort();
const fmtMoeda = (valor, moeda) => {
    const m = (moeda || 'BRL').toUpperCase();
    const sym = MOEDA_SYMBOL[m] || m;
    return `${sym} ${Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Agrega receita por moeda numa lista de vendas (eventos PURCHASE_APPROVED)
function receitaPorMoeda(eventos) {
    const map = {};
    eventos.filter(e => e.event_type === 'PURCHASE_APPROVED').forEach(e => {
        const m = (e.moeda || 'BRL').toUpperCase();
        map[m] = (map[m] || 0) + Number(e.valor || 0);
    });
    return map;
}

// Formata { BRL: 1500, USD: 230 } como "R$ 1.500,00 · US$ 230,00"
function fmtReceitaMix(map) {
    const entries = Object.entries(map).filter(([_, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return fmtMoeda(0, 'BRL');
    return entries.map(([m, v]) => fmtMoeda(v, m)).join(' · ');
}

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function toast(msg, kind = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show ' + kind;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.className = 'toast', 2800);
}

function copyText(text, label = 'Link') {
    if (!text) return;
    navigator.clipboard.writeText(text)
        .then(() => toast(`${label} copiado!`, 'success'))
        .catch(() => toast('Não foi possível copiar', 'error'));
}
window.copyText = copyText;

function updateClock() {
    const el = document.getElementById('status-time');
    if (el) el.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

const currentWorkspace = () => state.workspaces.find(w => w.id === state.currentWorkspaceId);
const myRole = () => {
    const m = state.members.find(m => m.user_id === state.user.id);
    return m ? m.role : null;
};
const canWrite = () => ['owner', 'editor'].includes(myRole());
const isOwner = () => myRole() === 'owner';

/* ========== BOOT ========== */
async function boot() {
    try {
        const { data: { session } } = await sb.auth.getSession();
        if (session) await onSignedIn(session.user);
        else showAuth();
    } catch (e) {
        console.error(e);
        showAuth();
    }
    sb.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') location.reload();
    });
}

function showAuth() {
    document.getElementById('boot').hidden = true;
    document.getElementById('auth-screen').hidden = false;
    document.getElementById('app').hidden = true;
}
function showApp() {
    document.getElementById('boot').hidden = true;
    document.getElementById('auth-screen').hidden = true;
    document.getElementById('app').hidden = false;
}

/* ========== AUTH ========== */
function traduzErro(msg) {
    if (/invalid login credentials/i.test(msg)) return 'Email ou senha incorretos';
    if (/email not confirmed/i.test(msg)) return 'Confirme seu email primeiro';
    if (/already registered/i.test(msg)) return 'Email já cadastrado';
    if (/password should be/i.test(msg)) return 'Senha precisa ter no mínimo 6 caracteres';
    return msg;
}

async function handleLogin(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errBox = document.getElementById('login-error');
    const btn = e.target.querySelector('button[type=submit]');
    const label = btn.querySelector('.btn-label');
    const loader = btn.querySelector('.btn-loader');
    errBox.hidden = true;
    btn.disabled = true; label.hidden = true; loader.hidden = false;
    try {
        const { data, error } = await sb.auth.signInWithPassword({ email: fd.get('email').trim(), password: fd.get('password') });
        if (error) throw error;
        await onSignedIn(data.user);
    } catch (err) {
        errBox.textContent = traduzErro(err.message);
        errBox.hidden = false;
        btn.disabled = false; label.hidden = false; loader.hidden = true;
    }
}

async function handleSignup(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errBox = document.getElementById('signup-error');
    const btn = e.target.querySelector('button[type=submit]');
    const label = btn.querySelector('.btn-label');
    const loader = btn.querySelector('.btn-loader');
    errBox.hidden = true;
    btn.disabled = true; label.hidden = true; loader.hidden = false;
    try {
        const { data, error } = await sb.auth.signUp({ email: fd.get('email').trim(), password: fd.get('password') });
        if (error) throw error;
        if (data.session) {
            const wsName = fd.get('workspace').trim();
            const { data: ws, error: wsErr } = await sb.from('workspaces').insert({ name: wsName, owner_id: data.user.id }).select().single();
            if (wsErr) throw wsErr;
            await onSignedIn(data.user);
        } else {
            errBox.textContent = 'Verifique seu email para confirmar a conta.';
            errBox.hidden = false;
        }
    } catch (err) {
        errBox.textContent = traduzErro(err.message);
        errBox.hidden = false;
    } finally {
        btn.disabled = false; label.hidden = false; loader.hidden = true;
    }
}

function switchAuthTab(name) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.authTab === name));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.toggle('active', f.id === `form-${name}`));
}

async function onSignedIn(user) {
    state.user = user;
    document.getElementById('user-avatar').textContent = (user.email || '?').charAt(0).toUpperCase();
    document.getElementById('user-name').textContent = user.email;
    showApp();
    await loadWorkspaces();
    if (state.workspaces.length === 0) {
        // criar workspace padrão
        const { data: ws, error } = await sb.from('workspaces').insert({ name: 'Tracker', owner_id: user.id }).select().single();
        if (error) { toast('Erro ao criar workspace', 'error'); return; }
        state.workspaces = [ws];
        state.currentWorkspaceId = ws.id;
    } else {
        state.currentWorkspaceId = state.workspaces[0].id;
    }
    await loadAllData();
    renderAll();
    setupRealtime();
}

async function loadWorkspaces() {
    const { data } = await sb.from('workspaces').select('*').order('created_at');
    state.workspaces = data || [];
}

async function handleLogout() {
    if (!confirm('Deseja sair?')) return;
    if (realtimeChannel) await sb.removeChannel(realtimeChannel);
    await sb.auth.signOut();
}

/* ========== DATA ========== */
async function loadAllData() {
    const wsId = state.currentWorkspaceId;
    if (!wsId) return;
    const [pessoas, redes, canais, produtos, videos, eventos, members, cfg] = await Promise.all([
        sb.from('tracker_pessoas').select('*').eq('workspace_id', wsId).order('nome'),
        sb.from('tracker_redes').select('*').eq('workspace_id', wsId).order('nome'),
        sb.from('tracker_canais').select('*').eq('workspace_id', wsId).order('created_at', { ascending: false }),
        sb.from('tracker_produtos').select('*').eq('workspace_id', wsId).order('created_at', { ascending: false }),
        sb.from('tracker_videos').select('*').eq('workspace_id', wsId).order('created_at', { ascending: false }).limit(500),
        sb.from('tracker_eventos').select('*').eq('workspace_id', wsId).order('created_at', { ascending: false }).limit(2000),
        sb.from('workspace_members').select('*').eq('workspace_id', wsId),
        sb.from('tracker_config').select('*').eq('workspace_id', wsId).maybeSingle(),
    ]);
    state.pessoas = pessoas.data || [];
    state.redes = redes.data || [];
    state.canais = canais.data || [];
    state.produtos = produtos.data || [];
    state.videos = videos.data || [];
    state.eventos = eventos.data || [];
    state.members = members.data || [];
    state.config = cfg.data || null;
}

/* ========== REALTIME ========== */
async function setupRealtime() {
    if (realtimeChannel) await sb.removeChannel(realtimeChannel);
    const wsId = state.currentWorkspaceId;
    const filter = `workspace_id=eq.${wsId}`;
    realtimeChannel = sb.channel(`tracker-${wsId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tracker_pessoas', filter }, (p) => handleRT('pessoas', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tracker_redes', filter }, (p) => handleRT('redes', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tracker_canais', filter }, (p) => handleRT('canais', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tracker_produtos', filter }, (p) => handleRT('produtos', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tracker_videos', filter }, (p) => handleRT('videos', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tracker_eventos', filter }, (p) => handleRTEvento(p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tracker_config', filter }, () => { loadAllData().then(renderAll); })
        .subscribe();
}

function handleRT(key, payload) {
    const arr = state[key];
    if (payload.eventType === 'INSERT') { if (!arr.find(x => x.id === payload.new.id)) arr.unshift(payload.new); }
    else if (payload.eventType === 'UPDATE') { const i = arr.findIndex(x => x.id === payload.new.id); if (i >= 0) arr[i] = payload.new; }
    else if (payload.eventType === 'DELETE') { const i = arr.findIndex(x => x.id === payload.old.id); if (i >= 0) arr.splice(i, 1); }
    renderAll();
}

function handleRTEvento(payload) {
    if (payload.eventType !== 'INSERT' || !payload.new) return;
    if (state.eventos.find(x => x.id === payload.new.id)) return;
    state.eventos.unshift(payload.new);
    const e = payload.new;
    const srcLabel = e.src || 'sem src';
    const valor = Number(e.valor || 0);
    const moeda = e.moeda || 'BRL';
    const toastMap = {
        PURCHASE_APPROVED:           { msg: `Nova venda! ${moeda} ${valor.toFixed(2)} — ${srcLabel}`, kind: 'success' },
        PURCHASE_COMPLETE:           { msg: `Compra confirmada — ${srcLabel}`, kind: 'success' },
        PURCHASE_OUT_OF_SHOPPING_CART: { msg: `Carrinho abandonado — ${srcLabel}`, kind: '' },
        PURCHASE_BILLET_PRINTED:     { msg: `Boleto gerado — ${srcLabel}`, kind: '' },
        PURCHASE_REFUNDED:           { msg: `Reembolso — ${srcLabel}`, kind: 'error' },
        PURCHASE_CHARGEBACK:         { msg: `Chargeback ${moeda} ${valor.toFixed(2)} — ${srcLabel}`, kind: 'error' },
    };
    if (toastMap[e.event_type]) toast(toastMap[e.event_type].msg, toastMap[e.event_type].kind);

    // 🎉 POP-UP CELEBRATIVO em vendas aprovadas
    if (e.event_type === 'PURCHASE_APPROVED' || e.event_type === 'PURCHASE_COMPLETE') {
        showSaleCelebration(e);
    }

    renderAll();
}

/* ========== POP-UP DE VENDA ========== */
const NOTIF_PREFS_KEY = 'tracker_notif_prefs';
function getNotifPrefs() {
    try { return JSON.parse(localStorage.getItem(NOTIF_PREFS_KEY) || '{}'); }
    catch { return {}; }
}
function setNotifPrefs(p) {
    try { localStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(p)); } catch {}
}

function showSaleCelebration(e) {
    const prefs = getNotifPrefs();
    if (prefs.popup === false) return;  // user disabled

    const overlay = document.getElementById('sale-pop-overlay');
    const valor = Number(e.valor || 0);
    const moeda = (e.moeda || 'BRL').toUpperCase();
    const sym = MOEDA_SYMBOL[moeda] || moeda;
    const pessoa = state.pessoas.find(p => p.id === e.pessoa_id);
    const rede = state.redes.find(r => r.id === e.rede_id);
    const canal = state.canais.find(c => c.id === e.canal_id);

    document.getElementById('sale-pop-title').textContent = e.event_type === 'PURCHASE_COMPLETE' ? 'Compra Confirmada (pós-garantia)' : 'Compra Aprovada';
    document.getElementById('sale-pop-amount').innerHTML = `<span class="moeda">${sym}</span>${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('sale-pop-meta').textContent = e.src ? `SRC ${e.src}` : 'sem src';
    document.getElementById('sale-pop-pessoa').textContent = pessoa?.nome || '—';
    document.getElementById('sale-pop-rede').textContent = rede?.nome || '—';
    document.getElementById('sale-pop-canal').textContent = canal ? `${canal.nome}${canal.pais ? ' · ' + canal.pais : ''}` : '—';
    document.getElementById('sale-pop-comprador').textContent = e.comprador_nome || e.comprador_email || '—';

    overlay.classList.add('show');

    // som
    if (prefs.sound !== false) playKaChing();

    // confete
    fireConfetti();

    // notificação browser
    if (prefs.browser === true && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
            new Notification(`💰 Venda! ${sym} ${valor.toFixed(2)}`, {
                body: `${pessoa?.nome || ''} · ${canal?.nome || ''}${e.comprador_nome ? ' · ' + e.comprador_nome : ''}`,
                icon: window.location.origin + '/favicon.ico',
                tag: e.id,
            });
        } catch {}
    }

    // auto-fecha em 7s
    clearTimeout(showSaleCelebration._t);
    showSaleCelebration._t = setTimeout(closeSalePop, 7000);
}

function closeSalePop() {
    document.getElementById('sale-pop-overlay').classList.remove('show');
    document.getElementById('confetti').innerHTML = '';
}

// Som "ka-ching" via Web Audio API (sem arquivo externo)
let _audioCtx = null;
function playKaChing() {
    try {
        if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const ctx = _audioCtx;
        if (ctx.state === 'suspended') ctx.resume();
        const now = ctx.currentTime;
        // 3 notas em sequência (acorde de vitória)
        const notas = [
            { freq: 880, t: 0,    dur: 0.13 },  // A5
            { freq: 1175, t: 0.10, dur: 0.13 }, // D6
            { freq: 1760, t: 0.20, dur: 0.30 }, // A6
        ];
        notas.forEach(n => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(n.freq, now + n.t);
            gain.gain.setValueAtTime(0, now + n.t);
            gain.gain.linearRampToValueAtTime(0.18, now + n.t + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.dur);
            osc.connect(gain).connect(ctx.destination);
            osc.start(now + n.t);
            osc.stop(now + n.t + n.dur + 0.02);
        });
    } catch {}
}

// Confete CSS-puro (cria N divs que caem)
function fireConfetti() {
    const layer = document.getElementById('confetti');
    if (!layer) return;
    layer.innerHTML = '';
    const colors = ['#00f5a0', '#ff2e63', '#4d8aff', '#ffcc4d', '#b14dff', '#ff3b5c'];
    const N = 80;
    for (let i = 0; i < N; i++) {
        const p = document.createElement('div');
        p.className = 'confetti-piece';
        const x = Math.random() * 100;
        const delay = Math.random() * 0.5;
        const dur = 2 + Math.random() * 1.5;
        const rot = Math.random() * 720 - 360;
        const drift = (Math.random() - 0.5) * 200;
        p.style.left = x + 'vw';
        p.style.top = '-20px';
        p.style.background = colors[i % colors.length];
        p.style.transform = 'rotate(' + (Math.random() * 360) + 'deg)';
        p.style.animation = `confetti-fall ${dur}s ${delay}s cubic-bezier(0.55, 0.08, 0.6, 0.95) forwards`;
        p.style.setProperty('--drift', drift + 'px');
        p.style.setProperty('--rot', rot + 'deg');
        layer.appendChild(p);
    }
    // injeta keyframes uma vez
    if (!document.getElementById('confetti-keyframes')) {
        const style = document.createElement('style');
        style.id = 'confetti-keyframes';
        style.textContent = `
            @keyframes confetti-fall {
                0%   { transform: translate(0, 0) rotate(0deg); opacity: 1; }
                100% { transform: translate(var(--drift), 105vh) rotate(var(--rot)); opacity: 0; }
            }`;
        document.head.appendChild(style);
    }
    setTimeout(() => { layer.innerHTML = ''; }, 5000);
}

/* ========== PERIOD FILTER ========== */
function inPeriod(dateStr, period) {
    if (!dateStr || period === 'all') return true;
    const d = new Date(dateStr);
    const now = new Date();
    if (period === 'today') return d.toDateString() === now.toDateString();
    if (period === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    if (period === 'last-month') {
        const ref = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return d.getMonth() === ref.getMonth() && d.getFullYear() === ref.getFullYear();
    }
    if (period === 'last-7')  return (now - d) / 86400000 <= 7;
    if (period === 'last-30') return (now - d) / 86400000 <= 30;
    return true;
}
function periodoAtual() { return document.getElementById('period-filter').value; }
function eventosFiltrados() { return state.eventos.filter(e => inPeriod(e.created_at, periodoAtual())); }

/* ========== TABS ========== */
function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === `tab-${tab}`));
    const titles = {
        dashboard: ['Visão Geral', 'Cliques, vendas e conversão por vídeo', 'DASHBOARD'],
        vendas:    ['Vendas', 'Cada venda com canal, valor e moeda', 'VENDAS'],
        videos:    ['Top Canais', 'Ranking de canais que mais vendem (todo o tempo)', 'TOP CANAIS'],
        temas:     ['Top Temas', 'Onde focar produção de conteúdo', 'TOP TEMAS'],
        pessoas:   ['Pessoas', 'Quem opera os canais', 'PESSOAS'],
        redes:     ['Redes', 'Grupos de canais por pessoa', 'REDES'],
        canais:    ['Canais', 'Cada canal com seu link Hotmart fixo', 'CANAIS'],
        produtos:  ['Produtos Hotmart', 'Cadastro avulso de produtos (opcional)', 'PRODUTOS'],
        eventos:   ['Eventos em tempo real', 'Feed de tudo que acontece', 'EVENTOS'],
        config:    ['Configurações', 'Postback e YouTube API', 'CONFIG'],
    };
    document.getElementById('page-title').textContent = titles[tab][0];
    document.getElementById('page-sub').textContent = titles[tab][1];
    document.getElementById('bc-current').textContent = titles[tab][2];
    if (tab === 'canais') refreshGeneratorSelects();
    if (tab === 'vendas') refreshVendasFilters();
    if (tab === 'config') fillConfigForm();
    renderAll();
}

/* ========== RENDER ========== */
function renderAll() {
    renderWorkspaceSelector();
    renderSidebar();
    if (currentTab === 'dashboard') renderDashboard();
    else if (currentTab === 'vendas') renderVendas();
    else if (currentTab === 'videos') renderVideos();
    else if (currentTab === 'temas') renderTemas();
    else if (currentTab === 'pessoas') renderPessoas();
    else if (currentTab === 'redes') renderRedes();
    else if (currentTab === 'canais') renderCanais();
    else if (currentTab === 'produtos') renderProdutos();
    else if (currentTab === 'eventos') renderEventos();
    else if (currentTab === 'config') renderConfig();
}

function renderWorkspaceSelector() {
    const ws = currentWorkspace();
    if (ws) {
        document.getElementById('ws-name').textContent = ws.name;
        document.getElementById('ws-role').textContent = (myRole() || '—').toUpperCase();
    }
    const dd = document.getElementById('ws-dropdown');
    dd.innerHTML = state.workspaces.map(w => `<button class="ws-option ${w.id === state.currentWorkspaceId ? 'active' : ''}" onclick="window.switchWs('${w.id}')"><div>${escapeHtml(w.name)}</div></button>`).join('');
}
window.switchWs = async (id) => {
    state.currentWorkspaceId = id;
    document.getElementById('ws-dropdown').hidden = true;
    await loadAllData();
    renderAll();
    setupRealtime();
};

function renderSidebar() {
    const hoje = state.eventos.filter(e => new Date(e.created_at).toDateString() === new Date().toDateString());
    const vendasHoje = hoje.filter(e => e.event_type === 'PURCHASE_APPROVED');
    const porMoeda = receitaPorMoeda(hoje);
    document.getElementById('sidebar-receita').textContent = fmtReceitaMix(porMoeda);
    document.getElementById('sidebar-vendas').textContent = `${vendasHoje.length} venda${vendasHoje.length !== 1 ? 's' : ''} hoje`;
}

/* ========== DASHBOARD ========== */
function renderDashboard() {
    const eventos = eventosFiltrados();
    const cliques = eventos.filter(e => e.event_type === 'CLICK').length;
    const vendas = eventos.filter(e => e.event_type === 'PURCHASE_APPROVED');

    // HOJE — sempre os eventos do dia atual independente do filtro de período
    const hoje = state.eventos.filter(e => new Date(e.created_at).toDateString() === new Date().toDateString());
    const vendasHoje = hoje.filter(e => e.event_type === 'PURCHASE_APPROVED');
    const receitaHoje = receitaPorMoeda(hoje);

    document.getElementById('kpi-vendas-hoje').textContent = fmtNum(vendasHoje.length);
    document.getElementById('kpi-vendas-hoje-meta').textContent = vendasHoje.length
        ? `de ${vendas.length} no período`
        : 'sem vendas ainda';
    const receitaHojeEl = document.getElementById('kpi-receita-hoje');
    receitaHojeEl.textContent = fmtReceitaMix(receitaHoje);
    receitaHojeEl.style.fontSize = Object.keys(receitaHoje).length > 1 ? '15px' : '22px';

    // CLIQUES e TICKET — no período selecionado
    const ticketPorMoeda = {};
    const totalPorMoeda = receitaPorMoeda(eventos);
    Object.entries(totalPorMoeda).forEach(([m, total]) => {
        const n = vendas.filter(v => (v.moeda || 'BRL').toUpperCase() === m).length;
        if (n > 0) ticketPorMoeda[m] = total / n;
    });
    document.getElementById('kpi-cliques').textContent = fmtNum(cliques);
    document.getElementById('kpi-cliques-meta').textContent = vendas.length > 0 && cliques > 0
        ? `conv. ${(vendas.length / cliques * 100).toFixed(2)}%`
        : 'no período';
    const ticketEl = document.getElementById('kpi-ticket');
    ticketEl.textContent = fmtReceitaMix(ticketPorMoeda);
    ticketEl.style.fontSize = Object.keys(ticketPorMoeda).length > 1 ? '15px' : '22px';
    document.getElementById('kpi-ticket-meta').textContent = vendas.length ? 'por venda aprovada' : 'sem vendas no período';

    renderDashboardPessoas(eventos);
    renderDashboardTopCanais(eventos);
    renderChartTime(eventos);
    renderTopCanaisDetalhado(eventos);
}

function renderTopCanaisDetalhado(eventos) {
    const grid = document.getElementById('canal-grid-dashboard');
    if (!grid) return;
    const byCanal = {};
    eventos.filter(e => e.event_type === 'PURCHASE_APPROVED').forEach(e => {
        if (!e.canal_id) return;
        if (!byCanal[e.canal_id]) byCanal[e.canal_id] = { vendas: 0, cliques: 0, porMoeda: {} };
        byCanal[e.canal_id].vendas++;
        const m = (e.moeda || 'BRL').toUpperCase();
        byCanal[e.canal_id].porMoeda[m] = (byCanal[e.canal_id].porMoeda[m] || 0) + Number(e.valor || 0);
    });
    eventos.filter(e => e.event_type === 'CLICK' && e.canal_id).forEach(e => {
        if (!byCanal[e.canal_id]) byCanal[e.canal_id] = { vendas: 0, cliques: 0, porMoeda: {} };
        byCanal[e.canal_id].cliques++;
    });

    const items = Object.entries(byCanal).map(([cid, v]) => {
        const c = state.canais.find(x => x.id === cid);
        const rede = c ? state.redes.find(r => r.id === c.rede_id) : null;
        const pessoa = rede ? state.pessoas.find(p => p.id === rede.pessoa_id) : null;
        const total = Object.values(v.porMoeda).reduce((a, b) => a + b, 0);
        return { canal: c, rede, pessoa, vendas: v.vendas, cliques: v.cliques, porMoeda: v.porMoeda, totalGeral: total };
    }).filter(x => x.canal).sort((a, b) => b.totalGeral - a.totalGeral || b.vendas - a.vendas);

    if (!items.length) {
        grid.innerHTML = '<div class="empty">Nenhum canal vendeu no período. Quando começar a chegar venda, aparece aqui.</div>';
        return;
    }

    grid.innerHTML = items.map((it, idx) => {
        const topCls = idx === 0 ? 'top1' : idx === 1 ? 'top2' : idx === 2 ? 'top3' : '';
        const conv = it.cliques > 0 ? ` · ${(it.vendas / it.cliques * 100).toFixed(1)}%` : '';
        return `
            <div class="canal-card ${topCls}">
                <div class="rank-badge">#${idx + 1}</div>
                <div class="canal-head">
                    <div class="canal-name">${escapeHtml(it.canal.nome)}</div>
                    <div class="canal-meta">
                        ${it.canal.pais ? `<span class="flag">${escapeHtml(it.canal.pais)}</span>` : ''}
                        <span>${escapeHtml(it.pessoa?.nome || '—')}</span>
                        <span class="dot"></span>
                        <span>${escapeHtml(it.rede?.nome || '—')}</span>
                    </div>
                </div>
                <div class="canal-stats">
                    <div class="canal-stat">
                        <div class="canal-stat-label">Vendas</div>
                        <div class="canal-stat-value vendas">${it.vendas}</div>
                        <div style="font-size:10px;color:var(--text-3);font-family:'JetBrains Mono'">${it.cliques} cliques${conv}</div>
                    </div>
                    <div class="canal-stat" style="align-items:flex-end">
                        <div class="canal-stat-label">Receita</div>
                        <div class="canal-stat-value receita">${fmtReceitaMix(it.porMoeda)}</div>
                    </div>
                </div>
                <div class="canal-links">
                    ${it.canal.youtube_url ? `<a class="canal-link yt" href="${escapeHtml(it.canal.youtube_url)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"/></svg>YouTube</a>` : ''}
                    ${it.canal.hotmart_url ? `<a class="canal-link hot" href="${escapeHtml(it.canal.hotmart_url)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>Link Hotmart</a>` : ''}
                </div>
            </div>`;
    }).join('');
}

function renderDashboardPessoas(eventos) {
    const grid = document.getElementById('dash-pessoas');
    if (!state.pessoas.length) {
        grid.innerHTML = '<div class="empty">Cadastre pessoas na aba <strong>Pessoas</strong> pra ver a performance de cada uma aqui.</div>';
        return;
    }
    // ordem alfabética por nome
    const dados = state.pessoas.map(p => {
        const eventosP = eventos.filter(e => e.pessoa_id === p.id);
        const vendasP = eventosP.filter(e => e.event_type === 'PURCHASE_APPROVED');
        const porMoeda = receitaPorMoeda(eventosP);
        const totalGeral = Object.values(porMoeda).reduce((a, b) => a + b, 0);
        return { pessoa: p, vendas: vendasP.length, porMoeda, totalGeral };
    }).sort((a, b) => (a.pessoa.nome || '').localeCompare(b.pessoa.nome || '', 'pt-BR', { sensitivity: 'base' }));

    grid.innerHTML = dados.map(d => {
        const initial = (d.pessoa.nome || '?').charAt(0).toUpperCase();
        const brl = d.porMoeda.BRL || 0;
        const usd = d.porMoeda.USD || 0;
        const outras = Object.entries(d.porMoeda).filter(([m]) => m !== 'BRL' && m !== 'USD');
        return `
            <div class="pessoa-card">
                <div class="pessoa-head">
                    <div class="pessoa-avatar">${escapeHtml(initial)}</div>
                    <div style="flex:1;margin-left:10px">
                        <div class="pessoa-name">${escapeHtml(d.pessoa.nome)}</div>
                        <div class="pessoa-slug">${escapeHtml(d.pessoa.slug)}</div>
                    </div>
                </div>
                <div class="pessoa-stats">
                    <span class="pessoa-vendas">${d.vendas}</span>
                    <span class="pessoa-vendas-label">vendas</span>
                </div>
                <div class="pessoa-receita-split">
                    <div class="pessoa-receita-line">
                        <span class="label">BRL</span>
                        <span class="value ${brl > 0 ? 'has' : 'zero'}">${fmtMoeda(brl, 'BRL')}</span>
                    </div>
                    <div class="pessoa-receita-line">
                        <span class="label">USD</span>
                        <span class="value ${usd > 0 ? 'has' : 'zero'}">${fmtMoeda(usd, 'USD')}</span>
                    </div>
                    ${outras.map(([m, v]) => `
                        <div class="pessoa-receita-line">
                            <span class="label">${escapeHtml(m)}</span>
                            <span class="value has">${fmtMoeda(v, m)}</span>
                        </div>`).join('')}
                </div>
            </div>`;
    }).join('');
}

function renderDashboardTopCanais(eventos) {
    const byCanal = {};
    eventos.filter(e => e.event_type === 'PURCHASE_APPROVED').forEach(e => {
        if (!e.canal_id) return;
        if (!byCanal[e.canal_id]) byCanal[e.canal_id] = { vendas: 0, porMoeda: {} };
        byCanal[e.canal_id].vendas++;
        const m = (e.moeda || 'BRL').toUpperCase();
        byCanal[e.canal_id].porMoeda[m] = (byCanal[e.canal_id].porMoeda[m] || 0) + Number(e.valor || 0);
    });
    const items = Object.entries(byCanal).map(([cid, v]) => {
        const c = state.canais.find(x => x.id === cid);
        const rede = c ? state.redes.find(r => r.id === c.rede_id) : null;
        const pessoa = rede ? state.pessoas.find(p => p.id === rede.pessoa_id) : null;
        const total = Object.values(v.porMoeda).reduce((a, b) => a + b, 0);
        return { canal: c, rede, pessoa, vendas: v.vendas, porMoeda: v.porMoeda, totalGeral: total };
    }).filter(x => x.canal).sort((a, b) => b.totalGeral - a.totalGeral || b.vendas - a.vendas).slice(0, 5);

    const tbody = document.querySelector('#dash-top-canais tbody');
    if (!items.length) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Sem vendas no período. Quando começar a vender, o ranking aparece aqui.</td></tr>`;
        return;
    }
    tbody.innerHTML = items.map((it, idx) => `
        <tr>
            <td><strong style="color:var(--accent)">#${idx + 1}</strong></td>
            <td>
                <div style="font-weight:600">${escapeHtml(it.canal.nome)}</div>
                ${it.canal.pais ? `<div style="font-size:10px;color:var(--text-3);font-family:'JetBrains Mono'">${escapeHtml(it.canal.pais)}</div>` : ''}
            </td>
            <td>
                <div>${escapeHtml(it.pessoa?.nome || '—')}</div>
                <div style="font-size:10px;color:var(--text-3)">${escapeHtml(it.rede?.nome || '—')}</div>
            </td>
            <td class="right mono amount-pos">${it.vendas}</td>
            <td class="right mono amount-pos" style="font-size:12px">${fmtReceitaMix(it.porMoeda)}</td>
        </tr>`).join('');
}

function renderChartTime(eventos) {
    const ctx = document.getElementById('chart-time');
    if (!ctx) return;
    if (charts.time) charts.time.destroy();

    const period = periodoAtual();
    const days = period === 'today' ? 1 : period === 'last-7' ? 7 : period === 'last-30' ? 30 : 30;
    const labels = [];
    const buckets = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        d.setHours(0, 0, 0, 0);
        labels.push(d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
        buckets.push({ key: d.toDateString(), receita: 0, vendas: 0 });
    }
    eventos.filter(e => e.event_type === 'PURCHASE_APPROVED').forEach(e => {
        const d = new Date(e.created_at).toDateString();
        const b = buckets.find(x => x.key === d);
        if (b) { b.receita += Number(e.valor || 0); b.vendas += 1; }
    });

    const c = ctx.getContext('2d');
    const grad = c.createLinearGradient(0, 0, 0, 280);
    grad.addColorStop(0, 'rgba(0, 245, 160, 0.5)');
    grad.addColorStop(1, 'rgba(0, 245, 160, 0)');

    charts.time = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets: [{ data: buckets.map(b => b.receita), borderColor: '#00f5a0', backgroundColor: grad, fill: true, tension: 0.35, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#00f5a0' }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(12,14,22,0.95)', titleColor: '#fff', bodyColor: '#e8ecf3', borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1, padding: 12, callbacks: { label: (ctx) => `${fmtBRL(ctx.parsed.y)} · ${buckets[ctx.dataIndex].vendas} vendas` } } },
            scales: {
                x: { grid: { display: false }, ticks: { color: '#6b7388', font: { family: 'JetBrains Mono', size: 10 } }, border: { display: false } },
                y: { grid: { color: 'rgba(255,255,255,0.04)' }, border: { display: false }, ticks: { color: '#6b7388', font: { family: 'JetBrains Mono', size: 10 }, callback: v => v >= 1000 ? 'R$ ' + (v/1000).toFixed(1) + 'k' : 'R$ ' + v } }
            }
        }
    });
}

function renderChartCanais(eventos) {
    const ctx = document.getElementById('chart-canais');
    if (!ctx) return;
    if (charts.canais) charts.canais.destroy();

    const byCanal = {};
    eventos.filter(e => e.event_type === 'PURCHASE_APPROVED').forEach(e => {
        const cid = e.canal_id || '_sem';
        if (!byCanal[cid]) byCanal[cid] = 0;
        byCanal[cid] += Number(e.valor || 0);
    });
    const items = Object.entries(byCanal).map(([cid, v]) => {
        const c = state.canais.find(x => x.id === cid);
        return { nome: c?.nome || 'Sem canal', receita: v };
    }).sort((a, b) => b.receita - a.receita).slice(0, 5);

    if (!items.length) { ctx.getContext('2d').clearRect(0, 0, ctx.width, ctx.height); return; }

    charts.canais = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: items.map(i => i.nome), datasets: [{ data: items.map(i => i.receita), backgroundColor: ['#00f5a0', '#4d8aff', '#b14dff', '#ffcc4d', '#ff3b5c'], borderColor: 'rgba(0,0,0,0)', borderWidth: 3, hoverOffset: 8 }] },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '70%',
            plugins: {
                legend: { position: 'bottom', labels: { color: '#a8b0c2', font: { family: 'Inter', size: 11, weight: '500' }, usePointStyle: true, pointStyle: 'circle', padding: 12, boxWidth: 8 } },
                tooltip: { backgroundColor: 'rgba(12,14,22,0.95)', titleColor: '#fff', bodyColor: '#e8ecf3', callbacks: { label: (c) => `${c.label}: ${fmtBRL(c.parsed)}` } }
            }
        }
    });
}

// Agrupa eventos por vídeo (uuid), separando receita por moeda.
// Importante: NÃO agrupa por src puro porque o mesmo src=1 pode existir em vários canais.
function statsByVideo(eventos) {
    const map = {};
    eventos.forEach(e => {
        // chave: prefere video_id (uuid); se não tiver, usa canal_id + src pra não fundir entre canais
        const key = e.video_id || (e.canal_id && e.src ? `${e.canal_id}::${e.src}` : null);
        if (!key) return;
        if (!map[key]) map[key] = { key, video_id: e.video_id, canal_id: e.canal_id, src: e.src, cliques: 0, vendas: 0, porMoeda: {} };
        const s = map[key];
        if (e.event_type === 'CLICK') s.cliques++;
        if (e.event_type === 'PURCHASE_APPROVED') {
            s.vendas++;
            const m = (e.moeda || 'BRL').toUpperCase();
            s.porMoeda[m] = (s.porMoeda[m] || 0) + Number(e.valor || 0);
        }
    });
    return Object.values(map);
}

function statsBySrc(eventos) { return statsByVideo(eventos); }  // alias retrocompat

function renderTopVideosDashboard(eventos) {
    const stats = statsByVideo(eventos)
        .map(s => ({ ...s, totalGeral: Object.values(s.porMoeda).reduce((a, b) => a + b, 0) }))
        .sort((a, b) => b.totalGeral - a.totalGeral || b.vendas - a.vendas)
        .slice(0, 8);
    const grid = document.getElementById('video-grid-dashboard');
    if (!stats.length) { grid.innerHTML = '<div class="empty">Nenhuma venda registrada no período. Configure o Postback e cadastre links pra começar.</div>'; return; }
    grid.innerHTML = stats.map((s, i) => videoCard(s, i + 1)).join('');
}

function videoCard(stat, rank) {
    const video = state.videos.find(v => v.id === stat.video_id) || state.videos.find(v => v.canal_id === stat.canal_id && v.src === stat.src);
    const canal = state.canais.find(c => c.id === (video?.canal_id || stat.canal_id));
    const rede = canal ? state.redes.find(r => r.id === canal.rede_id) : null;
    const pessoa = rede ? state.pessoas.find(p => p.id === rede.pessoa_id) : null;
    const titulo = video?.titulo || `Vídeo ${stat.src || ''}` || '(sem título)';
    const thumb = video?.thumb_url;
    const views = video?.view_count;
    const ytUrl = video?.youtube_url || (video?.video_id ? `https://www.youtube.com/watch?v=${video.video_id}` : null);
    return `
        <a class="video-card" ${ytUrl ? `href="${escapeHtml(ytUrl)}" target="_blank" rel="noopener"` : ''}>
            <div class="thumb">
                ${thumb ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy">` : `<div class="thumb-fallback">sem thumb</div>`}
                <div class="thumb-rank">#${rank}</div>
                ${views ? `<div class="thumb-views">${fmtViews(views)} views</div>` : ''}
            </div>
            <div class="body">
                <div class="title">${escapeHtml(titulo)}</div>
                <div class="meta">
                    <span>${escapeHtml(pessoa?.nome || canal?.nome || 'Sem pessoa')}</span>
                    ${canal?.nome && pessoa ? `<span class="dot"></span><span>${escapeHtml(canal.nome)}</span>` : ''}
                </div>
                <div class="stats">
                    <span class="vendas">${stat.vendas} venda${stat.vendas !== 1 ? 's' : ''} · ${stat.cliques} cliques</span>
                    <span class="receita" style="font-size:13px">${fmtReceitaMix(stat.porMoeda)}</span>
                </div>
            </div>
        </a>`;
}

/* ========== TOP CANAIS (all time, all people) ========== */
function renderVideos() {
    const q = (document.getElementById('search-videos').value || '').toLowerCase().trim();
    const grid = document.getElementById('top-canais-grid');
    if (!grid) return;

    // ALL TIME — agrega TODOS os eventos por canal_id
    const byCanal = {};
    state.eventos.forEach(e => {
        if (!e.canal_id) return;
        if (!byCanal[e.canal_id]) byCanal[e.canal_id] = { vendas: 0, cliques: 0, porMoeda: {} };
        if (e.event_type === 'PURCHASE_APPROVED') {
            byCanal[e.canal_id].vendas++;
            const m = (e.moeda || 'BRL').toUpperCase();
            byCanal[e.canal_id].porMoeda[m] = (byCanal[e.canal_id].porMoeda[m] || 0) + Number(e.valor || 0);
        }
        if (e.event_type === 'CLICK') byCanal[e.canal_id].cliques++;
    });

    // inclui canais sem evento ainda também (pra mostrar o catálogo todo)
    let items = state.canais.map(c => {
        const stats = byCanal[c.id] || { vendas: 0, cliques: 0, porMoeda: {} };
        const rede = state.redes.find(r => r.id === c.rede_id);
        const pessoa = rede ? state.pessoas.find(p => p.id === rede.pessoa_id) : null;
        const totalGeral = Object.values(stats.porMoeda).reduce((a, b) => a + b, 0);
        return { canal: c, rede, pessoa, ...stats, totalGeral };
    });

    if (q) {
        items = items.filter(it =>
            (it.canal.nome || '').toLowerCase().includes(q) ||
            (it.canal.pais || '').toLowerCase().includes(q) ||
            (it.pessoa?.nome || '').toLowerCase().includes(q) ||
            (it.rede?.nome || '').toLowerCase().includes(q)
        );
    }

    // ordena por receita total descrescente
    items.sort((a, b) => b.totalGeral - a.totalGeral || b.vendas - a.vendas);

    if (!items.length) {
        grid.innerHTML = '<div class="empty">Nenhum canal cadastrado. Crie pessoas, redes e canais primeiro.</div>';
        return;
    }

    grid.innerHTML = items.map((it, idx) => {
        const topCls = idx === 0 && it.vendas > 0 ? 'top1' : idx === 1 && it.vendas > 0 ? 'top2' : idx === 2 && it.vendas > 0 ? 'top3' : '';
        const conv = it.cliques > 0 ? ` · ${(it.vendas / it.cliques * 100).toFixed(1)}%` : '';
        const semVenda = it.vendas === 0;
        return `
            <div class="canal-card ${topCls}" ${semVenda ? 'style="opacity:0.55"' : ''}>
                <div class="rank-badge">#${idx + 1}</div>
                <div class="canal-head">
                    <div class="canal-name">${escapeHtml(it.canal.nome)}</div>
                    <div class="canal-meta">
                        ${it.canal.pais ? `<span class="flag">${escapeHtml(it.canal.pais)}</span>` : ''}
                        <span>${escapeHtml(it.pessoa?.nome || '—')}</span>
                        <span class="dot"></span>
                        <span>${escapeHtml(it.rede?.nome || '—')}</span>
                    </div>
                </div>
                <div class="canal-stats">
                    <div class="canal-stat">
                        <div class="canal-stat-label">Vendas</div>
                        <div class="canal-stat-value vendas">${it.vendas}</div>
                        <div style="font-size:10px;color:var(--text-3);font-family:'JetBrains Mono'">${it.cliques} cliques${conv}</div>
                    </div>
                    <div class="canal-stat" style="align-items:flex-end">
                        <div class="canal-stat-label">Receita Total</div>
                        <div class="canal-stat-value receita">${it.vendas > 0 ? fmtReceitaMix(it.porMoeda) : '—'}</div>
                    </div>
                </div>
                <div class="canal-links">
                    ${it.canal.youtube_url ? `<a class="canal-link yt" href="${escapeHtml(it.canal.youtube_url)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"/></svg>YouTube</a>` : ''}
                    ${it.canal.hotmart_url ? `<a class="canal-link hot" href="${escapeHtml(it.canal.hotmart_url)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>Link Hotmart</a>` : ''}
                </div>
            </div>`;
    }).join('');
}

/* ========== TOP TEMAS ========== */
function renderTemas() {
    const eventos = eventosFiltrados();
    const byTema = {};
    state.videos.forEach(v => {
        const canal = state.canais.find(c => c.id === v.canal_id);
        const tema = v.tema || canal?.tema || 'Sem tema';
        if (!byTema[tema]) byTema[tema] = { tema, videos: new Set(), canais: new Set(), vendas: 0, receita: 0 };
        byTema[tema].videos.add(v.id);
        if (v.canal_id) byTema[tema].canais.add(v.canal_id);
    });
    eventos.forEach(e => {
        if (e.event_type !== 'PURCHASE_APPROVED') return;
        const v = state.videos.find(x => x.id === e.video_id || x.src === e.src);
        const c = state.canais.find(x => x.id === (v?.canal_id || e.canal_id));
        const tema = v?.tema || c?.tema || 'Sem tema';
        if (!byTema[tema]) byTema[tema] = { tema, videos: new Set(), canais: new Set(), vendas: 0, receita: 0 };
        byTema[tema].vendas++;
        byTema[tema].receita += Number(e.valor || 0);
        if (v) byTema[tema].videos.add(v.id);
        if (v?.canal_id || e.canal_id) byTema[tema].canais.add(v?.canal_id || e.canal_id);
    });
    const items = Object.values(byTema).map(x => ({
        tema: x.tema, canais: x.canais.size, videos: x.videos.size, vendas: x.vendas, receita: x.receita,
        receitaPorVideo: x.videos.size > 0 ? x.receita / x.videos.size : 0,
    })).sort((a, b) => b.receita - a.receita);

    // Chart
    const ctx = document.getElementById('chart-temas');
    if (charts.temas) charts.temas.destroy();
    if (items.length > 0) {
        const c = ctx.getContext('2d');
        const grad = c.createLinearGradient(0, 0, 0, 320);
        grad.addColorStop(0, 'rgba(255, 46, 99, 0.9)');
        grad.addColorStop(1, 'rgba(255, 46, 99, 0.3)');
        const grad2 = c.createLinearGradient(0, 0, 0, 320);
        grad2.addColorStop(0, 'rgba(0, 245, 160, 0.9)');
        grad2.addColorStop(1, 'rgba(0, 245, 160, 0.3)');
        charts.temas = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: items.slice(0, 10).map(i => i.tema),
                datasets: [
                    { label: 'Receita total', data: items.slice(0, 10).map(i => i.receita), backgroundColor: grad, borderRadius: 8, barThickness: 22 },
                    { label: 'Receita / vídeo', data: items.slice(0, 10).map(i => i.receitaPorVideo), backgroundColor: grad2, borderRadius: 8, barThickness: 22 },
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'top', labels: { color: '#a8b0c2', font: { family: 'Inter', size: 11 }, usePointStyle: true, pointStyle: 'circle', padding: 12, boxWidth: 8 } }, tooltip: { backgroundColor: 'rgba(12,14,22,0.95)', callbacks: { label: (c) => `${c.dataset.label}: ${fmtBRL(c.parsed.y)}` } } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#a8b0c2', font: { family: 'Inter', size: 11 } } },
                    y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#6b7388', font: { family: 'JetBrains Mono', size: 10 }, callback: v => v >= 1000 ? 'R$ ' + (v/1000).toFixed(1) + 'k' : 'R$ ' + v } }
                }
            }
        });
    }

    // Tabela
    const tbody = document.querySelector('#temas-table tbody');
    if (!items.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="6">Cadastre canais com tema ou marque temas nos vídeos pra ver dados aqui.</td></tr>`; return; }
    tbody.innerHTML = items.map(i => `
        <tr>
            <td><strong>${escapeHtml(i.tema)}</strong></td>
            <td class="right mono">${i.canais}</td>
            <td class="right mono">${i.videos}</td>
            <td class="right mono amount-pos">${i.vendas}</td>
            <td class="right mono amount-pos">${fmtBRL(i.receita)}</td>
            <td class="right mono">${fmtBRL(i.receitaPorVideo)}</td>
        </tr>`).join('');
}

/* ========== PESSOAS ========== */
function renderPessoas() {
    const eventos = eventosFiltrados();
    const tbody = document.querySelector('#pessoas-table tbody');
    if (!state.pessoas.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="7">Nenhuma pessoa. Crie um operador (você, funcionários...) pra começar.</td></tr>`; return; }
    tbody.innerHTML = state.pessoas.map(p => {
        const redes = state.redes.filter(r => r.pessoa_id === p.id).length;
        const canais = state.canais.filter(c => state.redes.find(r => r.id === c.rede_id && r.pessoa_id === p.id)).length;
        const eventosPessoa = eventos.filter(e => e.pessoa_id === p.id);
        const vendas = eventosPessoa.filter(e => e.event_type === 'PURCHASE_APPROVED');
        const porMoeda = receitaPorMoeda(eventosPessoa);
        return `
            <tr>
                <td><strong>${escapeHtml(p.nome)}</strong></td>
                <td class="mono">${escapeHtml(p.slug)}</td>
                <td class="right mono">${redes}</td>
                <td class="right mono">${canais}</td>
                <td class="right mono amount-pos">${vendas.length}</td>
                <td class="right mono amount-pos" style="font-size:12px">${fmtReceitaMix(porMoeda)}</td>
                <td class="right">
                    ${canWrite() ? `
                        <button class="btn-icon" onclick="openModal('pessoa','${p.id}')" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                        <button class="btn-icon danger" onclick="removeItem('pessoa','${p.id}')" title="Remover"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/></svg></button>
                    ` : ''}
                </td>
            </tr>`;
    }).join('');
}

/* ========== REDES ========== */
function renderRedes() {
    const eventos = eventosFiltrados();
    const tbody = document.querySelector('#redes-table tbody');
    if (!state.redes.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="7">Nenhuma rede. Crie pelo menos uma pessoa antes, depois cria as redes dela.</td></tr>`; return; }
    tbody.innerHTML = state.redes.map(r => {
        const pessoa = state.pessoas.find(p => p.id === r.pessoa_id);
        const canais = state.canais.filter(c => c.rede_id === r.id).length;
        const eventosRede = eventos.filter(e => e.rede_id === r.id);
        const vendas = eventosRede.filter(e => e.event_type === 'PURCHASE_APPROVED');
        const porMoeda = receitaPorMoeda(eventosRede);
        return `
            <tr>
                <td><strong>${escapeHtml(r.nome)}</strong> <span style="font-size:11px;color:var(--text-3);font-family:'JetBrains Mono'">${escapeHtml(r.slug)}</span></td>
                <td>${escapeHtml(pessoa?.nome || '—')}</td>
                <td>${escapeHtml(r.tema || '—')}</td>
                <td class="right mono">${canais}</td>
                <td class="right mono amount-pos">${vendas.length}</td>
                <td class="right mono amount-pos" style="font-size:12px">${fmtReceitaMix(porMoeda)}</td>
                <td class="right">
                    ${canWrite() ? `
                        <button class="btn-icon" onclick="openModal('rede','${r.id}')" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                        <button class="btn-icon danger" onclick="removeItem('rede','${r.id}')" title="Remover"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/></svg></button>
                    ` : ''}
                </td>
            </tr>`;
    }).join('');
}

/* ========== CANAIS ========== */
function renderCanais() {
    const q = (document.getElementById('search-canais').value || '').toLowerCase().trim();
    let canais = state.canais;
    if (q) canais = canais.filter(c => (c.nome + (c.slug || '') + (c.tema || '') + (c.hotmart_url || '') + (c.pais || '')).toLowerCase().includes(q));

    const eventos = eventosFiltrados();
    const stats = {};
    canais.forEach(c => stats[c.id] = { vendas: 0, porMoeda: {}, videos: 0 });
    eventos.forEach(e => {
        if (e.event_type !== 'PURCHASE_APPROVED') return;
        if (!e.canal_id || !stats[e.canal_id]) return;
        stats[e.canal_id].vendas++;
        const m = (e.moeda || 'BRL').toUpperCase();
        stats[e.canal_id].porMoeda[m] = (stats[e.canal_id].porMoeda[m] || 0) + Number(e.valor || 0);
    });
    state.videos.forEach(v => { if (v.canal_id && stats[v.canal_id]) stats[v.canal_id].videos++; });

    const tbody = document.querySelector('#canais-table tbody');
    if (!canais.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="8">Nenhum canal. Crie um pra começar (precisa de pessoa e rede antes).</td></tr>`; }
    else {
        tbody.innerHTML = canais.map(c => {
            const s = stats[c.id] || { vendas: 0, porMoeda: {}, videos: 0 };
            const rede = state.redes.find(r => r.id === c.rede_id);
            const pessoa = rede ? state.pessoas.find(p => p.id === rede.pessoa_id) : null;
            return `
                <tr>
                    <td>
                        <div style="font-weight:600">${escapeHtml(c.nome)}</div>
                        ${c.youtube_url ? `<a href="${escapeHtml(c.youtube_url)}" target="_blank" rel="noopener" style="font-size:11px;color:var(--blue)">YouTube ↗</a>` : ''}
                    </td>
                    <td>
                        <div>${escapeHtml(rede?.nome || '—')}</div>
                        <div style="font-size:11px;color:var(--text-3)">${escapeHtml(pessoa?.nome || '—')}</div>
                    </td>
                    <td class="mono">${escapeHtml(c.pais || '—')}</td>
                    <td>
                        ${c.hotmart_url ? `<a href="${escapeHtml(c.hotmart_url)}" target="_blank" rel="noopener" class="mono" style="font-size:11px">${escapeHtml(c.hotmart_url.replace(/^https?:\/\//, ''))}</a>` : '<span style="color:var(--text-3);font-size:11px">— (cadastra)</span>'}
                        ${c.hotmart_id ? `<div style="font-size:10px;color:var(--text-3);font-family:'JetBrains Mono'">ID: ${escapeHtml(c.hotmart_id)}</div>` : ''}
                    </td>
                    <td class="right mono">${s.videos}</td>
                    <td class="right mono amount-pos">${s.vendas}</td>
                    <td class="right mono amount-pos" style="font-size:12px">${fmtReceitaMix(s.porMoeda)}</td>
                    <td class="right">
                        ${canWrite() ? `
                            <button class="btn-icon" onclick="openModal('canal','${c.id}')" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                            <button class="btn-icon danger" onclick="removeItem('canal','${c.id}')" title="Remover"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/></svg></button>
                        ` : ''}
                    </td>
                </tr>`;
        }).join('');
    }
    refreshGeneratorSelects();
}

/* ========== PRODUTOS ========== */
function renderProdutos() {
    const tbody = document.querySelector('#produtos-table tbody');
    if (!state.produtos.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Nenhum produto. Cadastre o link Hotmart pra usar no gerador.</td></tr>`; }
    else {
        tbody.innerHTML = state.produtos.map(p => `
            <tr>
                <td><strong>${escapeHtml(p.nome)}</strong></td>
                <td class="mono">${escapeHtml(p.hotmart_id || '—')}</td>
                <td><a href="${escapeHtml(p.hotmart_url)}" target="_blank" rel="noopener" class="mono" style="font-size:11px">${escapeHtml(p.hotmart_url)}</a></td>
                <td class="right mono">${p.preco ? `${p.moeda || 'BRL'} ${Number(p.preco).toFixed(2)}` : '—'}</td>
                <td class="right">
                    ${canWrite() ? `
                        <button class="btn-icon" onclick="openModal('produto','${p.id}')" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                        <button class="btn-icon danger" onclick="removeItem('produto','${p.id}')" title="Remover"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg></button>
                    ` : ''}
                </td>
            </tr>`).join('');
    }
    refreshGeneratorSelects();
}

function refreshGeneratorSelects() {
    const selCan = document.getElementById('gen-canal');
    if (!selCan) return;
    const canaisComLink = state.canais.filter(c => c.hotmart_url);
    if (canaisComLink.length === 0) {
        selCan.innerHTML = '<option value="">— Cadastre um canal com link Hotmart primeiro —</option>';
    } else {
        // agrupa por pessoa → rede pra organizar
        const groups = {};
        canaisComLink.forEach(c => {
            const rede = state.redes.find(r => r.id === c.rede_id);
            const pessoa = rede ? state.pessoas.find(p => p.id === rede.pessoa_id) : null;
            const key = pessoa ? `${pessoa.nome} → ${rede?.nome || 'sem rede'}` : 'Sem pessoa/rede';
            if (!groups[key]) groups[key] = [];
            groups[key].push(c);
        });
        const opts = ['<option value="">— Escolha um canal —</option>'];
        Object.entries(groups).forEach(([k, list]) => {
            opts.push(`<optgroup label="${escapeHtml(k)}">`);
            list.forEach(c => opts.push(`<option value="${c.id}">${escapeHtml(c.nome)}${c.pais ? ` (${escapeHtml(c.pais)})` : ''}</option>`));
            opts.push('</optgroup>');
        });
        selCan.innerHTML = opts.join('');
    }
    updateGenOutput();
}

function suggestNextNumber() {
    const can = state.canais.find(c => c.id === document.getElementById('gen-canal').value);
    if (!can) { toast('Escolha um canal primeiro', 'error'); return; }
    // próximo número = max(numero existente) + 1
    const nums = state.videos.filter(v => v.canal_id === can.id && v.numero != null).map(v => v.numero);
    const next = nums.length ? Math.max(...nums) + 1 : 1;
    document.getElementById('gen-numero').value = next;
    updateGenOutput();
}

function updateGenOutput() {
    const out = document.getElementById('gen-output');
    if (!out) return;
    const can = state.canais.find(c => c.id === document.getElementById('gen-canal').value);
    const numero = (document.getElementById('gen-numero').value || '').trim();
    const tipo = document.getElementById('gen-tipo').value;

    if (!can || !numero || !can.hotmart_url) { out.value = ''; return; }

    const src = numero;  // só o número, simples
    const wsId = state.currentWorkspaceId;
    const supabaseHost = (window.TRACKER_CONFIG.SUPABASE_URL || '').replace('https://', '').replace('.supabase.co', '');

    if (tipo === 'rastreado') {
        out.value = `https://${supabaseHost}.functions.supabase.co/tracker-click?ws=${wsId}&src=${encodeURIComponent(src)}&cid=${can.id}`;
    } else {
        try {
            const u = new URL(can.hotmart_url);
            u.searchParams.set('src', src);
            out.value = u.toString();
        } catch {
            out.value = can.hotmart_url + (can.hotmart_url.includes('?') ? '&' : '?') + 'src=' + encodeURIComponent(src);
        }
    }
}

/* ========== VENDAS ========== */
let vendasFilters = { pessoa: '', rede: '', canal: '', moeda: '', q: '' };

function refreshVendasFilters() {
    const selP = document.getElementById('vendas-filter-pessoa');
    const selR = document.getElementById('vendas-filter-rede');
    const selC = document.getElementById('vendas-filter-canal');
    const selM = document.getElementById('vendas-filter-moeda');
    if (!selP) return;

    const valP = selP.value, valR = selR.value, valC = selC.value, valM = selM.value;

    selP.innerHTML = '<option value="">Todas as pessoas</option>' + state.pessoas.map(p => `<option value="${p.id}" ${valP === p.id ? 'selected' : ''}>${escapeHtml(p.nome)}</option>`).join('');
    const redesFilt = vendasFilters.pessoa ? state.redes.filter(r => r.pessoa_id === vendasFilters.pessoa) : state.redes;
    selR.innerHTML = '<option value="">Todas as redes</option>' + redesFilt.map(r => `<option value="${r.id}" ${valR === r.id ? 'selected' : ''}>${escapeHtml(r.nome)}</option>`).join('');
    const canaisFilt = vendasFilters.rede ? state.canais.filter(c => c.rede_id === vendasFilters.rede) :
                       vendasFilters.pessoa ? state.canais.filter(c => { const r = state.redes.find(x => x.id === c.rede_id); return r && r.pessoa_id === vendasFilters.pessoa; }) :
                       state.canais;
    selC.innerHTML = '<option value="">Todos os canais</option>' + canaisFilt.map(c => `<option value="${c.id}" ${valC === c.id ? 'selected' : ''}>${escapeHtml(c.nome)}</option>`).join('');

    // moedas disponíveis vêm dos eventos
    const moedasSet = new Set(state.eventos.filter(e => e.event_type === 'PURCHASE_APPROVED').map(e => (e.moeda || 'BRL').toUpperCase()));
    selM.innerHTML = '<option value="">Todas moedas</option>' + Array.from(moedasSet).sort().map(m => `<option value="${m}" ${valM === m ? 'selected' : ''}>${m}</option>`).join('');
}

function vendasFiltradas() {
    return eventosFiltrados()
        .filter(e => e.event_type === 'PURCHASE_APPROVED')
        .filter(e => !vendasFilters.pessoa || e.pessoa_id === vendasFilters.pessoa)
        .filter(e => !vendasFilters.rede || e.rede_id === vendasFilters.rede)
        .filter(e => !vendasFilters.canal || e.canal_id === vendasFilters.canal)
        .filter(e => !vendasFilters.moeda || (e.moeda || 'BRL').toUpperCase() === vendasFilters.moeda)
        .filter(e => {
            if (!vendasFilters.q) return true;
            const q = vendasFilters.q.toLowerCase();
            return (e.comprador_nome || '').toLowerCase().includes(q)
                || (e.comprador_email || '').toLowerCase().includes(q)
                || (e.src || '').toLowerCase().includes(q)
                || (e.transaction_id || '').toLowerCase().includes(q);
        });
}

function renderVendas() {
    const vendas = vendasFiltradas();

    // Totais por moeda como KPIs
    const porMoeda = receitaPorMoeda(vendas);
    const moedas = Object.entries(porMoeda).sort((a, b) => b[1] - a[1]);
    const totaisEl = document.getElementById('vendas-totais');
    const totais = [
        `<div class="kpi-card investment"><div class="kpi-glow"></div><div class="kpi-label">VENDAS</div><div class="kpi-value">${vendas.length}</div><div class="kpi-meta">${vendasFilters.pessoa ? 'pessoa filtrada' : 'todas pessoas'}</div></div>`,
        ...moedas.map(([m, total]) => {
            const count = vendas.filter(v => (v.moeda || 'BRL').toUpperCase() === m).length;
            const ticket = count > 0 ? total / count : 0;
            return `<div class="kpi-card revenue"><div class="kpi-glow"></div><div class="kpi-label">RECEITA ${m}</div><div class="kpi-value" style="font-size:24px">${fmtMoeda(total, m)}</div><div class="kpi-meta">${count} vendas · ticket ${fmtMoeda(ticket, m)}</div></div>`;
        })
    ];
    if (moedas.length === 0) totais.push(`<div class="kpi-card revenue"><div class="kpi-glow"></div><div class="kpi-label">RECEITA</div><div class="kpi-value">${fmtMoeda(0, 'BRL')}</div><div class="kpi-meta">sem vendas no filtro</div></div>`);
    totaisEl.innerHTML = totais.join('');

    // Tabela
    const tbody = document.querySelector('#vendas-table tbody');
    if (!vendas.length) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="8">Nenhuma venda no filtro/período selecionado.</td></tr>`;
        return;
    }
    tbody.innerHTML = vendas.map(e => {
        const when = new Date(e.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const pessoa = state.pessoas.find(p => p.id === e.pessoa_id);
        const rede = state.redes.find(r => r.id === e.rede_id);
        const canal = state.canais.find(c => c.id === e.canal_id);
        const video = state.videos.find(v => v.id === e.video_id) || state.videos.find(v => v.src === e.src);
        const linkHotmart = canal?.hotmart_url ? (() => {
            try { const u = new URL(canal.hotmart_url); u.searchParams.set('src', e.src || ''); return u.toString(); } catch { return canal.hotmart_url; }
        })() : null;
        return `
            <tr>
                <td class="mono" style="font-size:11px">${when}</td>
                <td>${escapeHtml(pessoa?.nome || '—')}</td>
                <td>${escapeHtml(rede?.nome || '—')}</td>
                <td>
                    ${escapeHtml(canal?.nome || '—')}
                    ${canal?.pais ? `<div style="font-size:10px;color:var(--text-3)">${escapeHtml(canal.pais)}</div>` : ''}
                </td>
                <td>
                    <div class="mono" style="font-size:11px">src=${escapeHtml(e.src || '—')}</div>
                    ${linkHotmart ? `<a href="${escapeHtml(linkHotmart)}" target="_blank" rel="noopener" style="font-size:10px;color:var(--blue)">abrir link ↗</a>` : ''}
                </td>
                <td>${escapeHtml(e.comprador_nome || '—')}<div style="font-size:10px;color:var(--text-3)">${escapeHtml(e.comprador_email || '')}</div></td>
                <td class="mono" style="font-size:11px">${escapeHtml(e.pais || '—')}</td>
                <td class="right mono amount-pos">${fmtMoeda(e.valor, e.moeda)}</td>
            </tr>`;
    }).join('');
}

/* ========== EVENTOS ========== */
function renderEventos() {
    const eventos = eventosFiltrados().filter(e => eventoFilter === 'all' || e.event_type === eventoFilter).slice(0, 200);
    const evtBadge = {
        CLICK:                         '<span class="badge investimento">CLIQUE</span>',
        PURCHASE_OUT_OF_SHOPPING_CART: '<span class="badge pendente">CARRINHO ABANDONADO</span>',
        PURCHASE_BILLET_PRINTED:       '<span class="badge boleto">BOLETO GERADO</span>',
        PURCHASE_AWAITING_PAYMENT:     '<span class="badge boleto">PIX AGUARDANDO</span>',
        PURCHASE_DELAYED:              '<span class="badge pendente">PAGTO ATRASADO</span>',
        PURCHASE_APPROVED:             '<span class="badge receita">VENDA APROVADA</span>',
        PURCHASE_COMPLETE:             '<span class="badge receita">COMPRA CONFIRMADA</span>',
        PURCHASE_EXPIRED:              '<span class="badge gasto">BOLETO EXPIROU</span>',
        PURCHASE_CANCELED:             '<span class="badge gasto">CANCELADO</span>',
        PURCHASE_REFUNDED:             '<span class="badge gasto">REEMBOLSO</span>',
        PURCHASE_CHARGEBACK:           '<span class="badge gasto">CHARGEBACK</span>',
        PURCHASE_PROTEST:              '<span class="badge gasto">CONTESTAÇÃO</span>',
        SUBSCRIPTION_CANCELLATION:     '<span class="badge gasto">CANCELOU ASSINATURA</span>',
        SWITCH_PLAN:                   '<span class="badge investimento">TROCOU PLANO</span>',
    };
    const tbody = document.querySelector('#eventos-table tbody');
    if (!eventos.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="7">Nenhum evento no período/filtro.</td></tr>`; return; }
    tbody.innerHTML = eventos.map(e => {
        const when = new Date(e.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const canal = state.canais.find(c => c.id === e.canal_id);
        const video = state.videos.find(v => v.id === e.video_id) || state.videos.find(v => v.src === e.src);
        const valor = e.valor ? `${e.moeda || 'BRL'} ${Number(e.valor).toFixed(2)}` : '—';
        return `
            <tr>
                <td class="mono" style="font-size:11px">${when}</td>
                <td>${evtBadge[e.event_type] || `<span class="badge">${escapeHtml(e.event_type)}</span>`}</td>
                <td>${escapeHtml(canal?.nome || e.canal_slug || '—')}</td>
                <td>
                    <div style="font-size:12px">${escapeHtml(video?.titulo || e.video_id_yt || '—')}</div>
                    <div style="font-size:10px;color:var(--text-3);font-family:'JetBrains Mono'">${escapeHtml(e.src || '')}</div>
                </td>
                <td>${escapeHtml(e.comprador_nome || '—')}</td>
                <td class="mono" style="font-size:11px">${escapeHtml(e.pais || '—')}</td>
                <td class="right mono">${valor}</td>
            </tr>`;
    }).join('');
}

/* ========== CONFIG ========== */
function renderConfig() {
    const wsId = state.currentWorkspaceId;
    const supabaseHost = (window.TRACKER_CONFIG.SUPABASE_URL || '').replace('https://', '').replace('.supabase.co', '');
    document.getElementById('cfg-webhook-url').value = `https://${supabaseHost}.functions.supabase.co/tracker-webhook?ws=${wsId}`;
    document.getElementById('cfg-click-url').value = `https://${supabaseHost}.functions.supabase.co/tracker-click`;
    fillConfigForm();
}

function fillConfigForm() {
    const cfg = state.config || {};
    document.getElementById('cfg-hottok').value = cfg.hottok || '';
    document.getElementById('cfg-yt-key').value = cfg.youtube_api_key || '';
    document.getElementById('cfg-moeda').value = cfg.moeda_padrao || 'BRL';
}

async function handleConfigSave(e) {
    e.preventDefault();
    if (!isOwner()) { toast('Só o dono pode mudar config', 'error'); return; }
    const fd = new FormData(e.target);
    const payload = {
        workspace_id: state.currentWorkspaceId,
        hottok: fd.get('hottok').trim() || null,
        youtube_api_key: fd.get('youtube_api_key').trim() || null,
        moeda_padrao: fd.get('moeda_padrao'),
        updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from('tracker_config').upsert(payload, { onConflict: 'workspace_id' });
    if (error) { console.error(error); toast('Erro: ' + error.message, 'error'); return; }
    state.config = payload;
    toast('Configuração salva', 'success');
}

/* ========== MODAL ========== */
function modalFormHTML(type, item = {}) {
    if (type === 'pessoa') return `
        <div class="form-grid">
            <div class="form-field full"><label>Nome *</label><input name="nome" required value="${escapeHtml(item.nome || '')}" placeholder="Ex: Theuzim, Luccas, Matheus..."></div>
            <div class="form-field"><label>Slug (apelido curto) *</label><input name="slug" required pattern="[a-z0-9_-]{1,20}" maxlength="20" value="${escapeHtml(item.slug || '')}" placeholder="ex: theuzim"></div>
            <div class="form-field"><label>Email</label><input name="email" type="email" value="${escapeHtml(item.email || '')}" placeholder="Opcional"></div>
            <div class="form-field full"><label>Observações</label><textarea name="obs">${escapeHtml(item.obs || '')}</textarea></div>
        </div>`;

    if (type === 'rede') return `
        <div class="form-grid">
            <div class="form-field"><label>Nome da rede *</label><input name="nome" required value="${escapeHtml(item.nome || '')}" placeholder="Ex: Escolhidos"></div>
            <div class="form-field"><label>Slug *</label><input name="slug" required pattern="[a-z0-9_-]{1,20}" maxlength="20" value="${escapeHtml(item.slug || '')}" placeholder="ex: escolhidos"></div>
            <div class="form-field full"><label>Pessoa (operador) *</label><select name="pessoa_id" required>
                <option value="">— Escolha —</option>
                ${state.pessoas.map(p => `<option value="${p.id}" ${item.pessoa_id === p.id ? 'selected' : ''}>${escapeHtml(p.nome)}</option>`).join('')}
            </select></div>
            <div class="form-field full"><label>Tema padrão</label><input name="tema" value="${escapeHtml(item.tema || '')}" placeholder="Ex: Oração, Mistério, Culinária"></div>
            <div class="form-field full"><label>Observações</label><textarea name="obs">${escapeHtml(item.obs || '')}</textarea></div>
        </div>`;

    if (type === 'canal') return `
        <div class="form-grid">
            <div class="form-field full"><label>Nome do canal *</label><input name="nome" required value="${escapeHtml(item.nome || '')}" placeholder="Ex: Escolhidos Alemão"></div>
            <div class="form-field"><label>Rede *</label><select name="rede_id" required>
                <option value="">— Escolha —</option>
                ${state.redes.map(r => { const p = state.pessoas.find(x => x.id === r.pessoa_id); return `<option value="${r.id}" ${item.rede_id === r.id ? 'selected' : ''}>${escapeHtml(r.nome)}${p ? ` (${escapeHtml(p.nome)})` : ''}</option>`; }).join('')}
            </select></div>
            <div class="form-field"><label>País *</label><select name="pais" id="canal-pais-select" required>
                <option value="">— Escolha —</option>
                ${PAISES_LIST.map(p => `<option value="${escapeHtml(p.nome)}" data-idioma="${p.idioma}" ${item.pais === p.nome ? 'selected' : ''}>${p.flag} ${escapeHtml(p.nome)}</option>`).join('')}
            </select></div>
            <div class="form-field full"><label>Link Hotmart fixo *</label><input name="hotmart_url" type="url" required value="${escapeHtml(item.hotmart_url || '')}" placeholder="https://hotm.io/XXXX ou https://pay.hotmart.com/XXXX"></div>
            <div class="form-field full"><label>URL do canal YouTube</label><input name="youtube_url" type="url" value="${escapeHtml(item.youtube_url || '')}" placeholder="https://youtube.com/@..."></div>
            <input type="hidden" name="hotmart_id" value="${escapeHtml(item.hotmart_id || '')}">
            <input type="hidden" name="idioma" value="${escapeHtml(item.idioma || '')}">
            <div class="form-field full" style="background:rgba(0,245,160,0.06);padding:12px 14px;border-radius:10px;border:1px solid rgba(0,245,160,0.2)">
                <p style="font-size:12px;color:var(--text-2);margin:0;line-height:1.5">
                    <strong>Como vai funcionar:</strong> esse link Hotmart é fixo desse canal. Pra cada vídeo novo, você só troca o <code>?src=N</code> (1, 2, 3...). O sistema identifica o canal pelo produto Hotmart e o vídeo pelo número.
                </p>
            </div>
        </div>`;

    if (type === 'produto') return `
        <div class="form-grid">
            <div class="form-field full"><label>Nome do produto *</label><input name="nome" required value="${escapeHtml(item.nome || '')}" placeholder="Ex: Curso Alma Gêmea"></div>
            <div class="form-field full"><label>Link Hotmart base *</label><input name="hotmart_url" type="url" required value="${escapeHtml(item.hotmart_url || '')}" placeholder="https://pay.hotmart.com/SEUCODIGO"></div>
            <div class="form-field"><label>Hotmart ID (opcional)</label><input name="hotmart_id" value="${escapeHtml(item.hotmart_id || '')}" placeholder="Ex: M12345678X"></div>
            <div class="form-field"><label>Moeda</label><select name="moeda">${['BRL','USD','EUR','MXN','ARS'].map(o => `<option ${item.moeda === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
            <div class="form-field full"><label>Preço (informativo)</label><input name="preco" type="number" step="0.01" value="${item.preco || ''}" placeholder="0.00"></div>
            <div class="form-field full"><label>Observações</label><textarea name="obs">${escapeHtml(item.obs || '')}</textarea></div>
        </div>`;
}

function openModal(type, id = null) {
    if (!canWrite()) { toast('Sem permissão', 'error'); return; }
    editingType = type;
    editingItem = null;
    if (id) {
        const tableMap = { pessoa: 'pessoas', rede: 'redes', canal: 'canais', produto: 'produtos' };
        editingItem = state[tableMap[type]].find(x => x.id === id) || null;
    }
    const titles = {
        pessoa:  editingItem ? ['EDITAR PESSOA', 'Editar Pessoa'] : ['NOVA PESSOA', 'Nova Pessoa'],
        rede:    editingItem ? ['EDITAR REDE', 'Editar Rede'] : ['NOVA REDE', 'Nova Rede'],
        canal:   editingItem ? ['EDITAR CANAL', 'Editar Canal'] : ['NOVO CANAL', 'Novo Canal'],
        produto: editingItem ? ['EDITAR PRODUTO', 'Editar Produto'] : ['NOVO PRODUTO', 'Novo Produto'],
    };
    document.getElementById('modal-eyebrow').textContent = titles[type][0];
    document.getElementById('modal-title').textContent = titles[type][1];
    document.getElementById('modal-form').innerHTML = modalFormHTML(type, editingItem || {});
    document.getElementById('modal-overlay').classList.add('show');
    setTimeout(() => { const first = document.querySelector('#modal-form input, #modal-form select'); if (first) first.focus(); }, 100);

    // auto-extração do hotmart_id quando o usuário cola a URL no canal
    if (type === 'canal') {
        const urlField = document.querySelector('#modal-form input[name=hotmart_url]');
        const idField = document.querySelector('#modal-form input[name=hotmart_id]');
        if (urlField && idField) {
            urlField.addEventListener('input', () => {
                if (!idField.value) {
                    const ucode = extractUcodeFromUrl(urlField.value);
                    if (ucode) idField.value = ucode;
                }
            });
        }
        // auto-preenche idioma (hidden) quando escolhe país
        const paisField = document.getElementById('canal-pais-select');
        const idiomaHidden = document.querySelector('#modal-form input[name=idioma]');
        if (paisField && idiomaHidden) {
            // se já tem país selecionado, popula idioma na hora
            const initOpt = paisField.options[paisField.selectedIndex];
            if (initOpt?.dataset.idioma && !idiomaHidden.value) idiomaHidden.value = initOpt.dataset.idioma;
            paisField.addEventListener('change', () => {
                const opt = paisField.options[paisField.selectedIndex];
                const idioma = opt?.dataset.idioma;
                if (idioma) idiomaHidden.value = idioma;
            });
        }
    }
}
window.openModal = openModal;

// Normaliza string em slug compatível com o constraint do banco
function slugify(text, maxLen = 20) {
    return (text || '')
        .toString()
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')   // tira acentos
        .replace(/[^a-z0-9]+/g, '-')                        // não-alfanum vira -
        .replace(/^-+|-+$/g, '')                            // tira hífen das pontas
        .slice(0, maxLen) || 'item';
}

// Garante slug único pra essa entidade no workspace atual
async function gerarSlugUnico(entityType, nome) {
    const tableMap = { canal: 'tracker_canais', pessoa: 'tracker_pessoas', rede: 'tracker_redes' };
    const table = tableMap[entityType];
    if (!table) return slugify(nome);
    const base = slugify(nome);
    // se editando e já tem o slug, mantém
    if (editingItem?.slug) return editingItem.slug;
    // primeira tentativa: slug puro
    const { data: existing } = await sb.from(table).select('slug').eq('workspace_id', state.currentWorkspaceId).eq('slug', base).maybeSingle();
    if (!existing) return base;
    // se colide, adiciona sufixo curto
    for (let i = 2; i < 100; i++) {
        const tentativa = `${base}-${i}`.slice(0, 20);
        const { data: hit } = await sb.from(table).select('slug').eq('workspace_id', state.currentWorkspaceId).eq('slug', tentativa).maybeSingle();
        if (!hit) return tentativa;
    }
    // fallback aleatório
    return (base + '-' + Math.random().toString(36).slice(2, 6)).slice(0, 20);
}

// Mesma lógica do helper TS, replicada em JS pra usar no browser
function extractUcodeFromUrl(url) {
    if (!url) return null;
    try {
        const u = new URL(url);
        if (u.hostname.includes('hotm.io')) return null;  // short link, não dá pra extrair sem resolver
        const m = u.pathname.match(/\/([A-Z][0-9A-Z]{6,15})(?:\/|$|\?)/);
        return m ? m[1] : null;
    } catch { return null; }
}

function closeModal() { document.getElementById('modal-overlay').classList.remove('show'); editingItem = null; editingType = null; }

async function handleSave(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const obj = Object.fromEntries(fd.entries());
    if (obj.preco !== undefined) obj.preco = obj.preco ? Number(obj.preco) : null;

    // normaliza FK vazias
    ['rede_id','pessoa_id','canal_id'].forEach(k => { if (obj[k] === '') obj[k] = null; });

    // se for canal e não tem hotmart_id, tenta extrair da URL
    if (editingType === 'canal' && !obj.hotmart_id && obj.hotmart_url) {
        const ucode = extractUcodeFromUrl(obj.hotmart_url);
        if (ucode) obj.hotmart_id = ucode;
    }

    // auto-gera slug se vazio (canal, pessoa, rede todos têm slug NOT NULL)
    if (['canal','pessoa','rede'].includes(editingType) && !obj.slug) {
        obj.slug = await gerarSlugUnico(editingType, obj.nome);
    }

    const tableMap = { pessoa: 'tracker_pessoas', rede: 'tracker_redes', canal: 'tracker_canais', produto: 'tracker_produtos' };
    const table = tableMap[editingType];
    try {
        if (editingItem) {
            const { error } = await sb.from(table).update(obj).eq('id', editingItem.id);
            if (error) throw error;
            toast('Atualizado', 'success');
        } else {
            obj.workspace_id = state.currentWorkspaceId;
            obj.created_by = state.user.id;
            const { error } = await sb.from(table).insert(obj);
            if (error) throw error;
            toast('Criado', 'success');
        }
        closeModal();
    } catch (err) {
        console.error(err);
        toast('Erro: ' + err.message, 'error');
    }
}

async function removeItem(type, id) {
    if (!canWrite()) { toast('Sem permissão', 'error'); return; }
    if (!confirm('Remover esse registro?')) return;
    const tableMap = { pessoa: 'tracker_pessoas', rede: 'tracker_redes', canal: 'tracker_canais', produto: 'tracker_produtos' };
    const { error } = await sb.from(tableMap[type]).delete().eq('id', id);
    if (error) { toast('Erro', 'error'); return; }
    toast('Removido', 'success');
}
window.removeItem = removeItem;

/* ========== ENRICH BUTTON ========== */
async function handleEnrichClick() {
    if (!state.config?.youtube_api_key) { toast('Configure a YouTube API Key em Configurações', 'error'); return; }
    const btn = document.getElementById('enrich-btn');
    const orig = btn.innerHTML;
    btn.innerHTML = '<span style="font-family:var(--font-mono);font-size:11px">enriquecendo...</span>';
    btn.disabled = true;
    try {
        const supabaseHost = (window.TRACKER_CONFIG.SUPABASE_URL || '').replace('https://', '').replace('.supabase.co', '');
        const resp = await fetch(`https://${supabaseHost}.functions.supabase.co/youtube-enrich`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'apikey': window.TRACKER_CONFIG.SUPABASE_ANON_KEY, 'authorization': `Bearer ${(await sb.auth.getSession()).data.session?.access_token || ''}` },
            body: JSON.stringify({ ws: state.currentWorkspaceId, all_stale: true }),
        });
        const data = await resp.json();
        if (data.ok) {
            toast(`Enriqueceu ${data.enriched || 0} vídeo${data.enriched !== 1 ? 's' : ''} da YouTube API`, 'success');
            await loadAllData();
            renderAll();
        } else {
            toast(`Erro: ${data.error || 'desconhecido'}`, 'error');
        }
    } catch (err) {
        toast('Erro: ' + err.message, 'error');
    } finally {
        btn.innerHTML = orig;
        btn.disabled = false;
    }
}

/* ========== EVENTS ========== */
document.addEventListener('DOMContentLoaded', () => {
    updateClock();
    setInterval(updateClock, 30000);

    document.querySelectorAll('.auth-tab').forEach(b => b.addEventListener('click', () => switchAuthTab(b.dataset.authTab)));
    document.getElementById('form-login').addEventListener('submit', handleLogin);
    document.getElementById('form-signup').addEventListener('submit', handleSignup);

    document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
    document.querySelectorAll('[data-add]').forEach(btn => btn.addEventListener('click', () => openModal(btn.dataset.add)));

    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') closeModal(); });
    document.getElementById('modal-form').addEventListener('submit', handleSave);

    document.getElementById('period-filter').addEventListener('change', renderAll);
    document.getElementById('search-videos').addEventListener('input', renderVideos);
    document.getElementById('search-canais').addEventListener('input', renderCanais);

    document.getElementById('ws-current').addEventListener('click', (e) => {
        e.stopPropagation();
        const dd = document.getElementById('ws-dropdown'); dd.hidden = !dd.hidden;
    });
    document.addEventListener('click', () => { document.getElementById('ws-dropdown').hidden = true; });
    document.getElementById('user-chip').addEventListener('click', handleLogout);

    // filtros da aba Vendas
    ['vendas-filter-pessoa', 'vendas-filter-rede', 'vendas-filter-canal', 'vendas-filter-moeda'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', () => {
            const key = id.replace('vendas-filter-', '');
            vendasFilters[key] = el.value;
            // se mudou pessoa, reseta rede/canal pra evitar inconsistência
            if (key === 'pessoa') { vendasFilters.rede = ''; vendasFilters.canal = ''; }
            if (key === 'rede') { vendasFilters.canal = ''; }
            refreshVendasFilters();
            renderVendas();
        });
    });
    const sv = document.getElementById('search-vendas');
    if (sv) sv.addEventListener('input', () => { vendasFilters.q = sv.value; renderVendas(); });

    // gerador de link
    ['gen-canal', 'gen-numero', 'gen-tipo'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateGenOutput);
    });
    const genCopy = document.getElementById('gen-copy');
    if (genCopy) genCopy.addEventListener('click', () => copyText(document.getElementById('gen-output').value, 'Link'));
    const genNext = document.getElementById('gen-next');
    if (genNext) genNext.addEventListener('click', suggestNextNumber);

    // filtros de evento
    document.querySelectorAll('#event-filter-pills .pill').forEach(p => p.addEventListener('click', () => {
        eventoFilter = p.dataset.filter;
        document.querySelectorAll('#event-filter-pills .pill').forEach(x => x.classList.toggle('active', x === p));
        renderEventos();
    }));

    // config form
    document.getElementById('form-config').addEventListener('submit', handleConfigSave);

    // enrich button
    document.getElementById('enrich-btn').addEventListener('click', handleEnrichClick);

    // pop-up de venda — close + ESC
    document.getElementById('sale-pop-close').addEventListener('click', closeSalePop);
    document.getElementById('sale-pop-overlay').addEventListener('click', (e) => {
        if (e.target.id === 'sale-pop-overlay') closeSalePop();
    });

    // toggles de notificação
    const prefs = getNotifPrefs();
    const popupChk = document.getElementById('cfg-popup-on');
    const soundChk = document.getElementById('cfg-sound-on');
    const browserChk = document.getElementById('cfg-browser-notif-on');
    if (popupChk) popupChk.checked = prefs.popup !== false;
    if (soundChk) soundChk.checked = prefs.sound !== false;
    if (browserChk) browserChk.checked = prefs.browser === true;

    const savePref = (key, val) => { const p = getNotifPrefs(); p[key] = val; setNotifPrefs(p); };
    if (popupChk) popupChk.addEventListener('change', () => savePref('popup', popupChk.checked));
    if (soundChk) soundChk.addEventListener('change', () => savePref('sound', soundChk.checked));
    if (browserChk) browserChk.addEventListener('change', async () => {
        savePref('browser', browserChk.checked);
        if (browserChk.checked && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
            const result = await Notification.requestPermission();
            if (result !== 'granted') {
                browserChk.checked = false;
                savePref('browser', false);
                toast('Permissão de notificação negada pelo navegador', 'error');
            } else {
                toast('Notificações do navegador ativadas!', 'success');
            }
        }
    });

    // botão "Disparar pop-up de teste"
    const testBtn = document.getElementById('cfg-test-popup');
    if (testBtn) testBtn.addEventListener('click', () => {
        const fakeVenda = {
            id: 'test-' + Date.now(),
            event_type: 'PURCHASE_APPROVED',
            valor: 197.00 + Math.random() * 800,
            moeda: ['BRL', 'USD'][Math.floor(Math.random() * 2)],
            src: String(Math.floor(Math.random() * 100) + 1),
            pessoa_id: state.pessoas[Math.floor(Math.random() * Math.max(1, state.pessoas.length))]?.id,
            comprador_nome: 'Comprador Teste',
            comprador_email: 'teste@example.com',
        };
        const pessoa = state.pessoas.find(p => p.id === fakeVenda.pessoa_id);
        if (pessoa) {
            const rede = state.redes.find(r => r.pessoa_id === pessoa.id);
            const canal = rede ? state.canais.find(c => c.rede_id === rede.id) : null;
            fakeVenda.rede_id = rede?.id;
            fakeVenda.canal_id = canal?.id;
        }
        showSaleCelebration(fakeVenda);
    });

    // ESC fecha o pop-up de venda
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSalePop(); });

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    boot();
});
