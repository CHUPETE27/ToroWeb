/* =========================================================
   TOROHAX UI - ventanas de aviso y confirmación reutilizables
   (los estilos están en styles.css, sección 14)

   Uso (en cualquier página que cargue styles.css y este archivo):
     await ThUI.alert('✅ Guardado correctamente');
     if (await ThUI.confirm('¿Seguro que quieres continuar?')) { ... }
     ThUI.alert('Texto', { title: 'Título', tone: 'error' });
     ThUI.confirm('¿Banear a este jugador?', { danger: true, okText: 'Banear' });
     await ThUI.open({ tone: 'info', title: 'Resumen', html: ThUI.rows([['Producto', 'VIP'], ['Total', '$690', 'total']]) });

   - El texto se muestra como texto plano. Para usar HTML pasa { html: '...' } y escapa lo que venga de usuarios con ThUI.esc().
   - Un emoji al inicio del mensaje (✅ ❌ ⚠️ ⏳ ℹ️ 🚫) define el color y el ícono, y se quita del texto.
   - Todas devuelven una promesa: alert/open -> true al cerrar con Aceptar; confirm -> true (Aceptar) o false (Cancelar, Esc, clic fuera).
   - Si hay una ventana abierta, las siguientes esperan su turno en orden.
   ========================================================= */
