/* =========================================================
   VISOR DE REPETICIONES - TOROHAX

   Lee archivos .hbr2 de HaxBall directamente en el navegador (nada se sube a ningún servidor):
     - Reproduce la repetición en un canvas (play, pausa, velocidad, saltos, goles).
     - Extrae el chat completo (mensajes de jugadores y anuncios de la sala) con su minuto exacto.

   Usa node-haxball (MIT) para leer la repetición: vendor/haxball/.
   Estructura:
     1. VisorCore  -> lógica pura (sin DOM): formato, chat, análisis del archivo. Se prueba en Node.
     2. App        -> interfaz: carga de archivos, reproductor, chat, jugadores y goles.
   ========================================================= */

/* ---------------------------------------------------------
   1. NÚCLEO (sin DOM)
   --------------------------------------------------------- */
const VisorCore = (function () {
    'use strict';

    const FPS = 60;
    const MAX_REPLAY_BYTES = 30 * 1024 * 1024;

    const DEFAULT_TEAM_COLORS = { 1: 0xE56E56, 2: 0x5689E5 };

    /* ---- Formato ---- */

    // Cuadro -> "m:ss" (o "h:mm:ss")
    function formatTime(frame) {
        const total = Math.max(0, Math.floor(frame / FPS));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        const ss = String(s).padStart(2, '0');
        return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
    }

    // Segundos -> "m:ss" (reloj del partido)
    function formatSeconds(seconds) {
        return formatTime(Math.max(0, seconds) * FPS);
    }

    // Número de color de HaxBall -> "#rrggbb". Con `legible` aclara los colores muy oscuros para fondos oscuros.
    function colorToCss(n, legible) {
        if (typeof n !== 'number' || n < 0 || !isFinite(n)) return legible ? '#e8e8e8' : 'transparent';
        let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
        if (legible) {
            const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            if (lum < 0.45) {
                const t = (0.45 - lum) / (1 - lum) + 0.15;   // mezcla hacia el blanco
                r = Math.round(r + (255 - r) * t);
                g = Math.round(g + (255 - g) * t);
                b = Math.round(b + (255 - b) * t);
            }
        }
        return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    }

    function shadeColor(n, factor) {
        const f = (v) => Math.max(0, Math.min(255, Math.round(v * factor)));
        return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => f(v).toString(16).padStart(2, '0')).join('');
    }

    /* ---- Chat ---- */

    // Línea de chat reenviada por el host:  "(🦙1️⃣) [👤16866] Nombre: mensaje"  (el rango y el emoji inicial son opcionales)
    const CHAT_LINE_RE = /^(?:(?<pre>[^\[(]*?)\s*)?(?:\((?<rank>[^)]*)\)\s*)?\[👤(?<uid>\d+)\]\s*(?<name>.+?):\s(?<msg>[\s\S]*)$/;
    const SEPARATOR_RE = /^[\s═─━\-=_*·•~]{6,}$/;

    // Clasifica un anuncio del host: 'chat' (mensaje de un jugador), 'sep' (línea decorativa) o 'event' (aviso de la sala)
    function parseAnnouncement(text) {
        const t = String(text == null ? '' : text);
        if (SEPARATOR_RE.test(t)) return { type: 'sep' };
        const m = CHAT_LINE_RE.exec(t);
        if (m && m.groups) {
            return {
                type: 'chat',
                prefix: (m.groups.pre || '').trim(),
                rank: (m.groups.rank || '').trim(),
                uid: m.groups.uid,
                name: m.groups.name.trim(),
                text: m.groups.msg
            };
        }
        return { type: 'event' };
    }

    // Nombres de los equipos a partir del anuncio "📊 Qatar 🆚 España" que publica el host al empezar
    function extractTeamNames(messages) {
        for (const m of messages) {
            if (m.type !== 'event') continue;
            const r = /📊\s*(.+?)\s*🆚\s*(.+)$/.exec(m.text);
            if (r) return { red: r[1].trim(), blue: r[2].trim() };
        }
        return null;
    }

    // Filtra por tipo ('all' | 'chat' | 'events') y por texto
    function filterMessages(messages, mode, query) {
        const q = String(query || '').trim().toLowerCase();
        return messages.filter(m => {
            if (mode === 'chat' && m.type !== 'chat') return false;
            if (mode === 'events' && (m.type === 'chat')) return false;
            if (!q) return true;
            if (m.type === 'sep') return false;
            return ((m.name || '') + ' ' + m.text).toLowerCase().includes(q);
        });
    }

    // Texto plano del chat para descargar/copiar
    function buildChatText(messages, title) {
        const lines = [];
        lines.push(`Chat de la repetición${title ? ': ' + title : ''}`);
        lines.push(`Generado con el Visor de Repeticiones de ToroHax`);
        lines.push('');
        for (const m of messages) {
            const t = `[${formatTime(m.f)}]`;
            if (m.type === 'sep') lines.push('------------------------------');
            else if (m.type === 'chat') lines.push(`${t} ${m.rank ? '(' + m.rank + ') ' : ''}${m.name}: ${m.text}`);
            else lines.push(`${t} ${m.text}`);
        }
        return lines.join('\r\n');
    }

    // Índice del último mensaje cuyo cuadro es <= frame (los mensajes vienen ordenados por cuadro); -1 si no hay
    function lastIndexAtOrBefore(messages, frame) {
        let lo = 0, hi = messages.length - 1, ans = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (messages[mid].f <= frame) { ans = mid; lo = mid + 1; } else hi = mid - 1;
        }
        return ans;
    }

    // Descripción de un gol usando los anuncios del host que lo rodean ("... anota para España!" + "📊 Qatar | 0 - 4 | España")
    function describeGoal(messages, goalFrame) {
        const from = goalFrame - FPS, to = goalFrame + FPS * 12;
        let scoreIdx = -1;
        for (let i = 0; i < messages.length; i++) {
            const m = messages[i];
            if (m.f < from) continue;
            if (m.f > to) break;
            if (m.type === 'event' && m.text.startsWith('📊') && /\d+\s*-\s*\d+/.test(m.text)) { scoreIdx = i; break; }
        }
        if (scoreIdx < 0) return null;
        let description = null;
        for (let j = scoreIdx - 1; j >= 0 && messages[scoreIdx].f - messages[j].f <= FPS * 6; j--) {
            if (messages[j].type === 'event') { description = messages[j].text; break; }
        }
        const sc = /(\d+)\s*-\s*(\d+)/.exec(messages[scoreIdx].text);
        return { description, red: sc ? +sc[1] : null, blue: sc ? +sc[2] : null };
    }

    function looksLikeReplay(bytes) {
        return bytes && bytes.length > 8 && bytes[0] === 0x48 && bytes[1] === 0x42 && bytes[2] === 0x52 && bytes[3] === 0x32; // "HBR2"
    }

    /* ---- Análisis del archivo ---- */

    // El lector avanza con requestAnimationFrame, que el navegador pausa en pestañas ocultas (por ejemplo, un enlace abierto
    // en segundo plano). Para el análisis se usa un planificador basado en MessageChannel, que sigue corriendo a toda velocidad.
    function createFastScheduler() {
        const queue = new Map();
        let nextId = 0;
        const channel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
        const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const run = (id) => { const cb = queue.get(id); if (cb) { queue.delete(id); cb(now()); } };
        if (channel) channel.port1.onmessage = (e) => run(e.data);
        return {
            requestAnimationFrame: (cb) => {
                const id = ++nextId;
                queue.set(id, cb);
                if (channel) channel.port2.postMessage(id); else setTimeout(() => run(id), 0);
                return id;
            },
            cancelAnimationFrame: (id) => { queue.delete(id); },
            dispose: () => { queue.clear(); if (channel) { channel.port1.onmessage = null; channel.port1.close(); channel.port2.close(); } }
        };
    }

    // Recorre la repetición a toda velocidad y recoge chat/anuncios, jugadores y estadísticas simples.
    // `API` es el objeto devuelto por abcHaxballAPI(window). Devuelve una promesa.
    function scanReplay(API, bytes, options) {
        const onProgress = (options && options.onProgress) || function () {};
        const timeoutMs = (options && options.timeoutMs) || 180000;
        const { Replay } = API;

        return new Promise((resolve, reject) => {
            const raw = [];
            const players = new Map();
            const kicks = new Map();
            let stadiumName = null;
            let reader = null, progressTimer = null, killTimer = null, done = false;
            const scheduler = createFastScheduler();

            const frame = () => (reader ? reader.getCurrentFrameNo() : 0);
            const touch = (id, name, team, f) => {
                let p = players.get(id);
                if (!p) { p = { id, name: name || ('#' + id), teams: new Set(), firstFrame: f, lastFrame: null, team: 0 }; players.set(id, p); }
                if (name) p.name = name;
                if (team != null) { p.team = team; if (team > 0) p.teams.add(team); }
                return p;
            };
            const cleanup = () => {
                clearInterval(progressTimer); clearTimeout(killTimer);
                try { reader && reader.destroy(); } catch (e) { /* ya liberado */ }
                scheduler.dispose();
            };
            const finish = () => {
                if (done) return;
                done = true;
                const maxFrame = reader.maxFrameNo;
                const list = Array.from(players.values()).map(p => Object.assign({}, p, { teams: Array.from(p.teams), kicks: kicks.get(p.id) || 0 }));
                cleanup();
                raw.sort((a, b) => a.f - b.f);   // estable: conserva el orden de llegada dentro del mismo cuadro
                resolve({ raw, players: list, stadiumName, maxFrame });
            };
            const fail = (err) => { if (done) return; done = true; cleanup(); reject(err); };

            try {
                reader = Replay.read(bytes, {
                    onPlayerChat: (id, message) => {
                        const p = reader.state.getPlayer(id);
                        raw.push({ f: frame(), kind: 'chat', id, name: p ? p.name : '#' + id, team: p && p.team ? p.team.id : 0, text: message });
                    },
                    onAnnouncement: (msg, color, style) => raw.push({ f: frame(), kind: 'ann', text: msg, color, style }),
                    onPlayerJoin: (p) => touch(p.id, p.name, p.team ? p.team.id : 0, frame()),
                    onPlayerLeave: (p) => { const q = touch(p.id, p.name, null, frame()); q.lastFrame = frame(); },
                    onPlayerTeamChange: (id, teamId) => { const p = reader.state.getPlayer(id); touch(id, p ? p.name : null, teamId, frame()); },
                    onPlayerBallKick: (id) => kicks.set(id, (kicks.get(id) || 0) + 1),
                    onStadiumChange: (st) => { if (st && st.name) stadiumName = st.name; },
                    onGameStart: () => {
                        try { const st = reader.gameState && reader.gameState.stadium; if (st && st.name) stadiumName = st.name; } catch (e) { /* sin estadio aún */ }
                    }
                }, { requestAnimationFrame: scheduler.requestAnimationFrame, cancelAnimationFrame: scheduler.cancelAnimationFrame });
            } catch (e) { scheduler.dispose(); reject(e); return; }

            try {
                reader.state.players.forEach(p => touch(p.id, p.name, p.team ? p.team.id : 0, 0));
                const st0 = reader.state.stadium || (reader.gameState && reader.gameState.stadium);
                if (st0 && st0.name) stadiumName = st0.name;
            } catch (e) { /* la sala puede empezar vacía */ }

            const total = Math.max(1, reader.maxFrameNo);
            progressTimer = setInterval(() => onProgress(Math.min(1, frame() / total)), 120);
            killTimer = setTimeout(() => fail(new Error('El análisis tardó demasiado.')), timeoutMs);

            reader.onEnd = finish;
            reader.setSpeed(100000);
        });
    }

    // Convierte lo recogido en mensajes listos para mostrar
    function buildMessages(raw) {
        return raw.map(r => {
            if (r.kind === 'chat') return { f: r.f, type: 'chat', name: r.name, team: r.team, rank: '', text: r.text, color: null };
            const p = parseAnnouncement(r.text);
            if (p.type === 'chat') return { f: r.f, type: 'chat', name: p.name, team: 0, rank: p.rank, uid: p.uid, prefix: p.prefix, text: p.text, color: null };
            return { f: r.f, type: p.type, text: r.text, color: r.color, style: r.style };
        });
    }

    return {
        FPS, MAX_REPLAY_BYTES, DEFAULT_TEAM_COLORS,
        formatTime, formatSeconds, colorToCss, shadeColor,
        parseAnnouncement, extractTeamNames, filterMessages, buildChatText, lastIndexAtOrBefore, describeGoal,
        looksLikeReplay, scanReplay, buildMessages
    };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = VisorCore;


/* ---------------------------------------------------------
   2. INTERFAZ
   --------------------------------------------------------- */
(function () {
    'use strict';
    if (typeof document === 'undefined') return;

    const C = VisorCore;
    const $ = (id) => document.getElementById(id);

    const S = {
        API: null,
        bytes: null,
        title: '',
        sourceUrl: null,
        scan: null,
        messages: [],
        goals: [],            // [{ f, teamId, text }]
        teamNames: { red: 'Rojo', blue: 'Azul' },
        maxFrame: 0,
        reader: null,
        speed: 1,
        playing: false,
        seeking: false,
        pendingSeek: null,
        followBall: false,
        showNames: true,
        autoScroll: true,
        filterMode: 'all',
        query: '',
        lastScore: { red: 0, blue: 0 },
        lastClockFrame: -1,
        lastChatIndex: -2,
        needsRedraw: true,
        lastDrawnFrame: -1,
        lastHud: 0,
        camera: { x: 0, y: 0 },
        dragging: false,
        flashUntil: 0,
        rafId: 0
    };

    let canvas, ctx, resizeObs;

    /* ---------- Utilidades de interfaz ---------- */

    function show(el, visible) { el.classList.toggle('vz-hidden', !visible); }

    function showError(msg) {
        const el = $('vz-error');
        el.textContent = msg;
        show(el, !!msg);
    }

    function setProgress(visible, fraction, label) {
        show($('vz-progress'), visible);
        if (!visible) return;
        $('vz-progress-bar').style.width = Math.round(fraction * 100) + '%';
        $('vz-progress-text').textContent = label + (fraction > 0 && fraction < 1 ? ` ${Math.round(fraction * 100)}%` : '');
    }

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    function ensureAPI() {
        if (S.API) return S.API;
        if (typeof abcHaxballAPI !== 'function' || typeof pako === 'undefined' || typeof JSON5 === 'undefined') {
            throw new Error('No se pudieron cargar las librerías del visor. Recarga la página.');
        }
        S.API = abcHaxballAPI(window);
        return S.API;
    }

    /* ---------- Carga de la repetición ---------- */

    async function loadFromFile(file) {
        showError('');
        if (!file) return;
        if (file.size > C.MAX_REPLAY_BYTES) return showError('El archivo es demasiado grande (máximo 30 MB).');
        const buf = new Uint8Array(await file.arrayBuffer());
        S.sourceUrl = null;
        await loadFromBytes(buf, file.name.replace(/\.hbr2$/i, ''));
    }

    async function loadFromUrl(url) {
        showError('');
        let parsed;
        try { parsed = new URL(url, location.href); } catch (e) { return showError('El enlace no es válido.'); }
        if (!/^https?:$/.test(parsed.protocol)) return showError('Solo se permiten enlaces http o https.');
        setProgress(true, 0, 'Descargando repetición…');
        let buf;
        try {
            const res = await fetch(parsed.href);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            buf = new Uint8Array(await res.arrayBuffer());
        } catch (e) {
            setProgress(false);
            return showError('No se pudo descargar el archivo desde ese enlace (puede haber expirado o no permitir descargas desde otras páginas). Descárgalo y súbelo manualmente.');
        }
        if (buf.length > C.MAX_REPLAY_BYTES) { setProgress(false); return showError('El archivo es demasiado grande (máximo 30 MB).'); }
        S.sourceUrl = parsed.href;
        const last = decodeURIComponent(parsed.pathname.split('/').pop() || 'repetición');
        await loadFromBytes(buf, last.replace(/\.hbr2$/i, ''));
    }

    async function loadFromBytes(bytes, name) {
        showError('');
        if (!C.looksLikeReplay(bytes)) {
            setProgress(false);
            return showError('Ese archivo no parece una repetición de HaxBall (.hbr2).');
        }
        try {
            const API = ensureAPI();
            destroyPlayer();
            setProgress(true, 0, 'Analizando repetición…');

            // Marcadores de gol y duración: lectura instantánea, sin simular el partido
            const data = API.Replay.readAll(bytes);
            // El marcador del archivo guarda el equipo que RECIBIÓ el gol; aquí se guarda el que lo anotó
            const goalMarkers = (data.goalMarkers || []).map(g => ({ f: g.frameNo, teamId: g.teamId === 1 ? 2 : 1 }));

            const scan = await C.scanReplay(API, bytes, { onProgress: (p) => setProgress(true, p, 'Analizando repetición…') });
            const messages = C.buildMessages(scan.raw);

            S.bytes = bytes;
            S.scan = scan;
            S.messages = messages;
            S.maxFrame = Math.max(scan.maxFrame, data.totalFrames || 0);
            S.teamNames = C.extractTeamNames(messages) || { red: 'Rojo', blue: 'Azul' };
            S.goals = goalMarkers.map(g => {
                const d = C.describeGoal(messages, g.f);
                return { f: g.f, teamId: g.teamId, text: d && d.description, red: d && d.red, blue: d && d.blue };
            });
            S.title = C.extractTeamNames(messages) ? `${S.teamNames.red} vs ${S.teamNames.blue}` : name;
            S.fileName = name;
            S.lastScore = { red: 0, blue: 0 };
            S.lastChatIndex = -2;
            S.lastClockFrame = -1;
            S.camera = { x: 0, y: 0 };

            setProgress(false);
            showViewer();
        } catch (e) {
            console.error('Error al abrir la repetición:', e);
            setProgress(false);
            showError('No se pudo abrir la repetición. El archivo puede estar dañado o ser de una versión no compatible.');
        }
    }

    /* ---------- Vista del visor ---------- */

    function showViewer() {
        show($('vz-load'), false);
        show($('vz-viewer'), true);
        $('vz-title').textContent = S.title;
        $('vz-title').title = S.fileName || S.title;
        $('vz-name-red').textContent = S.teamNames.red;
        $('vz-name-blue').textContent = S.teamNames.blue;

        const seek = $('vz-seek');
        seek.max = S.maxFrame;
        seek.value = 0;
        $('vz-time-total').textContent = C.formatTime(S.maxFrame);
        show($('vz-copy-link'), !!S.sourceUrl);

        renderMarkers();
        renderChat();
        renderPlayers();
        renderGoals();
        switchTab('chat');
        setupCanvas();
        createPlayer();
    }

    function backToLoader() {
        destroyPlayer();
        cancelAnimationFrame(S.rafId);
        S.bytes = null; S.scan = null; S.messages = []; S.goals = [];
        show($('vz-viewer'), false);
        show($('vz-load'), true);
        showError('');
        $('vz-file').value = '';
    }

    /* ---------- Reproductor ---------- */

    function createPlayer() {
        const API = ensureAPI();
        S.reader = API.Replay.read(S.bytes, {
            onTeamGoal: (teamId) => {
                if (S.seeking) return;
                const name = teamId === 1 ? S.teamNames.red : S.teamNames.blue;
                const flash = $('vz-flash');
                flash.textContent = `¡GOL DE ${String(name).toUpperCase()}!`;
                flash.className = 'vz-flash ' + (teamId === 1 ? 'red' : 'blue') + ' show';
                S.flashUntil = performance.now() + 2600;
            }
        });
        S.reader.onEnd = () => { S.playing = false; syncPlayButton(); S.needsRedraw = true; };
        S.playing = true;
        S.reader.setSpeed(S.speed);
        syncPlayButton();
        S.needsRedraw = true;
        S.lastDrawnFrame = -1;
        cancelAnimationFrame(S.rafId);
        S.rafId = requestAnimationFrame(frameLoop);
    }

    function destroyPlayer() {
        cancelAnimationFrame(S.rafId);
        if (S.reader) { try { S.reader.destroy(); } catch (e) { /* ya liberado */ } }
        S.reader = null;
        S.playing = false;
        S.seeking = false;
        S.pendingSeek = null;
    }

    function currentFrame() { return S.reader ? S.reader.getCurrentFrameNo() : 0; }

    function setPlaying(playing) {
        if (!S.reader) return;
        if (playing && currentFrame() >= S.maxFrame - 1) { seekTo(0, true); return; }
        S.playing = playing;
        if (!S.seeking) S.reader.setSpeed(playing ? S.speed : 0);
        syncPlayButton();
    }

    function syncPlayButton() {
        const b = $('vz-play');
        b.innerHTML = S.playing ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
        b.setAttribute('aria-label', S.playing ? 'Pausar' : 'Reproducir');
        b.title = S.playing ? 'Pausar (espacio)' : 'Reproducir (espacio)';
    }

    function setSpeed(v) {
        S.speed = v;
        if (S.reader && S.playing && !S.seeking) S.reader.setSpeed(v);
    }

    // Salta a un cuadro. Si estaba reproduciendo, continúa; si estaba en pausa, queda en pausa.
    function seekTo(frame, forcePlay) {
        if (!S.reader) return;
        frame = clamp(Math.round(frame), 0, S.maxFrame);
        if (S.seeking) { S.pendingSeek = { frame, forcePlay }; return; }
        if (frame === currentFrame() && !forcePlay) return;

        const resume = forcePlay || S.playing;
        S.seeking = true;
        S.playing = resume;
        syncPlayButton();
        S.reader.setSpeed(0);
        const spinnerTimer = setTimeout(() => show($('vz-seeking'), true), 160);

        const reader = S.reader;
        reader.onDestinationTimeReached = () => {
            reader.onDestinationTimeReached = null;
            clearTimeout(spinnerTimer);
            show($('vz-seeking'), false);
            S.seeking = false;
            S.needsRedraw = true;
            S.lastChatIndex = -2;
            if (S.pendingSeek) {
                const p = S.pendingSeek; S.pendingSeek = null;
                seekTo(p.frame, p.forcePlay);
                return;
            }
            if (S.reader === reader && S.playing) reader.setSpeed(S.speed);
        };
        // un tick de espera para que el navegador pinte el indicador antes del cálculo pesado
        requestAnimationFrame(() => setTimeout(() => { if (S.reader === reader) reader.setCurrentFrameNo(frame); }, 0));
    }

    /* ---------- Dibujo ---------- */

    function setupCanvas() {
        canvas = $('vz-canvas');
        ctx = canvas.getContext('2d', { alpha: false });
        if (resizeObs) resizeObs.disconnect();
        const resize = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const r = canvas.getBoundingClientRect();
            const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
            if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; S.needsRedraw = true; }
        };
        resizeObs = new ResizeObserver(resize);
        resizeObs.observe(canvas);
        resize();
    }

    function teamColors(roomState, teamId) {
        const tc = roomState.teamColors && roomState.teamColors[teamId];
        const inner = tc && tc.inner && tc.inner.length ? tc.inner : [C.DEFAULT_TEAM_COLORS[teamId] || 0xffffff];
        return { inner, angle: tc ? tc.angle : 0, text: tc && typeof tc.text === 'number' ? tc.text : 0xffffff };
    }

    function drawPlayerDisc(g, p, colors) {
        const d = p.disc, r = d.radius, x = d.pos.x, y = d.pos.y;
        g.save();
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.clip();
        g.translate(x, y);
        g.rotate((Math.PI * colors.angle) / 128);
        const step = (2 * r) / colors.inner.length;
        for (let i = 0; i < colors.inner.length; i++) {
            g.fillStyle = C.colorToCss(colors.inner[i]);
            g.fillRect(-r + i * step, -r, step + 1, 2 * r);
        }
        g.restore();

        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.lineWidth = 2;
        g.strokeStyle = p.isKicking ? '#ffffff' : '#000000';
        g.stroke();

        const label = p.headlessAvatar != null ? p.headlessAvatar : (p.avatar != null ? p.avatar : String(p.avatarNumber != null ? p.avatarNumber : ''));
        if (label) {
            g.fillStyle = C.colorToCss(colors.text);
            g.font = `900 ${Math.round(r * 1.05)}px "Arial Black", Arial, sans-serif`;
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillText(label, x, y + r * 0.06);
        }
    }

    function drawBackground(g, st, w, h) {
        const t = st.bgType;
        const field = (fillCss, lineCss) => {
            const hw = st.bgWidth, hh = st.bgHeight, cr = Math.min(st.bgCornerRadius || 0, hw, hh);
            g.beginPath();
            g.moveTo(-hw + cr, -hh);
            g.arcTo(hw, -hh, hw, hh, cr); g.arcTo(hw, hh, -hw, hh, cr);
            g.arcTo(-hw, hh, -hw, -hh, cr); g.arcTo(-hw, -hh, hw, -hh, cr);
            g.closePath();
            g.fillStyle = fillCss; g.fill();
            g.lineWidth = 3; g.strokeStyle = lineCss; g.stroke();
            g.beginPath(); g.moveTo(0, -hh); g.lineTo(0, hh); g.stroke();
            g.beginPath(); g.arc(0, 0, st.bgKickOffRadius || 0, 0, Math.PI * 2); g.stroke();
        };
        if (t === 1) {                      // pasto
            g.fillStyle = C.colorToCss(st.bgColor); g.fillRect(-1e5, -1e5, 2e5, 2e5);
            field(C.shadeColor(st.bgColor, 1.1), '#C7E6BD');
        } else if (t === 2) {               // hockey
            g.fillStyle = '#3f434c'; g.fillRect(-1e5, -1e5, 2e5, 2e5);
            field('#5b606c', '#E9CC6E');
        } else {
            g.fillStyle = C.colorToCss(st.bgColor); g.fillRect(-1e5, -1e5, 2e5, 2e5);
        }
    }

    function drawSegments(g, st) {
        g.lineWidth = 3;
        for (const s of st.segments) {
            if (!s.vis) continue;
            g.beginPath();
            g.strokeStyle = C.colorToCss(s.color);
            const a = s.v0.pos, b = s.v1.pos;
            if (0 * s.curveF !== 0) { g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); }
            else {
                const c = s.arcCenter, dx = a.x - c.x, dy = a.y - c.y;
                g.arc(c.x, c.y, Math.sqrt(dx * dx + dy * dy), Math.atan2(dy, dx), Math.atan2(b.y - c.y, b.x - c.x));
            }
            g.stroke();
        }
    }

    // Medio ancho/alto de la cancha real (fondo + líneas visibles del mapa), no del "tamaño de cámara" que suele traer mucho margen
    const boundsCache = new WeakMap();
    function stadiumHalfExtent(st) {
        let b = boundsCache.get(st);
        if (b) return b;
        let hw = st.bgWidth > 0 ? st.bgWidth : 0, hh = st.bgHeight > 0 ? st.bgHeight : 0;
        for (const s of st.segments) {
            if (!s.vis) continue;
            for (const v of [s.v0.pos, s.v1.pos]) {
                if (Math.abs(v.x) > hw) hw = Math.abs(v.x);
                if (Math.abs(v.y) > hh) hh = Math.abs(v.y);
            }
        }
        if (!(hw > 0)) hw = st.width || 400;
        if (!(hh > 0)) hh = st.height || 200;
        b = { hw, hh };
        boundsCache.set(st, b);
        return b;
    }

    function draw() {
        const reader = S.reader;
        const w = canvas.width, h = canvas.height;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const gs = reader.gameState;

        if (!gs) {
            ctx.fillStyle = '#0a2a2e'; ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#7d7d7d'; ctx.font = `${Math.round(h * 0.05)}px sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('Esperando el inicio del partido…', w / 2, h / 2);
            return;
        }

        const st = gs.stadium, room = reader.state, discs = gs.physicsState.discs;
        const ext = stadiumHalfExtent(st);
        const fieldW = ext.hw * 1.05 + 25;
        const fieldH = ext.hh * 1.05 + 25;
        let zoom = Math.min(w / (2 * fieldW), h / (2 * fieldH));
        let cx = 0, cy = 0;

        if (S.followBall && discs[0]) {
            const z2 = zoom * 2.2;
            const vw = w / z2 / 2, vh = h / z2 / 2;
            const tx = clamp(discs[0].pos.x, -fieldW + vw, fieldW - vw);
            const ty = clamp(discs[0].pos.y, -fieldH + vh, fieldH - vh);
            S.camera.x += (tx - S.camera.x) * 0.15;
            S.camera.y += (ty - S.camera.y) * 0.15;
            zoom = z2; cx = S.camera.x; cy = S.camera.y;
        } else { S.camera.x = 0; S.camera.y = 0; }

        ctx.setTransform(zoom, 0, 0, zoom, w / 2 - cx * zoom, h / 2 - cy * zoom);
        drawBackground(ctx, st, w, h);
        drawSegments(ctx, st);

        // discos que no son jugadores (pelota, postes...)
        const playerDiscs = new Set();
        room.players.forEach(p => { if (p.disc) playerDiscs.add(p.disc); });
        ctx.lineWidth = 2;
        for (const d of discs) {
            if (playerDiscs.has(d) || d.color < 0) continue;
            ctx.beginPath(); ctx.arc(d.pos.x, d.pos.y, d.radius, 0, Math.PI * 2);
            ctx.fillStyle = C.colorToCss(d.color); ctx.fill();
            ctx.strokeStyle = '#000'; ctx.stroke();
        }
        // jugadores
        const cache = {};
        for (const p of room.players) {
            if (!p.disc) continue;
            const tid = p.team.id;
            drawPlayerDisc(ctx, p, cache[tid] || (cache[tid] = teamColors(room, tid)));
        }

        // nombres (tamaño fijo en pantalla)
        if (S.showNames) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            const px = Math.max(11, Math.round(h * 0.028));
            ctx.font = `600 ${px}px sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            ctx.lineWidth = Math.max(2, px / 5); ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.fillStyle = '#fff';
            for (const p of room.players) {
                if (!p.disc) continue;
                const sx = (p.disc.pos.x - cx) * zoom + w / 2;
                const sy = (p.disc.pos.y - cy) * zoom + h / 2 + p.disc.radius * zoom + 2;
                ctx.strokeText(p.name, sx, sy); ctx.fillText(p.name, sx, sy);
            }
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    function frameLoop(now) {
        S.rafId = requestAnimationFrame(frameLoop);
        const reader = S.reader;
        if (!reader || !canvas) return;
        const f = reader.getCurrentFrameNo();

        if (S.needsRedraw || f !== S.lastDrawnFrame) {
            try { draw(); } catch (e) { console.error('Error al dibujar', e); }
            S.lastDrawnFrame = f;
            S.needsRedraw = false;
        }
        if (now - S.lastHud > 100) { S.lastHud = now; updateHud(f); }
        if (S.flashUntil && now > S.flashUntil) { S.flashUntil = 0; $('vz-flash').classList.remove('show'); }
    }

    function updateHud(f) {
        if (!S.dragging) $('vz-seek').value = f;
        $('vz-time-cur').textContent = C.formatTime(S.dragging ? +$('vz-seek').value : f);

        const gs = S.reader.gameState;
        if (gs) {
            S.lastScore = { red: gs.redScore, blue: gs.blueScore };
            $('vz-clock').textContent = C.formatSeconds(gs.timeElapsed);
        }
        $('vz-score-red').textContent = S.lastScore.red;
        $('vz-score-blue').textContent = S.lastScore.blue;

        // resalta el último mensaje del chat y lo mantiene a la vista
        const idx = C.lastIndexAtOrBefore(S.shown || [], f);
        if (idx !== S.lastChatIndex) {
            S.lastChatIndex = idx;
            const list = $('vz-chat-list');
            const prev = list.querySelector('.now');
            if (prev) prev.classList.remove('now');
            const el = idx >= 0 ? list.children[idx] : null;
            if (el) {
                el.classList.add('now');
                if (S.autoScroll && !S.dragging && $('tab-chat').classList.contains('active')) {
                    list.scrollTop = Math.max(0, el.offsetTop - list.clientHeight * 0.6);
                }
            }
        }
    }

    /* ---------- Chat, jugadores y goles ---------- */

    function renderMarkers() {
        const box = $('vz-markers');
        box.innerHTML = '';
        for (const g of S.goals) {
            const m = document.createElement('span');
            m.className = 'vz-marker ' + (g.teamId === 1 ? 'red' : 'blue');
            m.style.left = (g.f / Math.max(1, S.maxFrame) * 100) + '%';
            box.appendChild(m);
        }
    }

    function renderChat() {
        const list = $('vz-chat-list');
        const shown = C.filterMessages(S.messages, S.filterMode, S.query);
        S.shown = shown;
        S.lastChatIndex = -2;
        list.innerHTML = '';

        const frag = document.createDocumentFragment();
        for (const m of shown) {
            const li = document.createElement('li');
            if (m.type === 'sep') { li.className = 'vz-msg sep'; frag.appendChild(li); continue; }
            li.className = 'vz-msg ' + m.type;
            li.dataset.f = m.f;

            const t = document.createElement('button');
            t.type = 'button'; t.className = 'vz-time'; t.textContent = C.formatTime(m.f);
            t.title = 'Ir a este momento';
            li.appendChild(t);

            const body = document.createElement('span');
            body.className = 'vz-body';
            if (m.type === 'chat') {
                if (m.prefix) { const pre = document.createElement('span'); pre.className = 'vz-prefix'; pre.textContent = m.prefix + ' '; body.appendChild(pre); }
                if (m.rank) { const r = document.createElement('span'); r.className = 'vz-rank'; r.textContent = m.rank + ' '; body.appendChild(r); }
                const n = document.createElement('span');
                n.className = 'vz-name' + (m.team === 1 ? ' red' : m.team === 2 ? ' blue' : '');
                n.textContent = m.name + ': ';
                body.appendChild(n);
                const tx = document.createElement('span'); tx.className = 'vz-text'; tx.textContent = m.text; body.appendChild(tx);
            } else {
                body.textContent = m.text;
                if (m.color != null && m.color >= 0) body.style.color = C.colorToCss(m.color, true);
                if (m.style === 1 || m.style === 4) body.style.fontWeight = '700';
            }
            li.appendChild(body);
            frag.appendChild(li);
        }
        list.appendChild(frag);

        const chats = S.messages.filter(m => m.type === 'chat').length;
        const events = S.messages.filter(m => m.type === 'event').length;
        $('vz-chat-count').textContent = `${shown.filter(m => m.type !== 'sep').length} de ${chats + events} mensajes`;
        $('vz-chat-empty').classList.toggle('vz-hidden', shown.length > 0);
    }

    function renderPlayers() {
        const ul = $('vz-players-list');
        ul.innerHTML = '';
        const players = (S.scan.players || []).slice().sort((a, b) => (b.kicks - a.kicks) || a.name.localeCompare(b.name));
        for (const p of players) {
            const li = document.createElement('li');
            li.className = 'vz-player';
            const dot = document.createElement('span');
            const team = p.teams.length === 1 ? p.teams[0] : (p.team || 0);
            dot.className = 'vz-dot ' + (team === 1 ? 'red' : team === 2 ? 'blue' : 'spec');
            const name = document.createElement('span'); name.className = 'vz-pname'; name.textContent = p.name;
            const meta = document.createElement('span'); meta.className = 'vz-pmeta';
            const entry = p.firstFrame > 0 ? `Entró ${C.formatTime(p.firstFrame)}` : 'Desde el inicio';
            const exit = p.lastFrame != null ? ` · Salió ${C.formatTime(p.lastFrame)}` : '';
            meta.textContent = `${entry}${exit} · ${p.kicks} toques`;
            li.append(dot, name, meta);
            ul.appendChild(li);
        }
        $('vz-players-count').textContent = `${players.length} jugadores`;
    }

    function renderGoals() {
        const ul = $('vz-goals-list');
        ul.innerHTML = '';
        $('vz-goals-empty').classList.toggle('vz-hidden', S.goals.length > 0);
        S.goals.forEach((g, i) => {
            const li = document.createElement('li');
            li.className = 'vz-goal';
            const btn = document.createElement('button');
            btn.type = 'button'; btn.className = 'vz-goal-btn';
            const who = g.teamId === 1 ? S.teamNames.red : S.teamNames.blue;
            const score = g.red != null ? `${g.red} - ${g.blue}` : '';
            btn.innerHTML = '<span class="vz-dot ' + (g.teamId === 1 ? 'red' : 'blue') + '"></span>';
            const t = document.createElement('span'); t.className = 'vz-goal-text';
            const strong = document.createElement('strong'); strong.textContent = `Gol ${i + 1} · ${who}`;
            const sub = document.createElement('small'); sub.textContent = g.text || '';
            t.append(strong, sub);
            const meta = document.createElement('span'); meta.className = 'vz-goal-meta'; meta.textContent = `${C.formatTime(g.f)}${score ? '  ·  ' + score : ''}`;
            btn.append(t, meta);
            btn.addEventListener('click', () => seekTo(g.f - 3 * C.FPS, true));
            li.appendChild(btn);
            ul.appendChild(li);
        });
    }

    function switchTab(name) {
        document.querySelectorAll('#vz-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
        document.querySelectorAll('#vz-viewer .tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + name));
        if (name === 'chat') S.lastChatIndex = -2;
    }

    /* ---------- Descargar / copiar chat ---------- */

    function chatTextForExport() {
        // Se exporta lo que se está viendo (respeta el filtro y la búsqueda)
        return C.buildChatText(S.shown || [], S.title);
    }

    function downloadChat() {
        const blob = new Blob(['﻿' + chatTextForExport()], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        const slug = (S.fileName || S.title || 'repeticion').replace(/[^\w\-.áéíóúñÁÉÍÓÚÑ ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'repeticion';
        a.href = URL.createObjectURL(blob);
        a.download = `chat-${slug}.txt`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }

    async function copyText(text, button, okLabel) {
        const original = button.innerHTML;
        try {
            await navigator.clipboard.writeText(text);
        } catch (e) {
            const ta = document.createElement('textarea');
            ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); } catch (e2) { /* sin soporte */ }
            ta.remove();
        }
        button.innerHTML = `<i class="fa-solid fa-check"></i> ${okLabel}`;
        setTimeout(() => { button.innerHTML = original; }, 1800);
    }

    /* ---------- Eventos ---------- */

    function bind() {
        const drop = $('vz-drop'), file = $('vz-file');
        drop.addEventListener('click', () => file.click());
        drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
        file.addEventListener('change', () => loadFromFile(file.files[0]));
        ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
        ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
        drop.addEventListener('drop', (e) => loadFromFile(e.dataTransfer.files[0]));
        // soltar el archivo en cualquier parte de la página
        window.addEventListener('dragover', (e) => e.preventDefault());
        window.addEventListener('drop', (e) => { if (e.target !== drop && !drop.contains(e.target)) { e.preventDefault(); if (e.dataTransfer.files[0]) loadFromFile(e.dataTransfer.files[0]); } });

        $('vz-url-go').addEventListener('click', () => { const v = $('vz-url').value.trim(); if (v) loadFromUrl(v); });
        $('vz-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('vz-url-go').click(); });
        $('vz-back').addEventListener('click', backToLoader);
        $('vz-copy-link').addEventListener('click', (e) => {
            const link = location.origin + location.pathname + '?replay=' + encodeURIComponent(S.sourceUrl);
            copyText(link, e.currentTarget, 'Enlace copiado');
        });

        $('vz-play').addEventListener('click', () => setPlaying(!S.playing));
        $('vz-canvas').addEventListener('click', () => setPlaying(!S.playing));
        $('vz-back10').addEventListener('click', () => seekTo(currentFrame() - 10 * C.FPS));
        $('vz-fwd10').addEventListener('click', () => seekTo(currentFrame() + 10 * C.FPS));
        $('vz-speed').addEventListener('change', (e) => setSpeed(parseFloat(e.target.value)));

        const seek = $('vz-seek');
        seek.addEventListener('input', () => { S.dragging = true; $('vz-time-cur').textContent = C.formatTime(+seek.value); });
        seek.addEventListener('change', () => { S.dragging = false; seekTo(+seek.value); });

        $('vz-follow').addEventListener('click', (e) => { S.followBall = !S.followBall; e.currentTarget.classList.toggle('on', S.followBall); S.needsRedraw = true; });
        $('vz-names').addEventListener('click', (e) => { S.showNames = !S.showNames; e.currentTarget.classList.toggle('on', S.showNames); S.needsRedraw = true; });
        $('vz-fullscreen').addEventListener('click', () => {
            const stage = $('vz-stage');
            if (document.fullscreenElement) document.exitFullscreen();
            else if (stage.requestFullscreen) stage.requestFullscreen();
        });
        document.addEventListener('fullscreenchange', () => { S.needsRedraw = true; });

        document.querySelectorAll('#vz-tabs .tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

        document.querySelectorAll('#vz-chat-filters .filter-btn').forEach(b => b.addEventListener('click', () => {
            document.querySelectorAll('#vz-chat-filters .filter-btn').forEach(x => x.classList.toggle('active', x === b));
            S.filterMode = b.dataset.mode; renderChat();
        }));
        let searchTimer;
        $('vz-chat-search').addEventListener('input', (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { S.query = e.target.value; renderChat(); }, 180); });
        $('vz-chat-list').addEventListener('click', (e) => {
            const li = e.target.closest('li.vz-msg');
            if (li && li.dataset.f != null) seekTo(+li.dataset.f, true);
        });
        $('vz-autoscroll').addEventListener('change', (e) => { S.autoScroll = e.target.checked; });
        $('vz-chat-download').addEventListener('click', downloadChat);
        $('vz-chat-copy').addEventListener('click', (e) => copyText(chatTextForExport(), e.currentTarget, 'Copiado'));

        document.addEventListener('keydown', (e) => {
            if (!S.reader || e.target.matches('input, textarea, select')) return;
            if (e.code === 'Space') { e.preventDefault(); setPlaying(!S.playing); }
            else if (e.code === 'ArrowLeft') { e.preventDefault(); seekTo(currentFrame() - 5 * C.FPS); }
            else if (e.code === 'ArrowRight') { e.preventDefault(); seekTo(currentFrame() + 5 * C.FPS); }
        });
        document.addEventListener('visibilitychange', () => {
            // no gasta batería con la pestaña oculta
            if (!S.reader || S.seeking) return;
            S.reader.setSpeed(document.hidden ? 0 : (S.playing ? S.speed : 0));
        });
    }

    function init() {
        bind();
        const q = new URLSearchParams(location.search).get('replay');
        if (q) { $('vz-url').value = q; loadFromUrl(q); }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
