
const VS_SOURCE = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
    // Quad covers -1..1
    gl_Position = vec4(a_position, 0, 1);
    // Map -1..1 to 0..1
    v_uv = a_position * 0.5 + 0.5;
    // In WebGL, textures are usually flipped relative to Image/Video elements if not handled.
    // We'll flip Y in fragment shader or here.
    v_uv.y = 1.0 - v_uv.y; 
}
`;

const FS_SOURCE = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_image;
uniform float u_exposure_scale;
uniform float u_gamma_inv;
uniform int u_channel; // 0=RGB, 1=R, 2=G, 3=B
uniform int u_analysis; // 0=None, 1=Zebra
uniform float u_zebra_threshold;
uniform vec2 u_resolution;

float getLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
    vec4 texColor = texture2D(u_image, v_uv);
    vec3 color = texColor.rgb;

    // Exposure
    color *= u_exposure_scale;

    // Analysis (Zebra) or Gamma
    bool isZebra = false;
    if (u_analysis == 1) {
        float luma = getLuma(color);
        if (luma >= u_zebra_threshold) {
            isZebra = true;
            // Stripe pattern: (x + y) % 16 < 8
            // gl_FragCoord is in window pixels
            float stripe = mod(gl_FragCoord.x + gl_FragCoord.y, 32.0); 
            if (stripe < 16.0) {
                 gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); // Black
            } else {
                 gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0); // White
            }
        }
    }

    if (!isZebra) {
        // Gamma
        // fast pow?
        color = pow(clamp(color, 0.0, 1.0), vec3(u_gamma_inv));

        // Channel Selector
        if (u_channel == 1) color = vec3(color.r);
        else if (u_channel == 2) color = vec3(color.g);
        else if (u_channel == 3) color = vec3(color.b);

        gl_FragColor = vec4(color, texColor.a);
    }
}
`;

function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn("WebGL Shader Error:", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function createProgram(gl, vs, fs) {
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.warn("WebGL Program Error:", gl.getProgramInfoLog(program));
        return null; // Return null to fallback
    }
    return program;
}

export function isWebGLAvailable() {
    try {
        const c = document.createElement("canvas");
        return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl")));
    } catch {
        return false;
    }
}

export function createWebGLVideoProcessor(opts) {
    const { canvas, videoEl, getGradeParams, isDefaultGrade, maxProcPixelsVideo } = opts;
    
    // Attempt WebGL context
    let gl = canvas.getContext("webgl", { alpha: false, preserveDrawingBuffer: true });
    if (!gl) gl = canvas.getContext("experimental-webgl", { alpha: false });
    
    if (!gl) return null; // Fallback to 2D

    // Setup Shaders
    const vs = createShader(gl, gl.VERTEX_SHADER, VS_SOURCE);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, FS_SOURCE);
    if (!vs || !fs) return null;

    const program = createProgram(gl, vs, fs);
    if (!program) return null;

    // Lookups
    const loc = {
        position: gl.getAttribLocation(program, "a_position"),
        u_image: gl.getUniformLocation(program, "u_image"),
        u_exposure: gl.getUniformLocation(program, "u_exposure_scale"),
        u_gamma: gl.getUniformLocation(program, "u_gamma_inv"),
        u_channel: gl.getUniformLocation(program, "u_channel"),
        u_analysis: gl.getUniformLocation(program, "u_analysis"),
        u_thresh: gl.getUniformLocation(program, "u_zebra_threshold"),
        u_res: gl.getUniformLocation(program, "u_resolution"),
    };

    // Buffer (Quad)
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
        -1,  1,
         1, -1,
         1,  1,
    ]), gl.STATIC_DRAW);

    // Texture
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const proc = {
        type: 'webgl',
        ready: false,
        naturalW: 0,
        naturalH: 0,
        scale: 1,
        _destroyed: false,
    };

    function ensureSize() {
        if (!videoEl || !videoEl.videoWidth) return false;
        const w = videoEl.videoWidth;
        const h = videoEl.videoHeight;
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
            gl.viewport(0, 0, w, h);
        }
        return true;
    }

    function render(overrideParams) {
        if (proc._destroyed) return;
        if (!ensureSize()) return;

        const params = overrideParams || (getGradeParams ? getGradeParams() : {});

        gl.useProgram(program);

        // Upload texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoEl);
        } catch (e) {
            // Tainted? source broken?
            return; 
        }
        gl.uniform1i(loc.u_image, 0);

        // Uniforms
        const exposureEV = Number(params.exposureEV) || 0;
        const gamma = Math.max(0.1, Math.min(3, Number(params.gamma) || 1));
        const analysis = params.analysisMode === 'zebra' ? 1 : 0;
        
        let ch = 0;
        if (params.channel === 'r') ch = 1;
        if (params.channel === 'g') ch = 2;
        if (params.channel === 'b') ch = 3;

        gl.uniform1f(loc.u_exposure, Math.pow(2, exposureEV));
        gl.uniform1f(loc.u_gamma, 1.0 / gamma);
        gl.uniform1i(loc.u_channel, ch);
        gl.uniform1i(loc.u_analysis, analysis);
        gl.uniform1f(loc.u_thresh, params.zebraThreshold ?? 0.95);
        gl.uniform2f(loc.u_res, canvas.width, canvas.height);

        // Draw
        gl.enableVertexAttribArray(loc.position);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.vertexAttribPointer(loc.position, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // Return the processor interface expected by Viewer
    return {
        update: render, 
        destroy: () => {
            proc._destroyed = true;
            gl.deleteProgram(program);
            gl.deleteShader(vs);
            gl.deleteShader(fs);
            gl.deleteTexture(texture);
            gl.deleteBuffer(positionBuffer);
            // Lost context?
        }
    };
}
