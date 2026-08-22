function initLight() {
    if (document.getElementById('light-bg')) return;

    const canvas = document.createElement('canvas');
    canvas.id = 'light-bg';
    Object.assign(canvas.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100vw',
        height: '100vh',
        zIndex: '-2',
        pointerEvents: 'none'
    });
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    let width, height, cx, cy;
    
    const numStars = 600;
    const warpSpeed = 12;
    let stars = [];

    function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
        cx = width / 2;
        cy = height / 2;
    }
    window.addEventListener('resize', resize);
    resize();

    function resetStar(star) {
        star.x = (Math.random() - 0.5) * 3000;
        star.y = (Math.random() - 0.5) * 3000;
        star.z = Math.random() * 2000 + 100;
        star.pz = star.z;

        const rand = Math.random();
        if (rand > 0.9) star.color = '#ffffff';
        else if (rand > 0.6) star.color = '#FFD342';
        else star.color = '#2df2c1';
        
        star.id = Math.random() * 1000;
        return star;
    }

    for (let i = 0; i < numStars; i++) {
        stars.push(resetStar({}));
    }

    let time = 0;

    function draw() {
        ctx.fillStyle = '#01181C';
        ctx.fillRect(0, 0, width, height);

        time += 0.01;

        ctx.translate(cx, cy);
        ctx.rotate(time * 0.2);
        ctx.translate(-cx, -cy);

        for (let star of stars) {
            star.pz = star.z;
            star.z -= warpSpeed;

            if (star.z <= 1) {
                resetStar(star);
                star.pz = star.z;
                continue;
            }

            const fov = 400;
            let px = (star.x / star.z) * fov + cx;
            let py = (star.y / star.z) * fov + cy;
            
            let ppx = (star.x / star.pz) * fov + cx;
            let ppy = (star.y / star.pz) * fov + cy;

            let zAlpha = Math.max(0, 1 - (star.z / 2000));
            let glitter = 0.5 + 0.5 * Math.sin(time * 10 + star.id);
            ctx.globalAlpha = zAlpha * glitter;

            let size = Math.max(0.1, (1 - star.z / 2000) * 4);
            
            ctx.strokeStyle = star.color;
            ctx.lineWidth = size;
            ctx.lineCap = "round";
            
            ctx.beginPath();
            ctx.moveTo(ppx, ppy);
            ctx.lineTo(px, py);
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = zAlpha;
            ctx.beginPath();
            ctx.arc(px, py, size * 0.6, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        
        requestAnimationFrame(draw);
    }
    
    draw();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLight);
} else {
    initLight();
}