document.addEventListener("DOMContentLoaded", () => {
    const canvas = document.createElement('canvas');
    canvas.id = 'scanner-bg';
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

    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) {
        console.warn('WebGL2 no está soportado en este navegador.');
        return;
    }

    const vsSource = `#version 300 es
    in vec2 position;
    void main() {
        gl_Position = vec4(position, 0.0, 1.0);
    }`;

    const fsSource = `#version 300 es
    precision highp float;
    uniform vec2 iResolution;
    uniform float iTime;
    
    // Parámetros del Scanner
    uniform float uSpeed, uSweepSpeed, uSweepWidth, uSweepFalloff, uScale, uFrequency, uRipple, uBandDensity, uLineSharpness, uGlow, uColorSpread, uBrightness, uContrast, uSoftness, uVignette, uOpacity, uScanline, uGrain, uGrainIntensity, uDirection;
    
    // Interactividad
    uniform vec2 uMouse;
    uniform float uMouseEnabled, uMouseRadius, uMouseStrength, uMouseActive;
    
    // Paleta de Colores
    uniform vec3 uColor1, uColor2, uColor3;
    
    out vec4 fragColor;
    const float TAU = 6.2831853;

    float signalField(vec2 p, float t) {
        float w = sin(p.x * 1.3 + t * 0.7);
        w += sin(p.y * 1.7 - t * 0.52) * 0.8;
        w += sin((p.x + p.y) * 0.9 + t * 0.91) * 0.6;
        w += sin((p.x - p.y) * 1.53 - t * 0.63) * 0.42;
        return w * 0.35;
    }

    vec3 palette(float f) {
        f = clamp(f, 0.0, 1.0);
        f = pow(f, uContrast);
        vec3 c = mix(uColor1, uColor2, smoothstep(0.08, 0.6, f));
        return mix(c, uColor3, smoothstep(0.68, 1.0, f));
    }

    float scanBand(float x, float aa, float sharp) {
        float v = mix(0.5, 0.5 + 0.5 * cos(x * TAU), aa);
        return pow(v, sharp);
    }

    void main() {
        float aspect = iResolution.x / iResolution.y;
        vec2 uv0 = (gl_FragCoord.xy * 2.0 - iResolution.xy) / iResolution.y;
        vec2 p = uv0 / max(uScale, 0.001);
        float t = iTime * uSpeed;

        float mouseBoost = 0.0;
        if (uMouseEnabled > 0.5) {
            vec2 mUv = vec2((uMouse.x * 2.0 - 1.0) * aspect, uMouse.y * 2.0 - 1.0);
            vec2 md = uv0 - mUv;
            float r = max(uMouseRadius, 0.001);
            mouseBoost = exp(-dot(md, md) / (r * r)) * uMouseStrength * uMouseActive;
        }

        float axis;
        if (uDirection < 0.5) axis = p.y;
        else if (uDirection < 1.5) axis = p.x;
        else axis = (p.x + p.y) * 0.70710678;

        float sig = signalField(p * uFrequency, t);
        float coord = axis + sig * uRipple;

        float phase = coord / max(uSweepWidth, 0.05) - t * uSweepSpeed;
        float sweep = pow(0.5 + 0.5 * cos(phase * TAU), max(uSweepFalloff, 0.1));

        float lc = coord * uBandDensity;
        float aa = 1.0 / (1.0 + uSoftness * fwidth(lc) * 3.0);
        aa = clamp(aa * (1.0 + mouseBoost * 0.6), 0.0, 1.0);

        float bodyBase = clamp(0.5 + 0.5 * sig, 0.0, 1.0);
        float body = bodyBase * bodyBase * uGlow * sweep;

        float sharp = max(uLineSharpness, 0.1);
        float split = uColorSpread * 0.16;
        float fr = clamp(scanBand(lc + split, aa, sharp) * sweep + body, 0.0, 1.0);
        float fg = clamp(scanBand(lc, aa, sharp) * sweep + body, 0.0, 1.0);
        float fb = clamp(scanBand(lc - split, aa, sharp) * sweep + body, 0.0, 1.0);

        vec3 col = vec3(palette(fr).r, palette(fg).g, palette(fb).b);

        float inten = (fr + fg + fb) * 0.3333333 * uBrightness;
        inten *= 1.0 + mouseBoost * 0.9;

        if (uScanline > 0.5) {
            inten *= 1.0 - 0.18 * (0.5 + 0.5 * cos(gl_FragCoord.y * 1.7));
        }

        if (uGrain > 0.5) {
            float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + iTime) * 43758.5453);
            inten += (g - 0.5) * uGrainIntensity;
        }

        inten *= clamp(1.0 - uVignette * smoothstep(0.55, 1.65, length(uv0)), 0.0, 1.0);
        inten = clamp(inten, 0.0, 1.0);

        float a = clamp(inten * uOpacity, 0.0, 1.0);
        fragColor = vec4(clamp(col, 0.0, 1.0) * a, a);
    }`;

    function compileShader(type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        return shader;
    }

    const program = gl.createProgram();
    gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vsSource));
    gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fsSource));
    gl.linkProgram(program);
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const loc = name => gl.getUniformLocation(program, name);
    const setF = (name, v) => gl.uniform1f(loc(name), v);
    const set2F = (name, x, y) => gl.uniform2f(loc(name), x, y);
    const set3F = (name, x, y, z) => gl.uniform3f(loc(name), x, y, z);

    const hexToRgb = hex => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? [
            parseInt(result[1], 16) / 255,
            parseInt(result[2], 16) / 255,
            parseInt(result[3], 16) / 255
        ] : [1, 1, 1];
    };

    const c1 = hexToRgb('#011c18');
    const c2 = hexToRgb('#2df2c1');
    const c3 = hexToRgb('#FFD342');

    set3F('uColor1', c1[0], c1[1], c1[2]);
    set3F('uColor2', c2[0], c2[1], c2[2]);
    set3F('uColor3', c3[0], c3[1], c3[2]);

    setF('uSpeed', 0.5); 
    setF('uSweepSpeed', 0.25); 
    setF('uSweepWidth', 1.6);
    setF('uSweepFalloff', 6); 
    setF('uScale', 1.5); 
    setF('uFrequency', 2);
    setF('uRipple', 0.22); 
    setF('uBandDensity', 11); 
    setF('uLineSharpness', 5.5);
    setF('uGlow', 0.22); 
    setF('uColorSpread', 0.7); 
    setF('uBrightness', 1.0);
    setF('uContrast', 1.15); 
    setF('uSoftness', 1.4); 
    setF('uVignette', 0.45);
    setF('uOpacity', 1.0); 
    setF('uScanline', 1.0); 
    setF('uGrain', 1.0);
    setF('uGrainIntensity', 0.05); 
    setF('uDirection', 0.0);
    setF('uMouseEnabled', 1.0); 
    setF('uMouseRadius', 0.5); 
    setF('uMouseStrength', 0.5);

    let mouseActive = 0, targetMouseActive = 0;
    let mouseX = 0.5, mouseY = 0.5, tMouseX = 0.5, tMouseY = 0.5;

    window.addEventListener('mousemove', e => {
        tMouseX = e.clientX / window.innerWidth;
        tMouseY = 1.0 - (e.clientY / window.innerHeight);
        targetMouseActive = 1.0;
    });
    window.addEventListener('mouseleave', () => targetMouseActive = 0.0);

    function resize() {
        canvas.width = window.innerWidth * (window.devicePixelRatio || 1);
        canvas.height = window.innerHeight * (window.devicePixelRatio || 1);
        gl.viewport(0, 0, canvas.width, canvas.height);
        set2F('iResolution', canvas.width, canvas.height);
    }
    window.addEventListener('resize', resize);
    resize();

    const t0 = performance.now();
    let animFrame;

    function render(t) {
        setF('iTime', (t - t0) * 0.001);
        
        mouseX += (tMouseX - mouseX) * 0.05;
        mouseY += (tMouseY - mouseY) * 0.05;
        mouseActive += (targetMouseActive - mouseActive) * 0.05;
        
        set2F('uMouse', mouseX, mouseY);
        setF('uMouseActive', mouseActive);

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
});