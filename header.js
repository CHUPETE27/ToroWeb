document.addEventListener('DOMContentLoaded', () => {
    const headerHTML = `
        <div class="nav-container">
            <div class="logo">
                <img src="logo_torohax.png" alt="ToroHax Logo">
                ToroHax
            </div>
            
            <button class="mobile-menu-btn" onclick="toggleSidebar()">
                <i class="fa-solid fa-bars"></i>
            </button>

            <nav class="desktop-nav">
                <a href="index.html">Inicio</a>
                <a href="ranking.html">Rankings</a>
                <a href="toromatch.html">ToroMatch</a>
                <a href="salas.html">Salas</a>
                <a href="tienda.html">Tienda</a>
                <div id="header-profile-btn-container"></div>
            </nav>
        </div>
    `;

    document.querySelector('header').innerHTML = headerHTML;

    const loggedId = localStorage.getItem('toroHaxLoggedId');
    const userAvatar = localStorage.getItem('toroHaxUserAvatar'); // Traemos la foto guardada
    const profileBtnContainer = document.getElementById('header-profile-btn-container');

    if (loggedId) {
        if (userAvatar) {
            profileBtnContainer.innerHTML = `
                <a href="perfil.html" class="profile-btn" style="padding: 5px; border-radius: 50%;">
                    <img src="${userAvatar}" alt="Perfil" style="width: 30px; height: 30px; border-radius: 50%; object-fit: cover;">
                </a>
            `;
        } else {
            profileBtnContainer.innerHTML = `
                <a href="perfil.html" class="profile-btn">
                    <i class="fa-solid fa-user"></i> Mi Perfil
                </a>
            `;
        }
    } else {
        profileBtnContainer.innerHTML = `
            <a href="login.html" class="login-btn">
                <i class="fa-solid fa-right-to-bracket"></i> Iniciar Sesión
            </a>
        `;
    }
});

function toggleSidebar() {
    const sidebar = document.getElementById('mobileSidebar');
    if (sidebar) {
        sidebar.classList.toggle('active');
    }
}