document.addEventListener("DOMContentLoaded", function() {
    if (window.location.pathname.includes('login.html')) {
        return; 
    }

    const currentPage = window.location.pathname.split("/").pop();
    const isIndex = currentPage === "" || currentPage === "index.html";
    const isPerfil = currentPage === "perfil.html";
    const isSeleccion = currentPage === "seleccion.html";

    const logoContainer = document.createElement('div');
    logoContainer.className = 'logo-container';
    logoContainer.style.cursor = 'pointer'; 

    const logoImg = document.createElement('img');
    const loggedId = localStorage.getItem('toroHaxLoggedId');
    const userAvatar = localStorage.getItem('toroHaxUserAvatar');

    if (isPerfil && loggedId && userAvatar) {
        logoImg.src = userAvatar;
        logoImg.alt = 'Mi Perfil';
        logoImg.style.borderRadius = '50%';
        logoImg.style.objectFit = 'cover';
        logoImg.style.border = '2px solid #e1bc56';
    } else if (isSeleccion) {
        logoImg.src = 'path1.png';
        logoImg.alt = 'ToroHax Selección';
    } else {
        logoImg.src = 'logo_torohax.png';
        logoImg.alt = 'ToroHax Logo';
    }

    logoContainer.appendChild(logoImg);

    logoContainer.addEventListener('click', () => {
        if (isIndex) {
            if (typeof checkLogin === 'function') {
                checkLogin('perfil.html');
            } else {
                window.location.href = 'login.html';
            }
        } else {
            window.location.href = 'index.html';
        }
    });

    const mainElement = document.querySelector('main');
    if (mainElement) {
        document.body.insertBefore(logoContainer, mainElement);
    }
});

// Aviso de postulación aceptada o rechazada, en todas las páginas con sesión (estilos: styles.css, sección 18).
// GET /api/postulaciones/notificacion al cargar y cada 45 s solo con la pestaña visible; "Entendido" la marca como vista.
(function () {
    const API = 'https://torobot-izu5.onrender.com/api/postulaciones/notificacion';
    const id = localStorage.getItem('toroHaxLoggedId');
    const token = localStorage.getItem('toroHaxToken');
    if (!id || !token || window.location.pathname.includes('login.html')) return;
    let abierto = false, parado = false;

    async function revisar() {
        if (abierto || parado || document.hidden) return;
        try {
            const r = await fetch(`${API}?numericId=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`);
            if (r.status === 401 || r.status === 404) { parado = true; return; }   // sesión vencida o backend sin la ruta
            const d = await r.json();
            if (d.success && d.notificacion && !abierto) mostrar(d.notificacion);
        } catch (e) { /* Render dormido o sin red: se reintenta en la próxima vuelta */ }
    }

    function mostrar(n) {
        abierto = true;
        const aceptada = n.estado === 'aceptada';
        const overlay = document.createElement('div');
        overlay.className = 'post-aviso-overlay';
        overlay.innerHTML =
            '<div class="post-aviso ' + (aceptada ? 'aceptada' : 'rechazada') + '" role="dialog" aria-modal="true" aria-labelledby="postAvisoTitulo">' +
                (aceptada ? '<div class="post-aviso-confeti" aria-hidden="true"></div>' : '') +
                '<div class="post-aviso-icono" aria-hidden="true"><i class="fa-solid ' + (aceptada ? 'fa-trophy' : 'fa-handshake') + '"></i></div>' +
                '<h3 id="postAvisoTitulo">' + (aceptada ? '¡Felicitaciones!' : 'Gracias por postular') + '</h3>' +
                '<p class="post-aviso-texto"></p>' +
                '<p class="post-aviso-mensaje" hidden></p>' +
                '<p>' + (aceptada ? 'El staff se pondrá en contacto contigo por Discord. ¡Bienvenido al equipo!' : 'Valoramos tu interés en ToroHax. Puedes volver a postular en el próximo periodo.') + '</p>' +
                '<button type="button" class="modal-btn">Entendido</button>' +
            '</div>';
        const texto = overlay.querySelector('.post-aviso-texto');
        const rol = document.createElement('strong');
        rol.textContent = n.tipoNombre || n.tipo;   // texto del servidor: nunca como HTML
        texto.append(aceptada ? 'Tu postulación como ' : 'Esta vez tu postulación como ', rol, aceptada ? ' fue aceptada.' : ' no fue aceptada.');
        if (n.mensajeOpcional) {
            const m = overlay.querySelector('.post-aviso-mensaje');
            m.textContent = n.mensajeOpcional;
            m.hidden = false;
        }
        const btn = overlay.querySelector('button');
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            await fetch(API + '/vista', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ numericId: id, token, id: n.id })
            }).catch(() => null);
            overlay.remove();
            abierto = false;
            revisar();   // por si había otra
        });
        document.body.appendChild(overlay);
        btn.focus();
    }

    document.addEventListener('DOMContentLoaded', revisar);
    setInterval(revisar, 45000);
})();
