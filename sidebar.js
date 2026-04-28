document.addEventListener("DOMContentLoaded", function() {
    if (window.location.pathname.includes('login.html')) {
        return; 
    }

    const sidebarHTML = `
        <div class="menu-toggle" id="menu-toggle">
            <i class="fa-solid fa-bars"></i>
        </div>
        <nav class="sidebar" id="sidebar">
            <div class="sidebar-top">
                <div class="close-btn" id="close-btn"><i class="fa-solid fa-xmark"></i></div>
                <a href="#" onclick="checkLogin('perfil.html')"><i class="fa-solid fa-user fa-fw"></i> Perfil</a>
                <a href="#" onclick="checkLogin('amigos.html')"><i class="fa-solid fa-user-group fa-fw"></i> Amigos</a>
                <a href="#" onclick="checkLogin('vip.html')"><i class="fa-solid fa-gem fa-fw"></i> VIP</a>
                <a href="#" onclick="checkLogin('tienda.html')"><i class="fa-solid fa-cart-shopping fa-fw"></i> Tienda</a>
                <a href="index.html"><i class="fa-solid fa-house fa-fw"></i> Menú principal</a>
                
                <a href="#" id="sidebar-admin-btn" onclick="checkLogin('admin.html')" style="display: none; color: #FFD342; border-top: 1px dashed #333; margin-top: 10px; padding-top: 15px;">
                    <i class="fa-solid fa-shield-halved fa-fw"></i> Panel Admin
                </a>
            </div>
            <div class="sidebar-bottom">
                <a href="#" class="logout-btn" onclick="confirmarLogout()"><i class="fa-solid fa-right-from-bracket fa-fw"></i> Cerrar sesión</a>
            </div>
        </nav>
    `;

    document.body.insertAdjacentHTML('afterbegin', sidebarHTML);

    const menuToggle = document.getElementById('menu-toggle');
    const closeBtn = document.getElementById('close-btn');
    const sidebar = document.getElementById('sidebar');

    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => sidebar.classList.add('active'));
    }
    if (closeBtn && sidebar) {
        closeBtn.addEventListener('click', () => sidebar.classList.remove('active'));
    }

    document.addEventListener('click', function(event) {
        if (sidebar && sidebar.classList.contains('active')) {
            if (!sidebar.contains(event.target) && !menuToggle.contains(event.target)) {
                sidebar.classList.remove('active');
            }
        }
    });

    const loggedId = localStorage.getItem('toroHaxLoggedId');
    if (loggedId) {
        fetch(`https://torobot-izu5.onrender.com/get-player/${loggedId}`)
        .then(res => res.json())
        .then(data => {
            if (data && data.isAdmin === true) {
                const adminBtn = document.getElementById('sidebar-admin-btn');
                if (adminBtn) adminBtn.style.display = 'block';
            }
        })
        .catch(err => console.log("Error verificando permisos de administrador en el menú lateral."));
    }
});

window.checkLogin = function(page) {
    if (localStorage.getItem('toroHaxLoggedId')) { 
        window.location.href = page; 
    } else { 
        window.location.href = 'login.html'; 
    }
};

window.confirmarLogout = function() {
    if(confirm("⚠️ ¿Estás seguro que quieres cerrar sesión?")) {
        localStorage.removeItem('toroHaxLoggedId');
        window.location.href = 'index.html';
    }
};