function initAurora() {
    if (document.getElementById('aurora-bg')) return;

    const canvas = document.createElement('canvas');
    canvas.id = 'aurora-bg';
    Object.assign(canvas.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100vw',
        height: '100vh',
        zIndex: '-2',
        pointerEvents: 'none',
    });
    document.body.appendChild(canvas);

    const gl = canvas.getContext('webgl');
    if (!gl) {
        console.warn("WebGL no soportado para el efecto Aurora.");
        return;
    }

    const vsSource = `
        attribute vec2 position;
        void main() {
            gl_Position = vec4(position, 0.0, 1.0);
        }
    `;

    const fsSource = `
        precision highp float;
        uniform vec2 uResolution;
        uniform float uTime;

        void main() {
            vec2 uv = gl_FragCoord.xy / uResolution.xy;
            // Mapeamos Y de -1 a 1 para hacer la matemática simétrica
            vec2 p = uv * 2.0 - 1.0;
            
            float t = uTime * 0.15; // Velocidad del viento solar
            
            // Color base (ToroHax Dark)
            vec3 col = vec3(0.01, 0.09, 0.11); 
            
            // Creamos 4 láminas de luz superpuestas
            for(float i = 1.0; i <= 4.0; i++) {
                // Matemática de las ondas para hacer curvar la luz
                float wave = sin(uv.x * 2.0 * i + t) * 0.3;
                wave += sin(uv.x * 1.5 - t * 1.2 + i * 2.0) * 0.2;
                
                // Distancia a la curva (el centro de la aurora)
                float dist = abs(p.y - wave);
                
                // Cálculo de intensidad (Brillante en el centro, se difumina a los lados)
                float intensity = 0.05 / (dist + 0.05);
                intensity *= smoothstep(1.0, 0.0, abs(p.y)); // Se desvanece arriba y abajo
                
                // Mezcla fluida entre Cyan y Dorado
                vec3 layerCol = mix(
                    vec3(0.18, 0.95, 0.76), // #2df2c1 (Cyan)
                    vec3(1.0, 0.83, 0.26),  // #0e9670 (Dorado)
                    sin(uv.x * 4.0 + t + i) * 0.5 + 0.5
                );
                
                col += layerCol * intensity * 0.5;
            }
            
            // Agregamos una textura ultra fina tipo "scanline" para darle cuerpo
            col -= sin(uv.y * uResolution.y * 3.14) * 0.03;
            
            // Viñeta oscura en los bordes
            col *= smoothstep(1.5, 0.3, length(uv - 0.5));
            
            gl_FragColor = vec4(col, 1.0);
        }
    `;

    function createShader(type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        return shader;
    }

    const program = gl.createProgram();
    gl.attachShader(program, createShader(gl.VERTEX_SHADER, vsSource));
    gl.attachShader(program, createShader(gl.FRAGMENT_SHADER, fsSource));
    gl.linkProgram(program);
    gl.useProgram(program);

    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "uResolution");
    const uTime = gl.getUniformLocation(program, "uTime");

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(uRes, canvas.width, canvas.height);
    }
    window.addEventListener('resize', resize);
    resize();

    let startTime = performance.now();
    let animFrame;

    function render(time) {
        gl.uniform1f(uTime, (time - startTime) * 0.001);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        animFrame = requestAnimationFrame(render);
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            cancelAnimationFrame(animFrame);
        } else {
            animFrame = requestAnimationFrame(render);
        }
    });

    animFrame = requestAnimationFrame(render);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAurora);
} else {
    initAurora();
}