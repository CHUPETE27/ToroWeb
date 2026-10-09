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

    // "transparent" en HaxBall es -1; en las repeticiones queda guardado como 0xFFFFFFFF (4294967295), así que
    // cualquier valor fuera de 0..0xFFFFFF significa "sin color".
    function isTransparentColor(n) {
        return typeof n !== 'number' || !isFinite(n) || n < 0 || n > 0xFFFFFF;
    }

    // Número de color de HaxBall -> "#rrggbb". Con `legible` aclara los colores muy oscuros para fondos oscuros.
    function colorToCss(n, legible) {
        if (isTransparentColor(n)) return legible ? '#e8e8e8' : 'transparent';
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

    /* ---- Cancha ---- */

    // Medio ancho/alto de la cancha, tomado de las líneas visibles del mapa. Se descartan los puntos que quedan
    // fuera de los límites físicos (planos): los mapas guardan elementos "estacionados" muy lejos (por ejemplo las
    // barreras de saque en y = -2000) y, si se contaran, la cancha se vería diminuta.
    function fieldExtent(st) {
        // x >= d (normal 1,0) | x <= -d (normal -1,0) | y >= d (normal 0,1) | y <= -d (normal 0,-1)
        const loX = [], hiX = [], loY = [], hiY = [];
        for (const p of st.planes || []) {
            const n = p && p.normal;
            if (!n || typeof p.dist !== 'number') continue;
            const nx = n.x !== undefined ? n.x : n[0], ny = n.y !== undefined ? n.y : n[1];
            const near = (a, b) => Math.abs(a - b) < 1e-6;
            if (near(nx, 1) && near(ny, 0)) loX.push(p.dist);
            else if (near(nx, -1) && near(ny, 0)) hiX.push(-p.dist);
            else if (near(nx, 0) && near(ny, 1)) loY.push(p.dist);
            else if (near(nx, 0) && near(ny, -1)) hiY.push(-p.dist);
        }
        // con varios planos por lado (jugadores / pelota) vale el más amplio
        const minX = loX.length ? Math.min(...loX) : -Infinity, maxX = hiX.length ? Math.max(...hiX) : Infinity;
        const minY = loY.length ? Math.min(...loY) : -Infinity, maxY = hiY.length ? Math.max(...hiY) : Infinity;
        const tol = 5;

        let hw = st.bgWidth > 0 ? st.bgWidth : 0, hh = st.bgHeight > 0 ? st.bgHeight : 0;
        for (const s of st.segments) {
            if (!s.vis || isTransparentColor(s.color)) continue;
            for (const v of [s.v0.pos, s.v1.pos]) {
                if (v.x < minX - tol || v.x > maxX + tol || v.y < minY - tol || v.y > maxY + tol) continue;
                if (Math.abs(v.x) > hw) hw = Math.abs(v.x);
                if (Math.abs(v.y) > hh) hh = Math.abs(v.y);
            }
        }
        if (!(hw > 0)) hw = isFinite(maxX) ? Math.max(Math.abs(minX), Math.abs(maxX)) : (st.width || 400);
        if (!(hh > 0)) hh = isFinite(maxY) ? Math.max(Math.abs(minY), Math.abs(maxY)) : (st.height || 200);
        return { hw, hh };
    }

    /* ---- Chat ---- */

    // Línea de chat reenviada por el host:  "(🦙1️⃣) [👤16866] Nombre: mensaje"  (el rango y el emoji inicial son opcionales).
    // Según la versión de la sala, el ícono dentro de los corchetes cambia (👤, 👑, 🌼, 🥑...): "[🌼 7151]".
    // Sin ícono ("[16040]: Fulano se retiró") es un aviso de la sala, no un mensaje.
    const CHAT_LINE_RE = /^(?:(?<pre>[^\[(]*?)\s*)?(?:\((?<rank>[^)]*)\)\s*)?\[(?<icon>[^\d\[\]]+?)\s*(?<uid>\d+)\]\s*(?<name>.+?):\s(?<msg>[\s\S]*)$/;
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

    // Nombres de los equipos (rojo, azul) a partir de los anuncios del host. Varía según la versión de la sala:
    //   "📊 Qatar 🆚 España"  |  "⚽ Partido: D. La Serena vs Barnechea"  |  "📊 Qatar | 0 - 4 | España" (marcador tras un gol)
    const TEAM_NAME_PATTERNS = [
        /📊\s*(.+?)\s*🆚\s*(.+)$/,
        /Partido:\s*(.+?)\s+vs\.?\s+(.+)$/i,
        /^📊\s*(.+?)\s*\|\s*\d+\s*-\s*\d+\s*\|\s*(.+)$/
    ];
    function extractTeamNames(messages) {
        for (const re of TEAM_NAME_PATTERNS) {
            for (const m of messages) {
                if (m.type !== 'event') continue;
                const r = re.exec(m.text);
                if (r && r[1].trim() && r[2].trim()) return { red: r[1].trim(), blue: r[2].trim() };
            }
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

    /* ---- Grabación del partido ---- */

    // Mientras se analiza el archivo, el lector simula el partido cuadro por cuadro. Aquí se guarda lo necesario para
    // dibujar cada cuadro (posiciones de los discos, marcador, reloj, quién patea) y así la reproducción no simula nada:
    // saltar adelante o atrás es instantáneo y no hay que "volver a cargar" la repetición.
    //
    // Lo que casi nunca cambia (mapa, radios y colores de los discos, jugadores con su equipo y avatar, colores de las
    // camisetas) se guarda en "épocas": una nueva época empieza solo cuando algo de eso cambia.
    const MAX_EPOCHS = 20000;

    function snapshotTeamColors(room) {
        const out = {};
        for (const tid of [1, 2]) {
            const tc = room.teamColors && room.teamColors[tid];
            out[tid] = tc ? { inner: Array.from(tc.inner || []), angle: tc.angle, text: tc.text } : null;
        }
        return out;
    }

    function sameTeamColors(snap, room) {
        for (const tid of [1, 2]) {
            const a = snap[tid], tc = room.teamColors && room.teamColors[tid];
            if (!a || !tc) { if (!!a !== !!tc) return false; continue; }
            if (a.angle !== tc.angle || a.text !== tc.text) return false;
            const inner = tc.inner || [];
            if (a.inner.length !== inner.length) return false;
            for (let i = 0; i < inner.length; i++) if (a.inner[i] !== inner[i]) return false;
        }
        return true;
    }

    // Texto que se dibuja sobre el disco de un jugador (avatar fijado por la sala > avatar propio > número)
    function playerLabel(p) {
        const v = p.headlessAvatar != null ? p.headlessAvatar : (p.avatar != null ? p.avatar : p.avatarNumber);
        return v == null ? '' : String(v);
    }

    function createRecorder(reader, totalFrames) {
        const cap = Math.max(2, totalFrames + 2);
        const epochOf = new Uint32Array(cap), posOff = new Uint32Array(cap);
        const red = new Uint16Array(cap), blue = new Uint16Array(cap), elapsed = new Float32Array(cap);
        const kickLo = new Uint32Array(cap), kickHi = new Uint32Array(cap);
        let pos = new Float32Array(1 << 16), posLen = 0;
        const epochs = [];
        let count = 0, warned = false;

        function matches(ep, gs, room) {
            if (!gs) return ep.stadium === null;
            if (ep.stadium !== gs.stadium) return false;
            const discs = gs.physicsState.discs;
            if (discs.length !== ep.discCount) return false;
            for (let i = 0; i < discs.length; i++) if (discs[i].radius !== ep.discRadius[i] || discs[i].color !== ep.discColor[i]) return false;
            const rows = ep.players;
            let k = 0;
            const list = room.players;
            for (let i = 0; i < list.length; i++) {
                const p = list[i];
                if (!p.disc) continue;
                const r = rows[k++];
                if (!r || r.ref !== p || r.disc !== p.disc || r.teamId !== (p.team ? p.team.id : 0) || r.name !== p.name ||
                    r.avatar !== p.avatar || r.hAvatar !== p.headlessAvatar || r.avNum !== p.avatarNumber) return false;
            }
            return k === rows.length && sameTeamColors(ep.teamColors, room);
        }

        function makeEpoch(f0, gs, room) {
            const ep = { f0, stadium: gs ? gs.stadium : null, discCount: 0, discRadius: [], discColor: [], players: [], teamColors: snapshotTeamColors(room) };
            if (!gs) return ep;
            const discs = gs.physicsState.discs;
            ep.discCount = discs.length;
            for (const d of discs) { ep.discRadius.push(d.radius); ep.discColor.push(d.color); }
            for (const p of room.players) {
                if (!p.disc) continue;
                ep.players.push({
                    ref: p, disc: p.disc, discIdx: discs.indexOf(p.disc), id: p.id, name: p.name, teamId: p.team ? p.team.id : 0,
                    avatar: p.avatar, hAvatar: p.headlessAvatar, avNum: p.avatarNumber, label: playerLabel(p)
                });
            }
            return ep;
        }

        function capture() {
            const f = count;
            if (f >= cap) return;
            const gs = reader.gameState, room = reader.state;
            let ep = epochs[epochs.length - 1];
            if (!ep || (epochs.length < MAX_EPOCHS && !matches(ep, gs, room))) {
                ep = makeEpoch(f, gs, room);
                epochs.push(ep);
            } else if (epochs.length >= MAX_EPOCHS && !warned) { warned = true; console.warn('Visor: demasiados cambios de estado; se deja de registrar metadatos nuevos.'); }
            epochOf[f] = epochs.length - 1;
            posOff[f] = posLen;
            if (gs && ep.stadium) {
                const discs = gs.physicsState.discs, n = Math.min(discs.length, ep.discCount);
                if (posLen + n * 2 > pos.length) { const bigger = new Float32Array(Math.max(pos.length * 2, posLen + n * 2)); bigger.set(pos); pos = bigger; }
                for (let i = 0; i < n; i++) { const p = discs[i].pos; pos[posLen++] = p.x; pos[posLen++] = p.y; }
                red[f] = gs.redScore; blue[f] = gs.blueScore; elapsed[f] = gs.timeElapsed;
                let lo = 0, hi = 0;
                const rows = ep.players;
                for (let i = 0; i < rows.length && i < 64; i++) {
                    if (!rows[i].ref.isKicking) continue;
                    if (i < 32) lo |= (1 << i); else hi |= (1 << (i - 32));
                }
                kickLo[f] = lo >>> 0; kickHi[f] = hi >>> 0;
            }
            count++;
        }

        function finish() {
            // las referencias a los objetos vivos del lector solo servían para detectar cambios mientras se grababa
            for (const ep of epochs) for (const p of ep.players) { p.ref = null; p.disc = null; }
            return {
                frames: count,
                epochs, epochOf: epochOf.subarray(0, count), posOff: posOff.subarray(0, count), pos: pos.subarray(0, posLen),
                red: red.subarray(0, count), blue: blue.subarray(0, count), elapsed: elapsed.subarray(0, count),
                kickLo: kickLo.subarray(0, count), kickHi: kickHi.subarray(0, count)
            };
        }

        return { capture, finish, get count() { return count; } };
    }

    // Datos de un cuadro de la grabación. `kicking(i)` dice si el jugador i de la época está pateando.
    function recordedFrame(rec, f) {
        f = Math.max(0, Math.min(rec.frames - 1, f | 0));
        const epoch = rec.epochs[rec.epochOf[f]];
        const off = rec.posOff[f];
        return {
            f, epoch, pos: rec.pos, off, discCount: epoch.stadium ? epoch.discCount : 0,
            red: rec.red[f], blue: rec.blue[f], elapsed: rec.elapsed[f],
            kicking: (i) => i < 32 ? ((rec.kickLo[f] >>> i) & 1) === 1 : ((rec.kickHi[f] >>> (i - 32)) & 1) === 1
        };
    }

    // Recorre la repetición a toda velocidad y recoge chat/anuncios, jugadores y estadísticas simples.
    // `API` es el objeto devuelto por abcHaxballAPI(window). Devuelve una promesa.
    // Con `options.record` también devuelve `recording`: el partido grabado cuadro por cuadro (ver createRecorder).
    function scanReplay(API, bytes, options) {
        const onProgress = (options && options.onProgress) || function () {};
        const timeoutMs = (options && options.timeoutMs) || 180000;
        const { Replay } = API;

        return new Promise((resolve, reject) => {
            const raw = [];
            const players = new Map();
            const kicks = new Map();
            let stadiumName = null;
            let reader = null, progressTimer = null, killTimer = null, done = false, recorder = null, hookedState = null;
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
                if (hookedState) { try { delete hookedState.nM; } catch (e) { /* sin gancho */ } }
                try { reader && reader.destroy(); } catch (e) { /* ya liberado */ }
                scheduler.dispose();
            };
            const finish = () => {
                if (done) return;
                done = true;
                const maxFrame = reader.maxFrameNo;
                const list = Array.from(players.values()).map(p => Object.assign({}, p, { teams: Array.from(p.teams), kicks: kicks.get(p.id) || 0 }));
                const recording = recorder ? recorder.finish() : null;
                cleanup();
                if (recording && recording.frames !== maxFrame + 1) {
                    reject(new Error(`La grabación quedó incompleta (${recording.frames} de ${maxFrame + 1} cuadros).`));
                    return;
                }
                raw.sort((a, b) => a.f - b.f);   // estable: conserva el orden de llegada dentro del mismo cuadro
                resolve({ raw, players: list, stadiumName, maxFrame, recording });
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

            if (options && options.record) {
                // El lector avanza el estado con state.nM(1) una vez por cuadro: se engancha ahí para grabar cada cuadro
                const room = reader.state, original = room.nM;
                if (typeof original !== 'function') { cleanup(); done = true; reject(new Error('Esta versión de la librería no permite grabar el partido.')); return; }
                recorder = createRecorder(reader, reader.maxFrameNo);
                room.nM = function (n) {
                    const r = original.apply(this, arguments);
                    if (n === 1) recorder.capture();
                    return r;
                };
                hookedState = room;
                recorder.capture();   // cuadro 0
            }

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
        formatTime, formatSeconds, colorToCss, isTransparentColor, shadeColor, fieldExtent,
        parseAnnouncement, extractTeamNames, filterMessages, buildChatText, lastIndexAtOrBefore, describeGoal,
        looksLikeReplay, scanReplay, buildMessages, recordedFrame
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
        title: '',
        sourceUrl: null,
        scan: null,
        rec: null,            // el partido grabado cuadro por cuadro (VisorCore.scanReplay con record)
        messages: [],
        goals: [],            // [{ f, teamId, text }]
        teamNames: { red: 'Rojo', blue: 'Azul' },
        maxFrame: 0,
        cursor: 0,            // cuadro actual (con decimales mientras se reproduce)
        lastTs: 0,
        speed: 1,
        playing: false,
        followBall: false,
        showNames: true,
        autoScroll: true,
        query: '',
        busy: false,          // hay una carga en curso
        fs: false,            // pantalla completa (nativa o simulada)
        fsHistory: false,     // se agregó una entrada al historial para que "atrás" salga de la pantalla completa
        fsMarkers: {},
        uiTimer: 0,
        uiWasHidden: false,
        lastScore: { red: 0, blue: 0 },
        lastChatIndex: -2,
        needsRedraw: true,
        lastDrawn: -1,
        lastHud: 0,
        camera: { x: 0, y: 0 },
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

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    /* ---------- Pantalla de carga ---------- */

    // Tramo de la barra que ocupa cada paso (el análisis es lo más lento)
    const LOAD_STEPS = { read: [0, 0.08], scan: [0.08, 0.9], prep: [0.9, 1] };
    const MIN_LOADING_MS = 600;   // evita un parpadeo si el archivo es muy pequeño
    let loadingSince = 0;

    // Espera a que el navegador pinte antes de seguir con trabajo pesado (con la pestaña oculta no hay pintado: no se bloquea)
    function nextPaint() {
        return new Promise((resolve) => {
            let done = false;
            const fin = () => { if (!done) { done = true; resolve(); } };
            requestAnimationFrame(() => setTimeout(fin, 0));
            setTimeout(fin, 80);
        });
    }

    function beginLoading(fileLabel, readLabel) {
        S.busy = true;
        loadingSince = performance.now();
        exitFullscreen();
        stopPlayer();
        showError('');
        $('vz-loading-file').textContent = fileLabel || '';
        $('vz-step-read-label').textContent = readLabel;
        show($('vz-load'), false);
        show($('vz-viewer'), false);
        show($('vz-loading'), true);
        setLoadStep('read', 0);
        const box = $('vz-loading').getBoundingClientRect();
        if (box.top < 0 || box.bottom > window.innerHeight) $('vz-loading').scrollIntoView({ block: 'center' });
    }

    function setLoadStep(step, fraction) {
        const names = Object.keys(LOAD_STEPS), idx = names.indexOf(step);
        document.querySelectorAll('#vz-steps li').forEach((li, i) => { li.className = i < idx ? 'done' : (i === idx ? 'active' : 'pending'); });
        const [a, b] = LOAD_STEPS[step];
        const pct = Math.round((a + (b - a) * clamp(fraction || 0, 0, 1)) * 100);
        $('vz-progress-bar').style.width = pct + '%';
        $('vz-progress-text').textContent = pct + '%';
    }

    async function waitMinLoading() {
        const left = MIN_LOADING_MS - (performance.now() - loadingSince);
        if (left > 0) await new Promise(r => setTimeout(r, left));
    }

    function endLoading() {
        S.busy = false;
        show($('vz-loading'), false);
    }

    // La carga falló: se vuelve a la pantalla inicial con el mensaje
    function failLoading(message) {
        endLoading();
        show($('vz-viewer'), false);
        show($('vz-load'), true);
        showError(message);
    }

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
        if (!file || S.busy) return;
        showError('');
        if (file.size > C.MAX_REPLAY_BYTES) return showError('El archivo es demasiado grande (máximo 30 MB).');
        beginLoading(file.name, 'Leyendo el archivo');
        await nextPaint();
        let buf;
        try { buf = new Uint8Array(await file.arrayBuffer()); }
        catch (e) { return failLoading('No se pudo leer el archivo. Vuelve a elegirlo.'); }
        S.sourceUrl = null;
        await loadFromBytes(buf, file.name.replace(/\.hbr2$/i, ''));
    }

    async function loadFromUrl(url) {
        if (S.busy) return;
        showError('');
        let parsed;
        try { parsed = new URL(url, location.href); } catch (e) { return showError('El enlace no es válido.'); }
        if (!/^https?:$/.test(parsed.protocol)) return showError('Solo se permiten enlaces http o https.');
        const last = decodeURIComponent(parsed.pathname.split('/').pop() || 'repetición');
        beginLoading(last, 'Descargando la repetición');
        await nextPaint();
        let buf;
        try {
            const res = await fetch(parsed.href);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            buf = new Uint8Array(await res.arrayBuffer());
        } catch (e) {
            return failLoading('No se pudo descargar el archivo desde ese enlace (puede haber expirado o no permitir descargas desde otras páginas). Descárgalo y súbelo manualmente.');
        }
        if (buf.length > C.MAX_REPLAY_BYTES) return failLoading('El archivo es demasiado grande (máximo 30 MB).');
        S.sourceUrl = parsed.href;
        await loadFromBytes(buf, last.replace(/\.hbr2$/i, ''));
    }

    async function loadFromBytes(bytes, name) {
        if (!S.busy) beginLoading(name, 'Leyendo el archivo');
        if (!C.looksLikeReplay(bytes)) return failLoading('Ese archivo no parece una repetición de HaxBall (.hbr2).');
        try {
            const API = ensureAPI();
            stopPlayer();
            setLoadStep('scan', 0);
            await nextPaint();

            // Marcadores de gol y duración: lectura instantánea, sin simular el partido
            const data = API.Replay.readAll(bytes);
            // El marcador del archivo guarda el equipo que RECIBIÓ el gol; aquí se guarda el que lo anotó
            const goalMarkers = (data.goalMarkers || []).map(g => ({ f: g.frameNo, teamId: g.teamId === 1 ? 2 : 1 }));

            const scan = await C.scanReplay(API, bytes, { onProgress: (p) => setLoadStep('scan', p), record: true });
            setLoadStep('prep', 0);
            await nextPaint();
            const messages = C.buildMessages(scan.raw);

            S.scan = scan;
            S.rec = scan.recording;
            S.messages = messages;
            S.maxFrame = S.rec.frames - 1;
            S.teamNames = C.extractTeamNames(messages) || { red: 'Rojo', blue: 'Azul' };
            S.goals = goalMarkers.map(g => {
                const d = C.describeGoal(messages, g.f);
                return { f: g.f, teamId: g.teamId, text: d && d.description, red: d && d.red, blue: d && d.blue };
            });
            S.title = C.extractTeamNames(messages) ? `${S.teamNames.red} vs ${S.teamNames.blue}` : name;
            S.fileName = name;
            S.lastScore = { red: 0, blue: 0 };
            S.lastChatIndex = -2;
            S.camera = { x: 0, y: 0 };
            S.query = '';
            $('vz-chat-search').value = '';

            await waitMinLoading();
            showViewer();
            endLoading();
        } catch (e) {
            console.error('Error al abrir la repetición:', e);
            stopPlayer();
            failLoading('No se pudo abrir la repetición. El archivo puede estar dañado o ser de una versión no compatible.');
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
        startPlayer();
    }

    function backToLoader() {
        exitFullscreen();
        stopPlayer();
        S.rec = null; S.scan = null; S.messages = []; S.goals = [];
        show($('vz-viewer'), false);
        show($('vz-load'), true);
        showError('');
        $('vz-file').value = '';
    }

    /* ---------- Reproductor ---------- */
    // La repetición ya quedó grabada cuadro por cuadro durante el análisis (VisorCore.scanReplay). Reproducir es recorrer
    // esa grabación con un reloj propio, así que saltar a cualquier momento, adelante o atrás, es instantáneo.

    const FRAMES_PER_MS = C.FPS / 1000;

    function startPlayer() {
        S.cursor = 0;
        S.lastTs = 0;
        S.lastDrawn = -1;
        S.flashUntil = 0;
        S.playing = true;
        syncPlayButton();
        S.needsRedraw = true;
        cancelAnimationFrame(S.rafId);
        S.rafId = requestAnimationFrame(frameLoop);
    }

    function stopPlayer() {
        cancelAnimationFrame(S.rafId);
        S.playing = false;
    }

    function currentFrame() { return Math.floor(S.cursor); }

    function setPlaying(playing) {
        if (!S.rec) return;
        if (playing && S.cursor >= S.maxFrame) seekTo(0);
        S.playing = playing;
        syncPlayButton();
        if (S.fs) showUi();
    }

    function syncPlayButton() {
        const b = $('vz-play');
        b.innerHTML = S.playing ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
        b.setAttribute('aria-label', S.playing ? 'Pausar' : 'Reproducir');
        b.title = S.playing ? 'Pausar (espacio)' : 'Reproducir (espacio)';
    }

    function setSpeed(v) { S.speed = v; }

    // Salta a un cuadro. Si estaba reproduciendo, continúa; si estaba en pausa, queda en pausa (salvo forcePlay).
    function seekTo(frame, forcePlay) {
        if (!S.rec) return;
        S.cursor = clamp(Math.round(frame), 0, S.maxFrame);
        if (forcePlay && !S.playing) { S.playing = true; syncPlayButton(); }
        S.needsRedraw = true;
        S.lastChatIndex = -2;
        S.flashUntil = 0;
        $('vz-flash').classList.remove('show');
        updateHud(currentFrame());
    }

    /* ---------- Dibujo ---------- */

    function setupCanvas() {
        canvas = $('vz-canvas');
        ctx = canvas.getContext('2d', { alpha: false });
        if (resizeObs) resizeObs.disconnect();
        const resize = () => {
            // clientWidth/Height (no getBoundingClientRect): ignoran el giro de la pantalla completa en celulares verticales
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const w = Math.max(2, Math.round(canvas.clientWidth * dpr)), h = Math.max(2, Math.round(canvas.clientHeight * dpr));
            if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; S.needsRedraw = true; }
        };
        resizeObs = new ResizeObserver(resize);
        resizeObs.observe(canvas);
        resize();
    }

    function teamColors(ep, teamId) {
        const cache = ep.colorCache || (ep.colorCache = {});
        if (cache[teamId]) return cache[teamId];
        const tc = ep.teamColors[teamId];
        const inner = tc && tc.inner.length ? tc.inner : [C.DEFAULT_TEAM_COLORS[teamId] || 0xffffff];
        return (cache[teamId] = { inner, angle: tc ? tc.angle : 0, text: tc && typeof tc.text === 'number' ? tc.text : 0xffffff });
    }

    function drawPlayerDisc(g, x, y, r, label, colors, kicking) {
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
        g.strokeStyle = kicking ? '#ffffff' : '#000000';
        g.stroke();

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
            if (!s.vis || C.isTransparentColor(s.color)) continue;
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

    // Medio ancho/alto de la cancha real (no del "tamaño de cámara" del mapa, que suele traer mucho margen)
    const boundsCache = new WeakMap();
    function stadiumHalfExtent(st) {
        let b = boundsCache.get(st);
        if (!b) { b = C.fieldExtent(st); boundsCache.set(st, b); }
        return b;
    }

    // Posiciones del cuadro actual (se mezclan con el siguiente cuadro para que la cámara lenta y las pantallas de 120 Hz se vean fluidas)
    const cur = { x: new Float64Array(64), y: new Float64Array(64) };

    function draw() {
        const rec = S.rec, w = canvas.width, h = canvas.height;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const f = Math.min(Math.floor(S.cursor), rec.frames - 1), frac = S.cursor - f;
        const ep = rec.epochs[rec.epochOf[f]];

        if (!ep.stadium) {
            ctx.fillStyle = '#0a2a2e'; ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#7d7d7d'; ctx.font = `${Math.round(h * 0.05)}px sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('Esperando el inicio del partido…', w / 2, h / 2);
            return;
        }

        const n = ep.discCount, pos = rec.pos, off = rec.posOff[f];
        const next = (frac > 0 && f + 1 < rec.frames && rec.epochOf[f + 1] === rec.epochOf[f]) ? rec.posOff[f + 1] : -1;
        if (cur.x.length < n) { cur.x = new Float64Array(n); cur.y = new Float64Array(n); }
        for (let i = 0; i < n; i++) {
            let x = pos[off + 2 * i], y = pos[off + 2 * i + 1];
            if (next >= 0) {
                const nx = pos[next + 2 * i], ny = pos[next + 2 * i + 1];
                if (Math.abs(nx - x) < 40 && Math.abs(ny - y) < 40) { x += (nx - x) * frac; y += (ny - y) * frac; }   // sin mezclar si fue un salto (saque, reinicio)
            }
            cur.x[i] = x; cur.y[i] = y;
        }

        const st = ep.stadium;
        const ext = stadiumHalfExtent(st);
        const fieldW = ext.hw * 1.05 + 25;
        const fieldH = ext.hh * 1.05 + 25;
        let zoom = Math.min(w / (2 * fieldW), h / (2 * fieldH));
        let cx = 0, cy = 0;

        if (S.followBall && n > 0) {
            const z2 = zoom * 2.2;
            const vw = w / z2 / 2, vh = h / z2 / 2;
            const tx = clamp(cur.x[0], -fieldW + vw, fieldW - vw);
            const ty = clamp(cur.y[0], -fieldH + vh, fieldH - vh);
            S.camera.x += (tx - S.camera.x) * 0.15;
            S.camera.y += (ty - S.camera.y) * 0.15;
            zoom = z2; cx = S.camera.x; cy = S.camera.y;
        } else { S.camera.x = 0; S.camera.y = 0; }

        ctx.setTransform(zoom, 0, 0, zoom, w / 2 - cx * zoom, h / 2 - cy * zoom);
        drawBackground(ctx, st, w, h);
        drawSegments(ctx, st);

        // discos que no son jugadores (pelota, postes...)
        if (!ep.playerDiscs) ep.playerDiscs = new Set(ep.players.map(p => p.discIdx));
        ctx.lineWidth = 2;
        for (let i = 0; i < n; i++) {
            if (ep.playerDiscs.has(i) || C.isTransparentColor(ep.discColor[i])) continue;   // las barreras de saque son transparentes: ni relleno ni borde
            ctx.beginPath(); ctx.arc(cur.x[i], cur.y[i], ep.discRadius[i], 0, Math.PI * 2);
            ctx.fillStyle = C.colorToCss(ep.discColor[i]); ctx.fill();
            ctx.strokeStyle = '#000'; ctx.stroke();
        }
        // jugadores
        const kLo = rec.kickLo[f], kHi = rec.kickHi[f];
        for (let k = 0; k < ep.players.length; k++) {
            const p = ep.players[k];
            if (p.discIdx < 0) continue;
            const kicking = k < 32 ? ((kLo >>> k) & 1) === 1 : (k < 64 && ((kHi >>> (k - 32)) & 1) === 1);
            drawPlayerDisc(ctx, cur.x[p.discIdx], cur.y[p.discIdx], ep.discRadius[p.discIdx], p.label, teamColors(ep, p.teamId), kicking);
        }

        // nombres (tamaño fijo en pantalla)
        if (S.showNames) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            const px = Math.max(11, Math.round(h * 0.028));
            ctx.font = `600 ${px}px sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            ctx.lineWidth = Math.max(2, px / 5); ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.fillStyle = '#fff';
            for (const p of ep.players) {
                if (p.discIdx < 0) continue;
                const sx = (cur.x[p.discIdx] - cx) * zoom + w / 2;
                const sy = (cur.y[p.discIdx] - cy) * zoom + h / 2 + ep.discRadius[p.discIdx] * zoom + 2;
                ctx.strokeText(p.name, sx, sy); ctx.fillText(p.name, sx, sy);
            }
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    function flashGoal(teamId) {
        const name = teamId === 1 ? S.teamNames.red : S.teamNames.blue;
        const flash = $('vz-flash');
        flash.textContent = `¡GOL DE ${String(name).toUpperCase()}!`;
        flash.className = 'vz-flash ' + (teamId === 1 ? 'red' : 'blue') + ' show';
        S.flashUntil = performance.now() + 2600;
    }

    function frameLoop(now) {
        S.rafId = requestAnimationFrame(frameLoop);
        if (!S.rec || !canvas) return;
        const dt = S.lastTs ? Math.min(now - S.lastTs, 100) : 0;   // tope: al volver de otra pestaña no se "recupera" el tiempo perdido
        S.lastTs = now;

        if (S.playing) {
            const prev = S.cursor;
            S.cursor = Math.min(S.maxFrame, S.cursor + dt * FRAMES_PER_MS * S.speed);
            for (const g of S.goals) { if (g.f > prev && g.f <= S.cursor) { flashGoal(g.teamId); break; } }
            if (S.cursor >= S.maxFrame) { S.playing = false; syncPlayButton(); if (S.fs) showUi(); }
        }

        if (S.needsRedraw || S.cursor !== S.lastDrawn) {
            try { draw(); } catch (e) { console.error('Error al dibujar', e); }
            S.lastDrawn = S.cursor;
            S.needsRedraw = false;
        }
        if (now - S.lastHud > 100) { S.lastHud = now; updateHud(currentFrame()); }
        if (S.flashUntil && now > S.flashUntil) { S.flashUntil = 0; $('vz-flash').classList.remove('show'); }
    }

    function updateHud(f) {
        $('vz-seek').value = f;
        $('vz-time-cur').textContent = C.formatTime(f);

        const d = C.recordedFrame(S.rec, f);
        if (d.epoch.stadium) {
            S.lastScore = { red: d.red, blue: d.blue };
            $('vz-clock').textContent = C.formatSeconds(d.elapsed);
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
                if (S.autoScroll && $('tab-chat').classList.contains('active')) {
                    list.scrollTop = Math.max(0, el.offsetTop - list.clientHeight * 0.6);
                }
            }
        }
    }

    /* ---------- Pantalla completa ---------- */
    // Se usa la pantalla completa del navegador si la permite; si no (iPhone, navegadores integrados de apps como Discord...)
    // el reproductor se agranda hasta cubrir toda la pantalla. En ambos casos el marcador y los controles pasan a ser una capa
    // sobre la cancha que se oculta sola mientras se reproduce y vuelve al tocar la pantalla.

    const FS_SLOTS = [['vz-scorebox', 'vz-fs-top'], ['vz-controls', 'vz-fs-bottom']];
    const UI_IDLE_MS = 3200;

    function nativeFullscreenElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }

    function syncFsButton() {
        const b = $('vz-fullscreen');
        b.innerHTML = S.fs ? '<i class="fa-solid fa-compress"></i>' : '<i class="fa-solid fa-expand"></i>';
        b.setAttribute('aria-label', S.fs ? 'Salir de pantalla completa' : 'Pantalla completa');
        b.title = S.fs ? 'Salir de pantalla completa (Esc)' : 'Pantalla completa (F)';
    }

    function enterFullscreen() {
        if (S.fs || !S.rec) return;
        const stage = $('vz-stage');
        for (const [id, slot] of FS_SLOTS) {
            const el = $(id), marker = document.createComment(id);
            el.parentNode.insertBefore(marker, el);
            S.fsMarkers[id] = marker;
            $(slot).appendChild(el);
        }
        stage.classList.add('vz-fs');
        document.documentElement.classList.add('vz-lock');
        S.fs = true;
        // el botón "atrás" del celular sale de la pantalla completa en vez de abandonar la página
        try { history.pushState({ vzFs: true }, ''); S.fsHistory = true; } catch (e) { S.fsHistory = false; }
        syncFsButton();
        const request = stage.requestFullscreen || stage.webkitRequestFullscreen;
        if (request) {
            try {
                const p = request.call(stage);
                if (p && p.catch) p.catch(() => { /* sin permiso: queda la pantalla completa simulada */ });
            } catch (e) { /* idem */ }
        }
        showUi();
        S.needsRedraw = true;
    }

    // Deja la interfaz como estaba (controles de vuelta en su lugar)
    function leaveFullscreenUi() {
        if (!S.fs) return;
        S.fs = false;
        clearTimeout(S.uiTimer);
        $('vz-stage').classList.remove('vz-fs', 'vz-ui-hidden');
        document.documentElement.classList.remove('vz-lock');
        for (const [id] of FS_SLOTS) {
            const marker = S.fsMarkers[id], el = $(id);
            if (marker && marker.parentNode) { marker.parentNode.insertBefore(el, marker); marker.remove(); }
        }
        S.fsMarkers = {};
        closeSelects();
        if (S.fsHistory) {
            S.fsHistory = false;
            try { if (history.state && history.state.vzFs) history.back(); } catch (e) { /* sin historial */ }
        }
        try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) { /* sin soporte */ }
        syncFsButton();
        S.needsRedraw = true;
    }

    function exitFullscreen() {
        if (!S.fs) return;
        if (nativeFullscreenElement()) {
            try {
                const p = (document.exitFullscreen || document.webkitExitFullscreen).call(document);
                if (p && p.catch) p.catch(() => {});
            } catch (e) { /* ya salió */ }
        }
        leaveFullscreenUi();
    }

    function toggleFullscreen() { if (S.fs) exitFullscreen(); else enterFullscreen(); }

    function onFullscreenChange() {
        if (nativeFullscreenElement() === $('vz-stage')) {
            // en Android, además de ocupar la pantalla, intenta dejarla horizontal
            try {
                const p = screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape');
                if (p && p.catch) p.catch(() => {});
            } catch (e) { /* sin soporte */ }
            S.needsRedraw = true;
        } else if (S.fs) {
            leaveFullscreenUi();   // salió con Esc o con el gesto del sistema
        }
    }

    function showUi() {
        $('vz-stage').classList.remove('vz-ui-hidden');
        clearTimeout(S.uiTimer);
        if (S.fs) S.uiTimer = setTimeout(hideUiIfIdle, UI_IDLE_MS);
    }

    function hideUiIfIdle() {
        if (!S.fs) return;
        const stage = $('vz-stage');
        // en pausa o con la lista de velocidades abierta los controles se quedan a la vista
        if (!S.playing || stage.querySelector('.custom-select-wrapper.open')) { S.uiTimer = setTimeout(hideUiIfIdle, UI_IDLE_MS); return; }
        stage.classList.add('vz-ui-hidden');
    }

    /* ---------- Lista desplegable (componente .custom-select-* de styles.css) ---------- */

    function closeSelects() {
        document.querySelectorAll('.custom-select-wrapper').forEach(w => w.classList.remove('open', 'open-up'));
    }

    function buildCustomSelect(select) {
        select.style.display = 'none';
        const wrapper = document.createElement('div');
        wrapper.className = 'custom-select-wrapper';
        const trigger = document.createElement('div');
        trigger.className = 'custom-select-trigger';
        trigger.tabIndex = 0;
        trigger.setAttribute('role', 'button');
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-label', select.getAttribute('aria-label') || '');
        trigger.innerHTML = '<span></span><i class="fa-solid fa-chevron-down"></i>';
        const options = document.createElement('div');
        options.className = 'custom-select-options';
        options.setAttribute('role', 'listbox');

        const choose = (index) => {
            select.selectedIndex = index;
            select.dispatchEvent(new Event('change'));
            render();
        };
        const render = () => {
            const chosen = select.options[select.selectedIndex];
            trigger.querySelector('span').textContent = chosen ? chosen.text : '';
            options.innerHTML = '';
            Array.from(select.options).forEach((option, index) => {
                const div = document.createElement('div');
                div.className = 'custom-option' + (index === select.selectedIndex ? ' selected' : '');
                div.setAttribute('role', 'option');
                div.textContent = option.text;
                div.addEventListener('click', (e) => { e.stopPropagation(); choose(index); wrapper.classList.remove('open', 'open-up'); });
                options.appendChild(div);
            });
        };
        render();
        wrapper.append(trigger, options);
        select.parentNode.insertBefore(wrapper, select.nextSibling);

        const toggle = () => {
            const wasOpen = wrapper.classList.contains('open');
            closeSelects();
            if (wasOpen) return;
            // abre hacia arriba cuando abajo no hay lugar; en pantalla completa los controles están abajo y la vista puede ir girada
            wrapper.classList.remove('open-up');
            const r = wrapper.getBoundingClientRect();
            const menuH = Math.min(options.scrollHeight, 250);
            if (S.fs || (window.innerHeight - r.bottom < menuH && r.top > window.innerHeight - r.bottom)) wrapper.classList.add('open-up');
            wrapper.classList.add('open');
            if (S.fs) showUi();
        };
        trigger.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
        trigger.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
            else if (e.key === 'Escape') wrapper.classList.remove('open', 'open-up');
            else if (e.key === 'ArrowDown' && select.selectedIndex < select.options.length - 1) { e.preventDefault(); choose(select.selectedIndex + 1); }
            else if (e.key === 'ArrowUp' && select.selectedIndex > 0) { e.preventDefault(); choose(select.selectedIndex - 1); }
        });
        document.addEventListener('click', () => wrapper.classList.remove('open', 'open-up'));
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
        const shown = C.filterMessages(S.messages, 'all', S.query);
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

        const total = S.messages.filter(m => m.type !== 'sep').length;
        const found = shown.filter(m => m.type !== 'sep').length;
        $('vz-chat-count').textContent = S.query.trim() ? `${found} de ${total} mensajes` : `${total} mensajes`;
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
        // Siempre el chat completo, aunque haya algo escrito en el buscador
        return C.buildChatText(S.messages, S.title);
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

        // El campo para pegar un enlace es opcional: si no está en la página, el resto funciona igual
        // (los enlaces con ?replay=... siguen cargando)
        const urlInput = $('vz-url'), urlGo = $('vz-url-go');
        if (urlInput && urlGo) {
            urlGo.addEventListener('click', () => { const v = urlInput.value.trim(); if (v) loadFromUrl(v); });
            urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') urlGo.click(); });
        }
        $('vz-back').addEventListener('click', backToLoader);
        $('vz-copy-link').addEventListener('click', (e) => {
            const link = location.origin + location.pathname + '?replay=' + encodeURIComponent(S.sourceUrl);
            copyText(link, e.currentTarget, 'Enlace copiado');
        });

        buildCustomSelect($('vz-speed'));
        $('vz-play').addEventListener('click', () => setPlaying(!S.playing));
        $('vz-back10').addEventListener('click', () => { seekTo(currentFrame() - 10 * C.FPS); if (S.fs) showUi(); });
        $('vz-fwd10').addEventListener('click', () => { seekTo(currentFrame() + 10 * C.FPS); if (S.fs) showUi(); });
        $('vz-speed').addEventListener('change', (e) => setSpeed(parseFloat(e.target.value)));

        // La barra mueve la repetición mientras se arrastra (el salto es instantáneo)
        $('vz-seek').addEventListener('input', (e) => { seekTo(+e.target.value); if (S.fs) showUi(); });

        $('vz-follow').addEventListener('click', (e) => { S.followBall = !S.followBall; e.currentTarget.classList.toggle('on', S.followBall); S.needsRedraw = true; if (S.fs) showUi(); });
        $('vz-names').addEventListener('click', (e) => { S.showNames = !S.showNames; e.currentTarget.classList.toggle('on', S.showNames); S.needsRedraw = true; if (S.fs) showUi(); });

        // Pantalla completa: en ella, un toque sobre la cancha muestra los controles; con los controles a la vista, pausa/reanuda
        $('vz-fullscreen').addEventListener('click', toggleFullscreen);
        $('vz-fs-exit').addEventListener('click', exitFullscreen);
        document.addEventListener('fullscreenchange', onFullscreenChange);
        document.addEventListener('webkitfullscreenchange', onFullscreenChange);
        window.addEventListener('popstate', () => { if (S.fs) { S.fsHistory = false; exitFullscreen(); } });
        const stage = $('vz-stage');
        stage.addEventListener('pointerdown', () => { S.uiWasHidden = stage.classList.contains('vz-ui-hidden'); if (S.fs) showUi(); }, true);
        stage.addEventListener('pointermove', () => { if (S.fs && stage.classList.contains('vz-ui-hidden')) showUi(); });
        $('vz-canvas').addEventListener('click', () => {
            if (S.fs && S.uiWasHidden) { S.uiWasHidden = false; return; }
            setPlaying(!S.playing);
        });

        document.querySelectorAll('#vz-tabs .tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

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
            if (!S.rec) return;
            if (e.code === 'Escape' && S.fs) { exitFullscreen(); return; }
            const t = e.target && e.target.closest ? e.target : null;
            if (e.ctrlKey || e.metaKey || e.altKey || (t && t.matches('input, textarea, select'))) return;
            if (e.code === 'Space') { if (t && t.closest('button, [role="button"]')) return; e.preventDefault(); setPlaying(!S.playing); }
            else if (e.code === 'ArrowLeft') { e.preventDefault(); seekTo(currentFrame() - 5 * C.FPS); if (S.fs) showUi(); }
            else if (e.code === 'ArrowRight') { e.preventDefault(); seekTo(currentFrame() + 5 * C.FPS); if (S.fs) showUi(); }
            else if (e.code === 'KeyF') { e.preventDefault(); toggleFullscreen(); }
        });
    }

    function init() {
        bind();
        const q = new URLSearchParams(location.search).get('replay');
        if (q) {
            const urlInput = $('vz-url');
            if (urlInput) urlInput.value = q;
            loadFromUrl(q);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
