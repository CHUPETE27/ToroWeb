/* =========================================================
   TOROHAX · RENDER DE CAMISETAS PERSONALIZADAS
   Una sola implementación para el motor del juego (preload.js la inyecta en game.html)
   y para el Taller del Owner (index.html). Formato de datos: CLAUDE.md 4.6.

   Espacio de dibujo: la textura de jugador de HaxBall, 64×64 px con el centro en (32,32)
   y radio 32. Las coordenadas x/y de las capas son relativas a ese centro.
   ========================================================= */
(function (raiz) {
    'use strict';

    const FUENTES = {
        clasica:   { nombre: 'Clásica HaxBall', css: "'Arial Black','Arial Bold',Gadget,sans-serif", peso: '900', ajuste: 1 },
        deportiva: { nombre: 'Deportiva', css: "'Bebas Neue',Impact,sans-serif", peso: '400', ajuste: 1.2 },
        arcade:    { nombre: 'Arcade', css: "'Press Start 2P',monospace", peso: '400', ajuste: 0.6 },
        bold:      { nombre: 'Bold', css: "Impact,'Arial Black',sans-serif", peso: '400', ajuste: 1 },
        serif:     { nombre: 'Serif', css: "Georgia,'Times New Roman',serif", peso: '700', ajuste: 1 },
        mono:      { nombre: 'Monoespaciada', css: "'Courier New',Consolas,monospace", peso: '700', ajuste: 1 },
        college:   { nombre: 'College', css: "Graduate,Rockwell,serif", peso: '400', ajuste: 0.9 },
        redonda:   { nombre: 'Redonda', css: "'Russo One','Arial Black',sans-serif", peso: '400', ajuste: 0.95 }
    };
    // Solo hojas de estilo y archivos de fuente (nada ejecutable)
    const URL_FUENTES = 'https://fonts.googleapis.com/css2?family=Anton&family=Bebas+Neue&family=Graduate&family=Press+Start+2P&family=Russo+One&display=swap';

    // Cualquier familia de Google Fonts por su nombre (va a una URL y a CSS: solo letras, números y espacios)
    const FUENTE_GOOGLE = /^[A-Za-z0-9][A-Za-z0-9 ]{0,39}$/;

    const FORMAS = {
        rectangulo: 'Rectángulo', franja_diagonal: 'Franja diagonal', franja: 'Franja', cruz: 'Cruz', estrella: 'Estrella',
        anillo: 'Anillo', mitad: 'Mitad', escudo: 'Escudo', chevron: 'Chevrón', circulo: 'Círculo', rombo: 'Rombo',
        vector: 'Vector (puntos moldeables)'
    };
    const CON_GROSOR = ['franja_diagonal', 'franja', 'cruz', 'anillo', 'chevron', 'estrella'];
    const PATRONES = {
        lineas_v: 'Líneas verticales', lineas_h: 'Líneas horizontales', diagonales: 'Diagonales', cuadros: 'Cuadros',
        rombos: 'Rombos', panal: 'Panal', lunares: 'Lunares', degradado: 'Degradado multicolor',
        degradado_radial: 'Degradado radial (2 colores)', degradado_lineal: 'Degradado lineal (2 colores)'
    };
    const ESTILOS_DEGRADADO = { lineal: 'Lineal', radial: 'Radial', conico: 'Cónico' };
    const MAX_PUNTOS = 32, MAX_COLORES_DEGRADADO = 6;
    const SALAS = { jt_principal: 'Juegan Todos', real_futsal_1: 'Real Futsal', toromatch: 'ToroMatch', predio: 'Predio', torocup: 'ToroCup' };

    const hex = c => '#' + (/^[0-9a-f]{6}$/i.test(c || '') ? c : 'FFFFFF');
    const rad = g => (Number(g) || 0) * Math.PI / 180;
    const num = (v, def) => Number.isFinite(Number(v)) ? Number(v) : def;

    // HaxBall guarda el ángulo en 1/256 de vuelta: setTeamColors(equipo, grados, …) -> 256*grados/360|0
    const anguloInterno = grados => (((256 * num(grados, 0) / 360) | 0) % 256 + 256) % 256;
    const gradosDeInterno = sd => Math.round(sd * 360 / 256) % 360;

    // obs = lo que el motor vio pintar a HaxBall: { sd, texto: 'RRGGBB', colores: ['RRGGBB', …] }
    function coincideFirma(firma, obs) {
        if (!firma || !obs || firma.texto !== obs.texto) return false;
        const a = firma.colores || [], b = obs.colores || [];
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        const d = Math.abs(anguloInterno(firma.angulo) - obs.sd) % 256;
        return Math.min(d, 256 - d) <= 1;
    }

    // La sala no le dice al cliente qué equipo es: solo se ven sus colores. Por eso el equipo y uniforme del diseño
    // se buscan en la lista de equipos (equipos.js) y se comparan los colores REALES de ese equipo en esa sala.
    // Los colores del diseño (asignacion.firma) son solo su base visual, editable. null = equipo que no está en
    // la lista (o firma a mano, ToroCup): entonces sí manda la firma exacta del diseño.
    function firmasDeEquipo(a, equipos, salaId) {
        const uniforme = a.uniforme || (a.tipo === 'especifica' ? '' : a.tipo);
        if (!a.equipo || !uniforme) return null;
        const firmas = [];
        for (const g of equipos || []) {
            if (salaId && !g.salas.includes(salaId)) continue;
            for (const e of g.equipos) if (e.nombre === a.equipo && e.uniformes[uniforme]) firmas.push(e.uniformes[uniforme]);
        }
        return firmas.length ? firmas : null;
    }

    function coincideKit(kit, obs, equipos, salaId) {
        const firmas = firmasDeEquipo(kit.asignacion, equipos, salaId);
        return firmas ? firmas.some(f => coincideFirma(f, obs)) : coincideFirma(kit.asignacion.firma, obs);
    }

    // Franjas base, igual que la textura de jugador de HaxBall. firma.sd (ángulo interno exacto) gana a firma.angulo.
    function base(ctx, firma) {
        const colores = firma && firma.colores && firma.colores.length ? firma.colores : ['E56E56'];
        const sd = firma && Number.isFinite(firma.sd) ? firma.sd : anguloInterno(firma ? firma.angulo : 0);
        ctx.save();
        ctx.translate(32, 32);
        ctx.rotate(Math.PI * sd / 128);
        const w = 64 / colores.length;
        let x = -32;
        for (const c of colores) {
            ctx.fillStyle = hex(c);
            ctx.fillRect(x, -32, w + 4, 64);
            x += w;
        }
        ctx.restore();
    }

    function trazarEstrella(ctx, puntas, rExt, rInt) {
        for (let i = 0; i < puntas * 2; i++) {
            const r = i % 2 ? rInt : rExt;
            const a = -Math.PI / 2 + i * Math.PI / puntas;
            ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();
    }

    const poligono = (ctx, pts) => { pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };

    // Figura de puntos editables (como un vector de Figma). Cada punto: curva 0 = esquina (que se puede
    // redondear con radio) y 1 = totalmente suave (curva de Catmull-Rom entre sus vecinos).
    function trazarVector(ctx, pts) {
        const n = Array.isArray(pts) ? pts.length : 0;
        if (n < 3) return;
        const P = i => pts[(i + n) % n];
        const ent = [], sal = [], tan = [];
        for (let i = 0; i < n; i++) {
            const a = P(i - 1), p = P(i), b = P(i + 1);
            const k = Math.max(0, Math.min(1, num(p.curva, 0)));
            tan.push({ x: (b.x - a.x) / 2 * k, y: (b.y - a.y) / 2 * k });
            const da = Math.hypot(a.x - p.x, a.y - p.y), db = Math.hypot(b.x - p.x, b.y - p.y);
            const r = k > 0 || da < 0.01 || db < 0.01 ? 0 : Math.min(Math.max(0, num(p.radio, 0)), da / 2, db / 2);
            ent.push(r ? { x: p.x + (a.x - p.x) / da * r, y: p.y + (a.y - p.y) / da * r } : p);
            sal.push(r ? { x: p.x + (b.x - p.x) / db * r, y: p.y + (b.y - p.y) / db * r } : p);
        }
        ctx.moveTo(sal[0].x, sal[0].y);
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n, t1 = tan[i], t2 = tan[j];
            if (t1.x || t1.y || t2.x || t2.y)
                ctx.bezierCurveTo(sal[i].x + t1.x / 3, sal[i].y + t1.y / 3, ent[j].x - t2.x / 3, ent[j].y - t2.y / 3, ent[j].x, ent[j].y);
            else ctx.lineTo(ent[j].x, ent[j].y);
            if (ent[j] !== sal[j]) ctx.quadraticCurveTo(P(j).x, P(j).y, sal[j].x, sal[j].y); // esquina redondeada
        }
        ctx.closePath();
    }

    // Puntos de una forma para convertirla en vector (mismo tamaño base que trazar). null = no se puede (anillo).
    function aVector(c) {
        const g = num(c.grosor, 1);
        const p = (x, y, extra) => Object.assign({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, curva: 0, radio: 0 }, extra);
        const estrella = (rExt, rInt) => Array.from({ length: 10 }, (_, i) => {
            const r = i % 2 ? rInt : rExt, a = -Math.PI / 2 + i * Math.PI / 5;
            return p(Math.cos(a) * r, Math.sin(a) * r);
        });
        const franja = [[-7 * g, -64], [7 * g, -64], [7 * g, 64], [-7 * g, 64]];
        switch (c.forma) {
            case 'rectangulo': {
                const esc = num(c.escala, 1) * (num(c.ancho, 1) + num(c.alto, 1)) / 2; // el radio era en px de textura
                const r = Math.min(12, num(c.radio, 0) / Math.max(0.1, esc));
                return [[-12, -12], [12, -12], [12, 12], [-12, 12]].map(([x, y]) => p(x, y, { radio: r }));
            }
            case 'franja': return franja.map(([x, y]) => p(x, y));
            case 'franja_diagonal': return franja.map(([x, y]) => p((x - y) * Math.SQRT1_2, (x + y) * Math.SQRT1_2));
            case 'cruz': {
                const a = 6 * g;
                return [[-a, -64], [a, -64], [a, -a], [64, -a], [64, a], [a, a], [a, 64], [-a, 64], [-a, a], [-64, a], [-64, -a], [-a, -a]].map(([x, y]) => p(x, y));
            }
            case 'estrella': return estrella(14, Math.min(13, 6 * g));
            case 'mitad': return [[0, -64], [64, -64], [64, 64], [0, 64]].map(([x, y]) => p(x, y));
            case 'escudo': return [p(-12, -14), p(12, -14), p(12, 2, { curva: 0.5 }), p(0, 18), p(-12, 2, { curva: 0.5 })];
            case 'chevron': { const t = 12 * g; return [[-22, -8], [0, 8], [22, -8], [22, -8 + t], [0, 8 + t], [-22, -8 + t]].map(([x, y]) => p(x, y)); }
            case 'circulo': return Array.from({ length: 8 }, (_, i) => p(Math.cos(i * Math.PI / 4) * 10, Math.sin(i * Math.PI / 4) * 10, { curva: 1 }));
            case 'rombo': return [[0, -14], [10, 0], [0, 14], [-10, 0]].map(([x, y]) => p(x, y));
            case 'vector': return Array.isArray(c.puntos) ? c.puntos.map(q => Object.assign({}, q)) : null;
            default: return null;
        }
    }

    // Contorno de cada forma en su tamaño base. g = grosor (franjas, cruz, anillo, chevrón, estrella)
    function trazar(ctx, forma, g, puntos) {
        switch (forma) {
            case 'vector': trazarVector(ctx, puntos); break;
            case 'franja_diagonal': ctx.rotate(Math.PI / 4); ctx.rect(-7 * g, -64, 14 * g, 128); break;
            case 'franja': ctx.rect(-7 * g, -64, 14 * g, 128); break;
            case 'cruz': {
                const a = 6 * g; // un solo contorno: el borde no marca el cruce de los brazos
                poligono(ctx, [[-a, -64], [a, -64], [a, -a], [64, -a], [64, a], [a, a], [a, 64], [-a, 64], [-a, a], [-64, a], [-64, -a], [-a, -a]]);
                break;
            }
            case 'estrella': trazarEstrella(ctx, 5, 14, Math.min(13, 6 * g)); break;
            case 'anillo': ctx.arc(0, 0, 20, 0, Math.PI * 2); break;
            case 'mitad': ctx.rect(0, -64, 64, 128); break;
            case 'escudo':
                ctx.moveTo(-12, -14); ctx.lineTo(12, -14); ctx.lineTo(12, 0);
                ctx.quadraticCurveTo(12, 12, 0, 18); ctx.quadraticCurveTo(-12, 12, -12, 0);
                ctx.closePath();
                break;
            case 'chevron': { const t = 12 * g; poligono(ctx, [[-22, -8], [0, 8], [22, -8], [22, -8 + t], [0, 8 + t], [-22, -8 + t]]); break; }
            case 'circulo': ctx.arc(0, 0, 10, 0, Math.PI * 2); break;
            case 'rombo': poligono(ctx, [[0, -14], [10, 0], [0, 14], [-10, 0]]); break;
        }
    }

    // e = escala de la capa; ancho/alto estiran la forma. El borde y las esquinas se miden en px de textura.
    function trazarFigura(ctx, c, e) {
        const sx = e * num(c.ancho, 1), sy = e * num(c.alto, 1);
        ctx.beginPath();
        if (c.forma === 'rectangulo') {
            const w = 24 * sx, h = 24 * sy; // esquinas siempre redondas aunque se estire
            ctx.roundRect(-w / 2, -h / 2, w, h, Math.max(0, Math.min(num(c.radio, 0), w / 2, h / 2)));
        } else {
            ctx.save();
            ctx.scale(sx, sy);
            trazar(ctx, c.forma, num(c.grosor, 1), c.puntos);
            ctx.restore(); // el trazado ya quedó transformado: el borde no se estira
        }
    }

    function figura(ctx, c, e) {
        const g = num(c.grosor, 1);
        trazarFigura(ctx, c, e);
        const borde = num(c.borde, 0);
        ctx.lineJoin = 'round';
        if (c.forma === 'anillo') { // el anillo es un trazo: el borde lo rodea por fuera y por dentro
            if (borde > 0) { ctx.lineWidth = 5 * g * e + 2 * borde; ctx.strokeStyle = hex(c.colorBorde); ctx.stroke(); }
            ctx.lineWidth = 5 * g * e;
            ctx.strokeStyle = hex(c.color);
            ctx.stroke();
            return;
        }
        ctx.fillStyle = hex(c.color);
        ctx.fill();
        // Patrón dentro de la figura, sobre su color. 110 = lo más lejos del centro de la capa que se ve en el disco.
        if (c.relleno && PATRONES[c.relleno.patron]) {
            ctx.save();
            ctx.clip();
            ctx.globalAlpha *= Math.max(0, Math.min(1, num(c.relleno.opacidad, 1)));
            ctx.rotate(rad(c.relleno.rot));
            patron(ctx, c.relleno, 110);
            ctx.restore();
            trazarFigura(ctx, c, e); // el patrón usó su propio trazado: se rehace el de la figura para el borde
        }
        if (borde > 0) { ctx.lineWidth = borde; ctx.strokeStyle = hex(c.colorBorde); ctx.stroke(); }
    }

    function hexagono(ctx, cx, cy, r) {
        ctx.moveTo(cx + r, cy);
        for (let i = 1; i < 6; i++) ctx.lineTo(cx + r * Math.cos(i * Math.PI / 3), cy + r * Math.sin(i * Math.PI / 3));
        ctx.closePath();
    }

    const mezcla = (a, b) => '#' + [0, 2, 4].map(i => Math.round((parseInt(a.substr(i, 2), 16) + parseInt(b.substr(i, 2), 16)) / 2).toString(16).padStart(2, '0')).join('');

    // Paradas de un degradado de varios colores: cada color es una franja del mismo ancho y el cambio entre
    // franjas ocupa "intensidad" de ese ancho (1 = mezcla suave de centro a centro, 0 = cambio de golpe).
    // cerrar (cónico): el último color también se mezcla con el primero donde se juntan.
    function paradas(g, colores, intensidad, cerrar) {
        const n = colores.length;
        const c = colores.map(x => (/^[0-9a-f]{6}$/i.test(x || '') ? x : 'FFFFFF'));
        if (n < 2) { g.addColorStop(0, hex(c[0])); g.addColorStop(1, hex(c[0])); return; }
        const s = Math.max(0, Math.min(1, num(intensidad, 1))), paso = 1 / n, m = s * paso / 2;
        const borde = cerrar && m > 0 ? mezcla(c[n - 1], c[0]) : null;
        g.addColorStop(0, borde || hex(c[0]));
        if (borde) g.addColorStop(m, hex(c[0]));
        for (let i = 1; i < n; i++) {
            g.addColorStop(i * paso - m, hex(c[i - 1]));
            g.addColorStop(i * paso + m, hex(c[i]));
        }
        if (borde) g.addColorStop(1 - m, hex(c[n - 1]));
        g.addColorStop(1, borde || hex(c[n - 1]));
    }

    // Patrón que cubre todo el círculo (el clip lo recorta). Se dibuja centrado y ya rotado.
    // L = mitad del lado del cuadrado que cubre (48 en una capa; más dentro de una figura movida).
    function patron(ctx, c, L = 48) {
        const s = 8 * num(c.escala, 1);
        const n = Math.ceil(L / s) + 1; // celdas por lado para cubrir [-L, L]
        const c1 = hex(c.color), c2 = hex(c.color2);
        ctx.fillStyle = c1;
        switch (c.patron) {
            case 'diagonales': ctx.rotate(Math.PI / 4); // sigue como líneas verticales
            // falls through
            case 'lineas_v': for (let x = -L; x <= L; x += s) ctx.fillRect(x - s * 0.2, -L, s * 0.4, 2 * L); break;
            case 'lineas_h': for (let y = -L; y <= L; y += s) ctx.fillRect(-L, y - s * 0.2, 2 * L, s * 0.4); break;
            case 'cuadros':
                for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
                    ctx.fillStyle = (i + j) & 1 ? c2 : c1;
                    ctx.fillRect(i * s, j * s, s, s);
                }
                break;
            case 'rombos':
                ctx.rotate(Math.PI / 4);
                for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) if (!((i + j) & 1)) ctx.fillRect(i * s, j * s, s, s);
                ctx.strokeStyle = c2; ctx.lineWidth = Math.max(0.6, s * 0.08);
                ctx.beginPath();
                for (let x = -L; x <= L; x += s) { ctx.moveTo(x, -L); ctx.lineTo(x, L); ctx.moveTo(-L, x); ctx.lineTo(L, x); }
                ctx.stroke();
                break;
            case 'panal': {
                const r = s * 0.6, dx = r * 1.5, dy = r * Math.sqrt(3);
                ctx.strokeStyle = c1; ctx.lineWidth = Math.max(0.7, s * 0.1);
                ctx.beginPath();
                for (let i = -Math.ceil(L / dx) - 1; i * dx <= L + dx; i++)
                    for (let j = -Math.ceil(L / dy) - 1; j * dy <= L + dy; j++)
                        hexagono(ctx, i * dx, j * dy + (i & 1 ? dy / 2 : 0), r);
                ctx.stroke();
                break;
            }
            case 'lunares':
                ctx.beginPath();
                for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
                    const x = i * s + (j & 1 ? s / 2 : 0), y = j * s;
                    ctx.moveTo(x + s * 0.22, y);
                    ctx.arc(x, y, s * 0.22, 0, Math.PI * 2);
                }
                ctx.fill();
                break;
            case 'degradado_radial': {
                const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 32 * num(c.escala, 1));
                g.addColorStop(0, c1); g.addColorStop(1, c2);
                ctx.fillStyle = g; ctx.fillRect(-L, -L, 2 * L, 2 * L);
                break;
            }
            case 'degradado_lineal': {
                const g = ctx.createLinearGradient(-32 * num(c.escala, 1), 0, 32 * num(c.escala, 1), 0);
                g.addColorStop(0, c1); g.addColorStop(1, c2);
                ctx.fillStyle = g; ctx.fillRect(-L, -L, 2 * L, 2 * L);
                break;
            }
            case 'degradado': {
                const cols = Array.isArray(c.colores) && c.colores.length ? c.colores : [c.color, c.color2];
                const R = 32 * num(c.escala, 1);
                const g = c.estilo === 'radial' ? ctx.createRadialGradient(0, 0, 0, 0, 0, R)
                    : c.estilo === 'conico' ? ctx.createConicGradient(-Math.PI / 2, 0, 0)
                    : ctx.createLinearGradient(-R, 0, R, 0);
                paradas(g, cols, c.intensidad, c.estilo === 'conico'); // el cónico vuelve al primer color: sin costura
                ctx.fillStyle = g; ctx.fillRect(-L, -L, 2 * L, 2 * L);
                break;
            }
        }
    }

    function imagen(ctx, c, img) {
        if (!img || !img.width || !img.height) return;
        const k = 40 / Math.max(img.width, img.height);
        const w = img.width * k, h = img.height * k;
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
    }

    // Capas recortadas al círculo del jugador. imagenes: Map(src -> imagen ya decodificada)
    function capas(ctx, kit, imagenes) {
        const lista = kit && Array.isArray(kit.capas) ? kit.capas : [];
        if (!lista.length) return;
        ctx.save();
        ctx.beginPath();
        ctx.arc(32, 32, 32, 0, Math.PI * 2);
        ctx.clip();
        for (const c of lista) {
            ctx.save();
            ctx.globalAlpha = Math.max(0, Math.min(1, num(c.opacidad, 1)));
            if (c.tipo === 'patron') {
                ctx.translate(32, 32);
                ctx.rotate(rad(c.rot));
                patron(ctx, c);
            } else {
                ctx.translate(32 + num(c.x, 0), 32 + num(c.y, 0));
                ctx.rotate(rad(c.rot));
                if (c.espejoX || c.espejoY) ctx.scale(c.espejoX ? -1 : 1, c.espejoY ? -1 : 1);
                const e = num(c.escala, 1);
                if (c.tipo === 'figura') figura(ctx, c, e);
                else if (c.tipo === 'imagen') { ctx.scale(e, e); imagen(ctx, c, imagenes && imagenes.get(c.src)); }
            }
            ctx.restore();
        }
        ctx.restore();
    }

    // Texto del avatar. escalaSombra: el blur no sigue la transformación del contexto.
    function texto(ctx, t, avatar, escalaSombra) {
        if (!t || avatar == null || avatar === '') return;
        const fg = FUENTE_GOOGLE.test(t.fuenteGoogle || '') ? t.fuenteGoogle : '';
        const f = fg ? { css: `'${fg}',sans-serif`, peso: '400', ajuste: 1 } : (FUENTES[t.fuente] || FUENTES.clasica);
        const px = Math.max(4, Math.round(num(t.tamano, 24) * f.ajuste));
        ctx.save();
        ctx.font = `${f.peso} ${px}px ${f.css}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.lineJoin = 'round';
        const y = 32 + px * 0.35 + num(t.y, 0);
        if (num(t.glow, 0) > 0) {
            ctx.shadowColor = hex(t.colorGlow);
            ctx.shadowBlur = num(t.glow, 0) * (escalaSombra || 1);
        }
        if (num(t.borde, 0) > 0) {
            ctx.lineWidth = num(t.borde, 0);
            ctx.strokeStyle = hex(t.colorBorde);
            ctx.strokeText(avatar, 32, y);
            ctx.shadowBlur = 0;
        }
        ctx.fillStyle = hex(t.color);
        ctx.fillText(avatar, 32, y);
        ctx.restore();
    }

    // Texto tal como lo pinta HaxBall (para kits sin texto propio o para restaurar el original)
    function textoHaxball(ctx, colorTexto, avatar) {
        if (avatar == null || avatar === '') return;
        ctx.save();
        ctx.fillStyle = hex(colorTexto);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.font = "900 34px 'Arial Black','Arial Bold',Gadget,sans-serif";
        ctx.fillText(avatar, 32, 44);
        ctx.restore();
    }

    // Camiseta completa en 64×64 (vista previa del Taller). ctx ya escalado si se quiere más grande.
    function renderizar(ctx, kit, opciones) {
        const o = opciones || {};
        const firma = kit && kit.asignacion ? kit.asignacion.firma : null;
        ctx.save();
        ctx.beginPath();
        ctx.arc(32, 32, 32, 0, Math.PI * 2);
        ctx.clip();
        base(ctx, firma);
        capas(ctx, kit, o.imagenes);
        if (kit && kit.texto) texto(ctx, kit.texto, o.avatar, o.escalaSombra);
        else textoHaxball(ctx, firma ? firma.texto : 'FFFFFF', o.avatar);
        ctx.restore();
    }

    function lienzo(w, h) {
        if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        return c;
    }

    // Solo las capas (sin franjas ni texto) en un lienzo de 64×64: es lo que cachea el motor
    function lienzoCapas(kit, imagenes) {
        const c = lienzo(64, 64);
        capas(c.getContext('2d'), kit, imagenes);
        return c;
    }

    // Decodifica las imágenes de un kit. Nunca rechaza: una imagen rota simplemente no se dibuja.
    function cargarImagenes(kit, previas) {
        const mapa = new Map();
        const srcs = (kit && kit.capas || []).filter(c => c.tipo === 'imagen' && typeof c.src === 'string').map(c => c.src);
        return Promise.all(srcs.map(src => {
            if (previas && previas.has(src)) { mapa.set(src, previas.get(src)); return null; }
            const img = new Image();
            img.src = src;
            return img.decode().then(() => mapa.set(src, img)).catch(() => null);
        })).then(() => mapa);
    }

    // Carga una familia de Google Fonts en el documento. Resuelve true si existe y quedó lista.
    const fuentesPedidas = new Map();
    function cargarFuenteGoogle(doc, familia) {
        if (!FUENTE_GOOGLE.test(familia || '')) return Promise.resolve(false);
        if (fuentesPedidas.has(familia)) return fuentesPedidas.get(familia);
        const p = new Promise(resolve => {
            const link = doc.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://fonts.googleapis.com/css2?family=' + familia.replace(/ /g, '+') + '&display=swap';
            link.onload = () => doc.fonts.load(`400 34px '${familia}'`).then(l => resolve(l.length > 0), () => resolve(false));
            link.onerror = () => { link.remove(); fuentesPedidas.delete(familia); resolve(false); }; // familia inexistente: Google responde 400
            (doc.head || doc.documentElement).appendChild(link);
        });
        fuentesPedidas.set(familia, p);
        return p;
    }

    // Reconstruye cada kit campo a campo con los límites del formato (CLAUDE.md 4.6). main.js lo aplica al
    // leer y al escribir kits.json: lo que va en el instalador nunca trae campos sueltos ni valores fuera de rango.
    const IMG_PREFIJOS = ['data:image/png;base64,', 'data:image/webp;base64,', 'data:image/jpeg;base64,'];
    function sanear(lista) {
        const str = (v, n) => String(v ?? '').slice(0, n);
        const nm = (v, min, max, def) => { const n = (typeof v === 'number' || typeof v === 'string') && v !== '' ? Number(v) : NaN; return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
        const color = (v, def) => { const c = typeof v === 'string' ? v.replace(/^#/, '') : ''; return /^[0-9A-F]{6}$/i.test(c) ? c.toUpperCase() : def; };
        const opcion = (v, opciones) => opciones.includes(v) ? v : opciones[0];
        const pos = c => ({ x: nm(c.x, -48, 48, 0), y: nm(c.y, -48, 48, 0), escala: nm(c.escala, 0.1, 4, 1), rot: nm(c.rot, -360, 360, 0), opacidad: nm(c.opacidad, 0, 1, 1), espejoX: c.espejoX === true, espejoY: c.espejoY === true });
        const imagenOk = s => typeof s === 'string' && s.length <= 350000 &&
            IMG_PREFIJOS.some(p => s.startsWith(p)) && /^[A-Za-z0-9+/=]+$/.test(s.slice(s.indexOf(',') + 1));
        const relleno = c => {
            if (!c || typeof c !== 'object' || !PATRONES[c.patron]) return null;
            const r = { patron: c.patron, color: color(c.color, 'FFFFFF'), color2: color(c.color2, 'FFFFFF'),
                        opacidad: nm(c.opacidad, 0, 1, 1), escala: nm(c.escala, 0.25, 4, 1), rot: nm(c.rot, -360, 360, 0) };
            if (c.patron === 'degradado') {
                const cols = (Array.isArray(c.colores) ? c.colores : []).map(x => color(x, null)).filter(Boolean).slice(0, MAX_COLORES_DEGRADADO);
                r.colores = cols.length >= 2 ? cols : [r.color, r.color2];
                r.estilo = opcion(c.estilo, Object.keys(ESTILOS_DEGRADADO));
                r.intensidad = nm(c.intensidad, 0, 1, 1);
            }
            return r;
        };
        const punto = q => (q && typeof q === 'object') ? { x: nm(q.x, -64, 64, 0), y: nm(q.y, -64, 64, 0), curva: nm(q.curva, 0, 1, 0), radio: nm(q.radio, 0, 16, 0) } : null;
        const capa = c => {
            if (!c || typeof c !== 'object') return null;
            if (c.tipo === 'figura' && FORMAS[c.forma]) {
                const f = { tipo: 'figura', forma: c.forma, ...pos(c), color: color(c.color, 'FFFFFF'),
                            ancho: nm(c.ancho, 0.1, 4, 1), alto: nm(c.alto, 0.1, 4, 1), grosor: nm(c.grosor, 0.2, 4, 1),
                            borde: nm(c.borde, 0, 8, 0), colorBorde: color(c.colorBorde, '000000'), radio: nm(c.radio, 0, 32, 0),
                            relleno: relleno(c.relleno) };
                if (c.forma === 'vector') {
                    f.puntos = (Array.isArray(c.puntos) ? c.puntos : []).map(punto).filter(Boolean).slice(0, MAX_PUNTOS);
                    if (f.puntos.length < 3) return null;
                }
                return f;
            }
            if (c.tipo === 'patron') { const r = relleno(c); return r && Object.assign({ tipo: 'patron' }, r); }
            if (c.tipo === 'imagen' && imagenOk(c.src)) return { tipo: 'imagen', src: c.src, ...pos(c) };
            return null;
        };
        const textoK = t => (!t || typeof t !== 'object') ? null : {
            fuente: opcion(t.fuente, Object.keys(FUENTES)),
            fuenteGoogle: typeof t.fuenteGoogle === 'string' && FUENTE_GOOGLE.test(t.fuenteGoogle.trim()) ? t.fuenteGoogle.trim() : '',
            color: color(t.color, 'FFFFFF'), tamano: nm(t.tamano, 10, 52, 24),
            y: nm(t.y, -20, 20, 0), borde: nm(t.borde, 0, 8, 0), colorBorde: color(t.colorBorde, '000000'),
            glow: nm(t.glow, 0, 24, 0), colorGlow: color(t.colorGlow, 'FFFFFF')
        };

        const ids = new Set();
        const kits = [];
        (Array.isArray(lista) ? lista : []).forEach((k, i) => {
            if (kits.length >= 60 || !k || typeof k !== 'object') return;
            const a = (k.asignacion && typeof k.asignacion === 'object') ? k.asignacion : {};
            const f = (a.firma && typeof a.firma === 'object') ? a.firma : {};
            const colores = (Array.isArray(f.colores) ? f.colores : []).map(c => color(c, null)).filter(Boolean).slice(0, 3);
            if (!colores.length) return;
            const id = (typeof k.id === 'string' && /^[a-z0-9_-]{1,40}$/i.test(k.id)) ? k.id : 'k_' + Date.now().toString(36) + i;
            if (ids.has(id)) return;
            ids.add(id);
            kits.push({
                id,
                nombre: str(k.nombre, 60),
                activo: k.activo === true,
                asignacion: {
                    tipo: opcion(a.tipo, ['local', 'visita', 'especifica']),
                    uniforme: opcion(a.uniforme, ['', 'local', 'visita', 'tercera', 'entreno']),
                    equipo: str(a.equipo, 40),
                    salas: [...new Set((Array.isArray(a.salas) ? a.salas : []).filter(s => SALAS[s]))],
                    firma: { angulo: ((Math.round(nm(f.angulo, -1e6, 1e6, 0)) % 360) + 360) % 360, texto: color(f.texto, 'FFFFFF'), colores }
                },
                capas: (Array.isArray(k.capas) ? k.capas : []).map(capa).filter(Boolean).slice(0, 20),
                texto: textoK(k.texto)
            });
        });
        return kits;
    }

    /* ---------- Marcador: lo usan el motor (en la sala), el editor de posiciones (carcasa) y el visor de la web ---------- */
    const CODIGOS = {
        'Colo-Colo': 'C-C', 'U. De Chile': 'UCH', 'U. De Concepción': 'UDC', 'U. La Calera': 'ULC', 'D. Concepción': 'DCO', 'D. Copiapó': 'COP',
        'Cobreloa': 'CLO', 'Cobresal': 'CSA', 'Barnechea': 'BNE', 'ToroHax': 'THX', 'Audax Italiano': 'AUD', 'Bayern Múnich': 'BAY', 'Boca Juniors': 'BOC',
        'Coquimbo Unido': 'COQ', 'Curicó Unido': 'CUR', 'Inter de Milán': 'INT', 'Manchester City': 'MCI', 'Manchester United': 'MUN', 'Real Madrid': 'RMA',
        'River Plate': 'RIV', 'San Felipe': 'USF', 'San Luis': 'SLU', 'San Marcos de Arica': 'SMA', 'Atletico de Madrid': 'ATM', 'AC Milan': 'ACM', 'PSG': 'PSG'
    };
    function codigoDe(nombre) {
        if (CODIGOS[nombre]) return CODIGOS[nombre];
        const palabras = nombre.split(/\s+/).filter(p => !/^(de|la|del)$/i.test(p));
        return (palabras.length > 1 ? palabras.map(p => p[0]).join('') : nombre.replace(/[^\p{L}]/gu, '').slice(0, 3)).toUpperCase();
    }

    // Nombre del equipo de cada firma según grupos de equipos.js; null si no aparece o dos equipos tienen esos colores.
    // Si un grupo tiene a ambos equipos, se busca solo ahí: dos listas de una sala repiten colores entre sí.
    function equiposDeFirmas(grupos, firmas) {
        const nombresEn = (grupo, obs) => {
            const nombres = new Set();
            for (const e of grupo.equipos) {
                for (const u of Object.values(e.uniformes)) if (coincideFirma(u, obs)) nombres.add(e.nombre);
            }
            return nombres;
        };
        const conAmbos = grupos.filter(g => firmas.every(f => f && nombresEn(g, f).size));
        const donde = conAmbos.length ? conAmbos : grupos;
        return firmas.map(f => {
            if (!f) return null;
            const nombres = new Set();
            for (const g of donde) nombresEn(g, f).forEach(n => nombres.add(n));
            return nombres.size === 1 ? [...nombres][0] : null;
        });
    }

    // escudos/<archivo>.png vale para el equipo aunque cambien mayúsculas, tildes, espacios o puntos
    const claveEscudo = n => String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const SILUETA_ESCUDO = 'M32 2C25 8 15 11 6 12C5 34 12 52 32 62C52 52 59 34 58 12C49 11 39 8 32 2Z';
    const MARCADOR_CSS = `
.toro-mc { position: absolute; z-index: 2; display: flex; align-items: flex-start; gap: 10px; padding: 8px; color: #fff; line-height: 1;
    pointer-events: none; user-select: none; font-family: 'Anton', Impact, 'Arial Narrow', sans-serif; font-weight: 400; transition: opacity 0.18s ease; }
.toro-mc { opacity: var(--toro-op, 1); }
.toro-mc.tapado { opacity: calc(var(--toro-op, 1) * 0.28); }
.toro-mc-logo { width: 58px; height: 58px; border-radius: 50%; flex-shrink: 0; }
.toro-mc-bloque { display: flex; flex-direction: column; align-items: center; }
.toro-mc-caja { position: relative; z-index: 1; display: grid; align-items: center; background: rgba(50, 103, 113, 0.97); border-radius: 12px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3); }
.toro-mc-eq { display: contents; }
.toro-mc-esc { width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; }
.toro-mc-esc > * { width: 100%; height: 100%; object-fit: contain; display: block; }
.toro-mc-cod { font-size: 28px; letter-spacing: 0.5px; white-space: nowrap; }
.toro-mc-num { font-size: 32px; text-align: center; }
.toro-mc-reloj { box-sizing: border-box; display: flex; align-items: center; justify-content: center; overflow: hidden; white-space: nowrap; background: #2A555D; font-size: 24px; padding: 3px 16px 5px; border-radius: 0 0 11px 11px; }
.toro-mc-hora { display: flex; }
.toro-mc-hora.alerta { color: #FF8725; }
.toro-mc-extra { display: none; align-items: center; color: #E6C183; margin-left: 10px; }
.toro-mc-reloj.con-extra .toro-mc-extra { display: flex; }
.toro-mc-extra svg { width: 1.25em; height: 0.72em; margin-left: 2px; }
.toro-mc.larga .toro-mc-caja { grid-template-columns: auto auto minmax(26px, auto) auto minmax(26px, auto) auto auto; column-gap: 10px; padding: 6px 14px; }
.toro-mc.larga .rojo .toro-mc-esc { grid-column: 1; }
.toro-mc.larga .rojo .toro-mc-cod { grid-column: 2; margin-right: 8px; }
.toro-mc.larga .rojo .toro-mc-num { grid-column: 3; }
.toro-mc.larga .toro-mc-sep { grid-column: 4; grid-row: 1; font-size: 26px; }
.toro-mc.larga .toro-mc-sep::before { content: '-'; }
.toro-mc.larga .azul .toro-mc-num { grid-column: 5; }
.toro-mc.larga .azul .toro-mc-cod { grid-column: 6; margin-left: 8px; }
.toro-mc.larga .azul .toro-mc-esc { grid-column: 7; }
.toro-mc.larga .toro-mc-eq > * { grid-row: 1; }
.toro-mc.vertical { align-items: center; }
.toro-mc.vertical .toro-mc-bloque { flex-direction: row; align-items: stretch; }
.toro-mc.vertical .toro-mc-caja { grid-template-columns: auto minmax(42px, auto) 4px minmax(24px, auto); gap: 6px 10px; padding: 8px 12px; }
.toro-mc.vertical .rojo > * { grid-row: 1; }
.toro-mc.vertical .azul > * { grid-row: 2; }
.toro-mc.vertical .toro-mc-esc { grid-column: 1; }
.toro-mc.vertical .toro-mc-cod { grid-column: 2; }
.toro-mc.vertical .toro-mc-num { grid-column: 4; }
.toro-mc.vertical .toro-mc-sep { grid-column: 3; grid-row: 1 / 3; align-self: stretch; background: #2A555D; border-radius: 2px; }
.toro-mc.vertical .toro-mc-reloj { flex-direction: column; min-width: 80px; margin-left: -12px; padding: 6px 12px 6px 24px; border-radius: 0 12px 12px 0; font-size: 38px; }
.toro-mc.vertical .toro-mc-reloj:not(.con-extra) .toro-mc-hora { flex-direction: column; align-items: center; gap: 4px; }
.toro-mc.vertical .toro-mc-reloj.con-extra { font-size: 28px; gap: 8px; }
.toro-mc.vertical .toro-mc-extra { margin-left: 0; }
.toro-mc-npen { display: none; margin-left: 6px; }
.toro-mc-penales { display: none; box-sizing: border-box; flex-direction: column; background: #2A555D; }
.toro-mc.en-tanda .toro-mc-reloj { display: none; }
.toro-mc.en-tanda .toro-mc-penales { display: flex; }
.toro-mc-pfila { display: flex; align-items: center; gap: 10px; }
.toro-mc-pfila .toro-mc-esc { width: 26px; height: 26px; }
.toro-mc-pfila .toro-mc-cod { font-size: 20px; min-width: 34px; }
.toro-mc-pgol { font-size: 20px; }
.toro-mc-puntos { display: flex; gap: 4px; flex: 1; justify-content: center; }
.toro-mc-puntos span { width: 17px; height: 17px; border-radius: 50%; background: #fff; transition: background 0.2s ease; }
.toro-mc-puntos .v { background: #1CC63C; }
.toro-mc-puntos .r { background: #D61818; }
.toro-mc.larga.en-tanda .toro-mc-bloque { align-items: stretch; }
.toro-mc.larga .toro-mc-penales { gap: 5px; margin-top: -12px; padding: 17px 14px 8px; border-radius: 0 0 12px 12px; }
.toro-mc.vertical.en-tanda .toro-mc-npen { display: inline; }
.toro-mc.vertical .toro-mc-penales { gap: 6px; margin-left: -12px; padding: 8px 12px 8px 24px; border-radius: 0 12px 12px 0; }
.toro-mc.vertical .toro-mc-pfila { height: 44px; }
.toro-mc.vertical .toro-mc-pfila .toro-mc-esc, .toro-mc.vertical .toro-mc-pfila .toro-mc-cod, .toro-mc.vertical .toro-mc-pgol { display: none; }
.toro-mc.vertical .toro-mc-puntos span { width: 22px; height: 22px; }
`;

    // Vector: HaxBall fuerza image-rendering: pixelated en todo canvas de .game-state-view
    let idEscudo = 0;
    function pintarEscudo(cont, eq, respaldo) {
        const clave = eq.escudo || JSON.stringify(eq.firma || respaldo);
        if (cont.dataset.clave === clave) return;
        cont.dataset.clave = clave;
        cont.textContent = '';
        if (eq.escudo) {
            const img = cont.ownerDocument.createElement('img');
            img.alt = '';
            img.src = eq.escudo;
            cont.appendChild(img);
            return;
        }
        const firma = eq.firma || respaldo;
        const id = 'toro-esc-' + (++idEscudo);
        // Las franjas giradas se agrandan (64 -> 80) para llegar a las puntas de la silueta, como la textura del jugador
        const ancho = 80 / firma.colores.length;
        const franjas = firma.colores.map((c, i) => `<rect x="${-8 + i * ancho}" y="-8" width="${ancho + 0.3}" height="80" fill="${hex(c)}"/>`).join('');
        cont.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true"><clipPath id="${id}"><path d="${SILUETA_ESCUDO}"/></clipPath>` +
            `<g clip-path="url(#${id})"><g transform="rotate(${(Number(firma.sd) || 0) * 360 / 256} 32 32)">${franjas}</g></g></svg>`;
    }

    const INFINITO = '+<svg viewBox="0 0 28 16" aria-hidden="true"><path d="M7.5 3a5 5 0 1 0 0 10c5 0 8-10 13-10a5 5 0 1 1 0 10c-5 0-8-10-13-10z" fill="none" stroke="currentColor" stroke-width="4.6"/></svg>';
    const textoAdicion = s => `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

    // datos = { variante: 'larga'|'vertical', rojo: { codigo, firma, escudo }, azul: {...}, goles: [r, a], mm, ss, extra, alerta, tanda }
    // extra: null, segundos de adición o 'inf' (overtime de HaxBall)
    // tanda: null o [fila rojo, fila azul] con { goles, puntos: ['v'|'r'|'b' × 5] }: reemplaza al reloj
    function rectRedondo(g, x, y, w, h, r) {
        g.beginPath();
        g.moveTo(x + r, y);
        g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
        g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
        g.closePath();
    }

    const fotosEscudo = new Map(); // data URL -> imagen (se decodifica una vez)
    function escudoEnLienzo(g, x, y, s, eq, respaldo) {
        if (eq.escudo) {
            let foto = fotosEscudo.get(eq.escudo);
            if (!foto) { foto = new Image(); foto.src = eq.escudo; fotosEscudo.set(eq.escudo, foto); }
            if (foto.complete && foto.naturalWidth) {
                const k = s / Math.max(foto.naturalWidth, foto.naturalHeight), w = foto.naturalWidth * k, h = foto.naturalHeight * k;
                g.drawImage(foto, x + (s - w) / 2, y + (s - h) / 2, w, h);
                return;
            }
        }
        const firma = eq.firma || { sd: 0, colores: [respaldo] };
        g.save();
        g.translate(x, y);
        g.scale(s / 64, s / 64);
        g.clip(new Path2D(SILUETA_ESCUDO));
        g.translate(32, 32);
        g.rotate((Number(firma.sd) || 0) * Math.PI / 128);
        const ancho = 80 / firma.colores.length;
        firma.colores.forEach((c, i) => { g.fillStyle = '#' + c; g.fillRect(-40 + i * ancho, -40, ancho + 0.3, 80); });
        g.restore();
    }

    // El marcador para un video, arriba al centro y con las medidas de MARCADOR_CSS: un clip no puede llevar HTML.
    // M = lo mismo que recibe pintar() de crearMarcador. Lo usan los clips del visor y los del programa.
    function dibujarMarcadorLienzo(g, w, h, M, logo) {
        const u = h / 900;
        const fuente = t => `${t * u}px Anton, Impact, "Arial Narrow", sans-serif`;
        const px = t => t * u;
        g.save();
        g.textBaseline = 'middle';
        g.font = fuente(28);
        const codR = g.measureText(M.rojo.codigo).width, codA = g.measureText(M.azul.codigo).width;
        g.font = fuente(32);
        const numR = Math.max(px(26), g.measureText(String(M.goles[0])).width), numA = Math.max(px(26), g.measureText(String(M.goles[1])).width);
        g.font = fuente(26);
        const sep = g.measureText('-').width;
        const total = px(14) * 2 + px(44) * 2 + codR + codA + numR + numA + sep + px(10) * 6 + px(8) * 2;
        const conLogo = logo && logo.complete && logo.naturalWidth > 0;
        const x0 = Math.round((w - total + (conLogo ? px(68) : 0)) / 2), y0 = Math.round(h * 0.03), cajaH = px(56), cy = y0 + cajaH / 2;
        const centroX = x0 + total / 2;

        if (conLogo) {
            g.save();
            g.beginPath();
            g.arc(x0 - px(39), y0 + px(29), px(29), 0, Math.PI * 2);
            g.clip();
            g.drawImage(logo, x0 - px(68), y0, px(58), px(58));
            g.restore();
        }
        const bajo = (ancho, alto) => { g.fillStyle = '#2A555D'; rectRedondo(g, centroX - ancho / 2, y0 + cajaH - px(12), ancho, alto + px(12), px(11)); g.fill(); };
        if (M.tanda) {
            bajo(total, px(5) * 3 + px(26) * 2 + px(8));
            [[M.rojo, M.tanda[0], 'FF8725'], [M.azul, M.tanda[1], '2380D6']].forEach(([eq, fila, respaldo], i) => {
                const fy = y0 + cajaH + px(5) + i * px(31) + px(13), xi = x0 + px(14);
                escudoEnLienzo(g, xi, fy - px(13), px(26), eq, respaldo);
                g.font = fuente(20); g.fillStyle = '#fff'; g.textAlign = 'left';
                g.fillText(eq.codigo, xi + px(36), fy);
                g.textAlign = 'right';
                g.fillText(`(${fila.goles})`, x0 + total - px(14), fy);
                const px0 = centroX - px(47);
                fila.puntos.forEach((p, j) => {
                    g.fillStyle = p === 'v' ? '#1CC63C' : p === 'r' ? '#D61818' : '#fff';
                    g.beginPath(); g.arc(px0 + j * px(21) + px(8.5), fy, px(8.5), 0, Math.PI * 2); g.fill();
                });
            });
        } else {
            const hora = `${M.mm}:${M.ss}`;
            const extra = M.extra === 'inf' ? '+\u221E' : M.extra !== null ? `+${Math.floor(M.extra / 60)}:${String(M.extra % 60).padStart(2, '0')}` : '';
            g.font = fuente(24);
            const anchoHora = g.measureText(hora).width, anchoExtra = extra ? g.measureText(extra).width + px(10) : 0;
            bajo(anchoHora + anchoExtra + px(32), px(32));
            const ty = y0 + cajaH + px(15);
            let tx = centroX - (anchoHora + anchoExtra) / 2;
            g.textAlign = 'left';
            g.fillStyle = M.alerta ? '#FF8725' : '#fff';
            g.fillText(hora, tx, ty);
            if (extra) { g.fillStyle = '#E6C183'; g.fillText(extra, tx + anchoHora + px(10), ty); }
        }
        g.fillStyle = 'rgba(50, 103, 113, 0.97)';
        rectRedondo(g, x0, y0, total, cajaH, px(12));
        g.fill();
        let x = x0 + px(14);
        escudoEnLienzo(g, x, y0 + px(6), px(44), M.rojo, 'FF8725');
        x += px(54);
        g.fillStyle = '#fff'; g.textAlign = 'left'; g.font = fuente(28); g.fillText(M.rojo.codigo, x, cy);
        x += codR + px(18);
        g.textAlign = 'center'; g.font = fuente(32); g.fillText(String(M.goles[0]), x + numR / 2, cy);
        x += numR + px(10);
        g.font = fuente(26); g.fillText('-', x + sep / 2, cy);
        x += sep + px(10);
        g.font = fuente(32); g.fillText(String(M.goles[1]), x + numA / 2, cy);
        x += numA + px(18);
        g.textAlign = 'left'; g.font = fuente(28); g.fillText(M.azul.codigo, x, cy);
        escudoEnLienzo(g, x + codA + px(10), y0 + px(6), px(44), M.azul, '2380D6');
        g.restore();
    }

    function crearMarcador(doc, logo) {
        const el = doc.createElement('div');
        el.className = 'toro-mc larga';
        el.innerHTML = '<img class="toro-mc-logo" alt=""><div class="toro-mc-bloque"><div class="toro-mc-caja">' +
            ['rojo', 'azul'].map(e => `<div class="toro-mc-eq ${e}"><div class="toro-mc-esc"></div><div class="toro-mc-cod"></div><div class="toro-mc-num"><span class="gol"></span><span class="toro-mc-npen"></span></div></div>`).join('') +
            '<div class="toro-mc-sep"></div></div><div class="toro-mc-reloj"><div class="toro-mc-hora"><span class="mm"></span><span class="ss"></span></div><div class="toro-mc-extra"></div></div><div class="toro-mc-penales">' +
            ['rojo', 'azul'].map(e => `<div class="toro-mc-pfila" data-eq="${e}"><div class="toro-mc-esc"></div><div class="toro-mc-cod"></div><div class="toro-mc-puntos">${'<span></span>'.repeat(5)}</div><div class="toro-mc-pgol"></div></div>`).join('') +
            '</div></div>';
        el.querySelector('.toro-mc-logo').src = logo;
        const $ = s => el.querySelector(s);
        const reloj = $('.toro-mc-reloj'), hora = $('.toro-mc-hora'), extra = $('.toro-mc-extra');
        const equipo = (nombre, eq, gol, respaldo) => {
            pintarEscudo($(`.${nombre} .toro-mc-esc`), eq, respaldo);
            $(`.${nombre} .toro-mc-cod`).textContent = eq.codigo;
            $(`.${nombre} .gol`).textContent = gol;
        };
        function pintarTanda(d, respaldos) {
            el.classList.toggle('en-tanda', !!d.tanda);
            if (!d.tanda) return;
            ['rojo', 'azul'].forEach((nombre, i) => {
                const fila = $(`.toro-mc-pfila[data-eq="${nombre}"]`), datos = d.tanda[i];
                pintarEscudo(fila.querySelector('.toro-mc-esc'), d[nombre], respaldos[i]);
                fila.querySelector('.toro-mc-cod').textContent = d[nombre].codigo;
                [...fila.querySelector('.toro-mc-puntos').children].forEach((p, j) => { p.className = datos.puntos[j]; });
                fila.querySelector('.toro-mc-pgol').textContent = `(${datos.goles})`;
                $(`.${nombre} .toro-mc-npen`).textContent = `(${datos.goles})`;
            });
        }
        let extraActual = null, conteo = null;
        // Al aparecer: la pestaña se ensancha, el valor entra con un pequeño rebote y la adición cuenta hasta su valor
        function pintarExtra(valor) {
            if (valor === extraActual) return;
            extraActual = valor;
            clearInterval(conteo);
            const antes = reloj.offsetWidth;
            reloj.classList.toggle('con-extra', valor !== null);
            if (valor === null) return;
            if (valor === 'inf') extra.innerHTML = INFINITO;
            else {
                extra.textContent = textoAdicion(0);
                const t0 = Date.now();
                conteo = setInterval(() => {
                    const k = Math.min(1, (Date.now() - t0) / 700);
                    extra.textContent = textoAdicion(Math.round(valor * (1 - (1 - k) * (1 - k))));
                    if (k === 1) clearInterval(conteo);
                }, 30);
            }
            reloj.animate([{ width: antes + 'px' }, { width: reloj.offsetWidth + 'px' }], { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
            extra.animate([{ opacity: 0, transform: 'translateY(8px) scale(0.7)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.3)' });
        }
        return {
            el,
            pintar(d) {
                el.classList.remove('larga', 'vertical');
                el.classList.add(d.variante);
                const respaldos = [{ sd: 0, colores: ['FF8725'] }, { sd: 0, colores: ['2380D6'] }];
                equipo('rojo', d.rojo, d.goles[0], respaldos[0]);
                equipo('azul', d.azul, d.goles[1], respaldos[1]);
                pintarTanda(d, respaldos);
                $('.mm').textContent = d.mm;
                $('.ss').textContent = ':' + d.ss;
                hora.classList.toggle('alerta', !!d.alerta);
                pintarExtra(d.extra === undefined ? null : d.extra);
            }
        };
    }

    // Lleva el elemento a { x, y } de 0 a 1 sin salirse de la pantalla, sea cual sea su tamaño
    function fijarPosicion(el, p) {
        const x = (p.x * 100).toFixed(2) + '%', y = (p.y * 100).toFixed(2) + '%';
        el.style.left = x;
        el.style.top = y;
        el.style.transform = `translate(-${x}, -${y})`;
    }

    // Tamaño y transparencia: zoom vuelve a maquetar en vez de escalar una imagen, así el texto sigue nítido
    function fijarApariencia(el, a) {
        el.style.zoom = String((a && a.escala) || 1);
        el.style.setProperty('--toro-op', String((a && a.opacidad) || 1));
    }

    // [fila rojo, fila azul] y los equipos del marcador durante la tanda. Pública: primero rojo. Express: primero local,
    // que después del 2T y del alargue juega de azul, salvo que su abreviatura diga otra cosa.
    function vistaTanda(tanda) {
        const ini = tanda.inicio, f = tanda.filas;
        const invertir = tanda.express && !(ini && f[0].etiqueta === ini.rojo.codigo);
        const filas = invertir ? [f[1], f[0]] : f;
        const corto = e => (e.length <= 4 ? e.toUpperCase() : codigoDe(e));
        return {
            filas,
            rojo: ini ? ini.rojo : { codigo: corto(filas[0].etiqueta) || 'RED', firma: null, escudo: null },
            azul: ini ? ini.azul : { codigo: corto(filas[1].etiqueta) || 'BLU', firma: null, escudo: null },
            goles: ini ? ini.goles : ['-', '-']
        };
    }

    /* ---------- Tanda de penales: se lee de los anuncios de las salas ---------- */
    // Pública (ToroRealFutsal2026.js): "Equipo | 🟢🔴⚪⚪⚪ | [1]", ya con la ventana de los últimos 5.
    // Express (express_*.js): "🐂 ABR: 1 | 🟢🔴⚪⚪⚪ | (🟢)": siempre los 5 primeros más el penal de la ronda actual,
    // así que el historial desde el sexto se arma aquí. Si cambias esos textos, actualiza estas expresiones.
    const PUNTO = { '🟢': 'v', '🔴': 'r', '⚪': 'b' };
    const CINCO = '(?:(?:🟢|🔴|⚪)\\uFE0F?){5}';
    const RE_PENAL_PUBLICA = new RegExp(`^(.+?) \\| (${CINCO}) \\| \\[(\\d+)\\]$`, 'u');
    const RE_PENAL_EXPRESS = new RegExp(`^(?:\\S+ )?(.+?): (\\d+) \\| (${CINCO}) \\|(?: \\((🟢|🔴|⚪)\\uFE0F?\\))?$`, 'u');
    const aPuntos = t => [...t.matchAll(/🟢|🔴|⚪/gu)].map(m => PUNTO[m[0]]);
    const filaVacia = () => ({ etiqueta: '', goles: 0, puntos: ['b', 'b', 'b', 'b', 'b'] });

    const nuevaTanda = () => ({ express: false, pendiente: null, hist: [[], []], previo: ['', ''], ultima: -1, filas: [filaVacia(), filaVacia()] });

    function filasDeHistorial(t) {
        const inicio = Math.max(t.hist[0].length, t.hist[1].length, 5) - 5;
        t.filas = t.hist.map((h, k) => ({
            etiqueta: t.filas[k].etiqueta,
            goles: h.filter(p => p === 'v').length,
            puntos: [0, 1, 2, 3, 4].map(i => h[inicio + i] || 'b')
        }));
    }

    // Devuelve true si el texto era parte de la tanda. Cada anuncio trae dos líneas seguidas, una por equipo.
    // Una tanda puede acabar sin su anuncio (la sala se reinicia, el partido se suspende) o seguir de inmediato otro partido.
    // retrocedio: el reloj del juego volvió atrás. En la pública la tanda corre en un solo juego; en express cada penal es
    // un juego nuevo, que nunca llega a TANDA_RELOJ_MAX segundos: si llega, ya es otro partido.
    const TANDA_RELOJ_MAX = 120;
    function tandaSigue(t, retrocedio, segundos) {
        if (retrocedio) {
            t.reinicio = true;
            if (t.fin || (t.vistos && !t.express)) return false;
        }
        return !(t.reinicio && segundos > TANDA_RELOJ_MAX);
    }

    function anotarPenal(t, texto) {
        const tx = String(texto).trim();
        if (/^📊 Tanda actual:/u.test(tx)) { // !anular de la sala: se borra el último penal
            if (t.ultima >= 0) {
                t.hist[t.ultima].pop();
                t.previo[t.ultima] = 'b';
                t.ultima = -1;
                filasDeHistorial(t);
            }
            return true;
        }
        let linea = null, m = RE_PENAL_PUBLICA.exec(tx);
        if (m) linea = { etiqueta: m[1], goles: Number(m[3]), puntos: aPuntos(m[2]) };
        else if ((m = RE_PENAL_EXPRESS.exec(tx))) linea = { etiqueta: m[1], base: aPuntos(m[3]), extra: m[4] ? PUNTO[m[4]] : '' };
        if (!linea) { t.pendiente = null; return false; }
        t.vistos = true;
        if (!t.pendiente) { t.pendiente = linea; return true; }
        const par = [t.pendiente, linea];
        t.pendiente = null;
        if (!linea.base) { t.filas = par; return true; }
        t.express = true;
        par.forEach((l, k) => {
            t.filas[k].etiqueta = l.etiqueta;
            const antes = t.hist[k].length;
            t.hist[k] = l.base.filter(p => p !== 'b').concat(t.hist[k].slice(5));
            // Ronda 6 en adelante: nuevo si el rival aún no patea esa ronda, o si en el anuncio anterior este equipo faltaba
            if (l.extra && l.extra !== 'b' && (par[1 - k].extra === 'b' || t.previo[k] === 'b')) t.hist[k].push(l.extra);
            t.previo[k] = l.extra;
            if (t.hist[k].length > antes) t.ultima = k;
        });
        filasDeHistorial(t);
        return true;
    }

    raiz.ToroKitRender = {
        claveEscudo, SILUETA_ESCUDO, codigoDe, equiposDeFirmas, MARCADOR_CSS, crearMarcador, dibujarMarcadorLienzo, fijarPosicion, fijarApariencia, nuevaTanda, anotarPenal, vistaTanda, tandaSigue, TANDA_RELOJ_MAX,
        FUENTES, URL_FUENTES, FUENTE_GOOGLE, FORMAS, CON_GROSOR, PATRONES, ESTILOS_DEGRADADO, MAX_PUNTOS, MAX_COLORES_DEGRADADO, SALAS,
        hex, anguloInterno, gradosDeInterno, coincideFirma, firmasDeEquipo, coincideKit, aVector, sanear,
        base, capas, texto, textoHaxball, renderizar, lienzo, lienzoCapas, cargarImagenes, cargarFuenteGoogle
    };
})(typeof window !== 'undefined' ? window : globalThis);