(function () {
    'use strict';
    if (window.ThUI) return;

    const ICONS = {
        success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 12.5l2.8 2.8L16.5 9"/></svg>',
        error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
        warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.5M12 17.5v.01"/></svg>',
        info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 11v5.5M12 7.5v.01"/></svg>',
        question: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.2 9.3a3 3 0 1 1 4.3 2.7c-.9.5-1.5 1.1-1.5 2.2M12 17.5v.01"/></svg>'
    };

    const TITLES = { success: 'Listo', error: 'Error', warn: 'Atención', info: 'Aviso', question: 'Confirmar' };

    const EMOJI_TONES = [
        [/^(✅|✔️?|🎉)\s*/u, 'success'],
        [/^(❌|🚫|⛔)\s*/u, 'error'],
        [/^(⚠️?|🚨)\s*/u, 'warn'],
        [/^(⏳|ℹ️?|🔒|🔔)\s*/u, 'info']
    ];

    function esc(t) {
        return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // Quita el emoji inicial y devuelve el tono que sugiere
    function parseMessage(msg) {
        let text = String(msg == null ? '' : msg).trim();
        let tone = null;
        for (const [re, t] of EMOJI_TONES) {
            if (re.test(text)) { tone = t; text = text.replace(re, ''); break; }
        }
        return { text, tone };
    }

    function rows(items) {
        return '<div class="th-dialog-rows">' + items.map(([k, v, cls]) =>
            '<div class="th-dialog-row ' + (cls || '') + '"><span>' + k + '</span><strong>' + v + '</strong></div>').join('') + '</div>';
    }

    // ---------- Cola y ventana ----------
    const queue = [];
    let current = null;      // { overlay, resolve, dismissValue, prevFocus, okBtn, cancelBtn }
    let scrollLocks = 0;
    let idCounter = 0;

    function lockScroll() {
        if (scrollLocks++ === 0) document.body.dataset.thPrevOverflow = document.body.style.overflow || '';
        document.body.style.overflow = 'hidden';
    }
    function unlockScroll() {
        if (--scrollLocks <= 0) {
            scrollLocks = 0;
            document.body.style.overflow = document.body.dataset.thPrevOverflow || '';
            delete document.body.dataset.thPrevOverflow;
        }
    }

    function open(opts) {
        return new Promise(resolve => {
            queue.push({ opts: opts || {}, resolve });
            if (!current) showNext();
        });
    }

    function showNext() {
        const next = queue.shift();
        if (!next) return;
        const o = next.opts;
        const id = 'thDialog' + (++idCounter);
        const tone = o.tone || 'info';
        const hasCancel = !!o.cancelText;

        const overlay = document.createElement('div');
        overlay.className = 'th-dialog-overlay';

        const iconKey = o.icon || (hasCancel && !o.tone ? 'question' : tone);
        const title = o.title != null ? o.title : TITLES[iconKey] || TITLES[tone] || '';
        const bodyHtml = o.html != null ? o.html : (o.text ? '<p>' + esc(o.text).replace(/\n/g, '<br>') + '</p>' : '');

        overlay.innerHTML =
            '<div class="th-dialog th-tone-' + esc(tone) + (o.danger ? ' th-danger' : '') + '" role="' + (hasCancel ? 'alertdialog' : 'dialog') + '" aria-modal="true" aria-labelledby="' + id + 't" aria-describedby="' + id + 'b">' +
                '<div class="th-dialog-icon">' + (ICONS[iconKey] || ICONS.info) + '</div>' +
                (title ? '<h3 class="th-dialog-title" id="' + id + 't">' + esc(title) + '</h3>' : '') +
                '<div class="th-dialog-body" id="' + id + 'b">' + bodyHtml + '</div>' +
                '<div class="th-dialog-actions">' +
                    (hasCancel ? '<button type="button" class="modal-btn th-cancel">' + esc(o.cancelText) + '</button>' : '') +
                    '<button type="button" class="modal-btn th-ok">' + esc(o.okText || 'Aceptar') + '</button>' +
                '</div>' +
            '</div>';

        const okBtn = overlay.querySelector('.th-ok');
        const cancelBtn = overlay.querySelector('.th-cancel');
        const dismissValue = hasCancel ? false : true;

        current = { overlay, resolve: next.resolve, dismissValue, prevFocus: document.activeElement, okBtn, cancelBtn };

        okBtn.addEventListener('click', () => close(true));
        if (cancelBtn) cancelBtn.addEventListener('click', () => close(false));
        if (o.dismissible !== false) {
            overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(dismissValue); });
        }

        document.body.appendChild(overlay);
        lockScroll();
        (o.danger && cancelBtn ? cancelBtn : okBtn).focus();
    }

    function close(value) {
        if (!current) return;
        const c = current;
        current = null;
        c.overlay.remove();
        unlockScroll();
        if (c.prevFocus && c.prevFocus.focus && document.contains(c.prevFocus)) { try { c.prevFocus.focus(); } catch (e) { /* ignorar */ } }
        c.resolve(value);
        if (queue.length) showNext();
    }

    document.addEventListener('keydown', e => {
        if (!current) return;
        if (e.key === 'Escape') { e.preventDefault(); close(current.dismissValue); return; }
        if (e.key === 'Tab') {   // el foco se queda dentro de la ventana
            const items = [current.cancelBtn, current.okBtn].filter(Boolean);
            const first = items[0], last = items[items.length - 1];
            if (!items.includes(document.activeElement)) { e.preventDefault(); first.focus(); }
            else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    }, true);

    // ---------- API ----------
    function alertDialog(message, opts) {
        opts = opts || {};
        const p = parseMessage(message);
        const o = Object.assign({}, opts);
        if (o.html == null) o.text = p.text; else o.text = null;
        if (!o.tone) o.tone = p.tone || 'info';
        o.cancelText = null;
        return open(o).then(() => true);
    }

    function confirmDialog(message, opts) {
        opts = opts || {};
        const p = parseMessage(message);
        const o = Object.assign({}, opts);
        if (o.html == null) o.text = p.text; else o.text = null;
        if (!o.tone) o.tone = p.tone || (o.danger ? 'warn' : 'info');
        if (!o.icon && !p.tone && !opts.tone) o.icon = 'question';
        o.okText = o.okText || 'Aceptar';
        o.cancelText = o.cancelText || 'Cancelar';
        return open(o);
    }

    window.ThUI = { open, alert: alertDialog, confirm: confirmDialog, rows, esc };

    // Los campos numéricos no deben cambiar de valor al girar la rueda del mouse por encima
    document.addEventListener('wheel', () => {
        const el = document.activeElement;
        if (el && el.tagName === 'INPUT' && el.type === 'number') el.blur();
    }, { passive: true });
})();
