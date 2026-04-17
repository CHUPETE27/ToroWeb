document.addEventListener("DOMContentLoaded", function() {
    if (window.location.pathname.includes('login.html')) {
        return; 
    }

    const currentPage = window.location.pathname.split("/").pop();
    const isIndex = currentPage === "" || currentPage === "index.html";
    const isPerfil = currentPage === "perfil.html";

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
        logoImg.style.border = '2px solid #FFD342';
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