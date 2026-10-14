/**
 * Fondo CSS de una camiseta de HaxBall (1, 2 o 3 franjas iguales giradas según el ángulo)
 * @param {Array<string>} colorsArr
 * @param {number|string} angleHax
 */
function fondoAvatarHaxball(colorsArr, angleHax) {
    const cssAngle = (parseInt(angleHax) || 0) + 90;

    if (colorsArr.length === 1) return colorsArr[0];
    if (colorsArr.length === 2) return `linear-gradient(${cssAngle}deg, ${colorsArr[0]} 50%, ${colorsArr[1]} 50%)`;
    return `linear-gradient(${cssAngle}deg, ${colorsArr[0]} 33.33%, ${colorsArr[1]} 33.33% 66.66%, ${colorsArr[2]} 66.66%)`;
}

/**
 * @param {string} elementId
 * @param {Array<string>} colorsArr
 * @param {number|string} angleHax
 * @param {string} textCol
 */
function dibujarAvatarHaxball(elementId, colorsArr, angleHax, textCol) {
    const avatar = document.getElementById(elementId);
    if (!avatar) return;

    avatar.style.background = fondoAvatarHaxball(colorsArr, angleHax);
    avatar.style.color = textCol;
}
