function initRain() {
    if (document.getElementById('rain-bg')) return;

    const canvas = document.createElement('canvas');
    canvas.id = 'rain-bg';
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

    const ctx = canvas.getContext('2d', { alpha: true });
    let width, height;
    
    const pixelSize = 3;
    let drops = [];

    function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
        const maxDrops = Math.floor(width / 80); 
        
        drops = [];
        for (let i = 0; i < maxDrops; i++) {
            drops.push({
                x: Math.random() * width,
                y: Math.random() * -height * 2,
                speed: Math.random() * 0.3 + 0.15,
                length: Math.floor(Math.random() * 30 + 15),
                color: Math.random() > 0.8 ? '#FFD342' : '#2df2c1'
            });
        }
    }
    window.addEventListener('resize', resize);
    resize();

    function draw() {
        ctx.fillStyle = 'rgba(3, 70, 65, 0.08)';
        ctx.fillRect(0, 0, width, height);

        for (let i = 0; i < drops.length; i++) {
            const drop = drops[i];

            for (let j = 0; j < drop.length; j++) {
                const tailY = drop.y - (j * pixelSize);
                if (tailY < 0 || tailY > height) continue;

                if (j === 0) {
                    ctx.fillStyle = '#ffffff';
                } else {
                    ctx.fillStyle = drop.color;
                }
                
                ctx.globalAlpha = Math.max(0, 1 - (j / drop.length));
                ctx.fillRect(drop.x, tailY, pixelSize, pixelSize);
                ctx.globalAlpha = 1.0;
            }

            drop.y += drop.speed * pixelSize;

            if (drop.y - (drop.length * pixelSize) > height && Math.random() > 0.98) {
                drop.y = Math.random() * -100;
                drop.x = Math.random() * width; 
                drop.speed = Math.random() * 0.3 + 0.15;
            }
        }
        requestAnimationFrame(draw);
    }
    draw();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRain);
} else {
    initRain();
}