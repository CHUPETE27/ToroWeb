/**
 * @param {string} elementId
 * @param {Array<string>} colorsArr
 * @param {number|string} angleHax
 * @param {string} textCol
 */
function dibujarAvatarHaxball(elementId, colorsArr, angleHax, textCol) {
    const avatar = document.getElementById(elementId);
    if (!avatar) return;

    const cssAngle = (parseInt(angleHax) || 0) + 90;

    if (colorsArr.length === 1) {
        avatar.style.background = colorsArr[0];
    } else if (colorsArr.length === 2) {
        avatar.style.background = `linear-gradient(${cssAngle}deg, ${colorsArr[0]} 50%, ${colorsArr[1]} 50%)`;
    } else {
        avatar.style.background = `linear-gradient(${cssAngle}deg, ${colorsArr[0]} 33.33%, ${colorsArr[1]} 33.33% 66.66%, ${colorsArr[2]} 66.66%)`;
    }
    
    avatar.style.color = textCol;
}