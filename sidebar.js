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
                <a href="#" onclick="checkLogin('perfil.html')"><i class="fa-solid fa-user"></i> | Perfil</a>
                <a href="#" onclick="checkLogin('vip.html')"><i class="fa-solid fa-gem"></i> | VIP</a>
                <a href="#" onclick="checkLogin('tienda.html')"><i class="fa-solid fa-cart-shopping"></i> | Tienda</a>
                <a href="index.html"><i class="fa-solid fa-house"></i> | Menú principal</a>
            </div>
            <div class="sidebar-bottom">
                <a href="#" class="logout-btn" onclick="confirmarLogout()"><i class="fa-solid fa-right-from-bracket"></i> | Cerrar sesión</a>
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