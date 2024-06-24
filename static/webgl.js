// PichaStudio WebGL2 Engine: real-time linear-RGB photo grading on the GPU

(function (global) {
  const VERT_SRC = `#version 300 es
  in vec2 a_pos;
  in vec2 a_uv;
  uniform vec2 u_scale;
  uniform vec2 u_offset;
  out vec2 v_uv;
  void main() {
    vec2 p = a_pos * u_scale + u_offset;
    gl_Position = vec4(p, 0.0, 1.0);
    v_uv = a_uv;
  }`;

  const FRAG_SRC = `#version 300 es
  precision highp float;

  in vec2 v_uv;
  out vec4 outColor;

  uniform sampler2D u_image;
  uniform sampler2D u_curveLut;
  uniform vec2 u_texelSize;

  uniform float u_exposure;
  uniform float u_contrast;
  uniform float u_highlights;
  uniform float u_shadows;
  uniform float u_whites;
  uniform float u_blacks;
  uniform float u_temp;
  uniform float u_tint;
  uniform float u_vibrance;
  uniform float u_saturation;
  uniform float u_clarity;
  uniform float u_dehaze;
  uniform float u_vignette;
  uniform float u_vignetteMid;
  uniform float u_grain;
  uniform float u_sharpen;
  uniform float u_blur;
  uniform int u_bw;

  // Split toning
  uniform float u_shHue;
  uniform float u_shSat;
  uniform float u_hlHue;
  uniform float u_hlSat;
  uniform float u_stBal;

  // HSL 8 channels: (h, s, l)
  uniform vec3 u_hsl[8];

  // Transform & view flags
  uniform float u_angleRad;
  uniform vec2 u_flip;
  uniform vec4 u_crop; // x, y, w, h
  uniform float u_aspectRatio;
  uniform int u_compareOriginal;
  uniform int u_showClipping;

  vec3 srgbToLinear(vec3 c) {
    bvec3 low = lessThanEqual(c, vec3(0.04045));
    vec3 a = c / 12.92;
    vec3 b = pow(max((c + 0.055) / 1.055, vec3(0.0)), vec3(2.4));
    return mix(b, a, low);
  }

  vec3 linearToSrgb(vec3 c) {
    c = clamp(c, 0.0, 1.0);
    bvec3 low = lessThanEqual(c, vec3(0.0031308));
    vec3 a = c * 12.92;
    vec3 b = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
    return mix(b, a, low);
  }

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1e-6;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  vec3 hsl2rgb(float hDeg, float s, float l) {
    float c = (1.0 - abs(2.0 * l - 1.0)) * s;
    float h = mod(hDeg, 360.0) / 60.0;
    float x = c * (1.0 - abs(mod(h, 2.0) - 1.0));
    vec3 rgb = vec3(0.0);
    if (h < 1.0) rgb = vec3(c, x, 0.0);
    else if (h < 2.0) rgb = vec3(x, c, 0.0);
    else if (h < 3.0) rgb = vec3(0.0, c, x);
    else if (h < 4.0) rgb = vec3(0.0, x, c);
    else if (h < 5.0) rgb = vec3(x, 0.0, c);
    else rgb = vec3(c, 0.0, x);
    return rgb + (l - 0.5 * c);
  }

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  vec2 transformUV(vec2 uv) {
    vec2 p = uv;
    if (u_flip.x < 0.0) p.x = 1.0 - p.x;
    if (u_flip.y < 0.0) p.y = 1.0 - p.y;
    // Rotate around center respecting aspect ratio
    vec2 c = p - 0.5;
    c.x *= u_aspectRatio;
    float s = sin(u_angleRad);
    float co = cos(u_angleRad);
    vec2 r = vec2(c.x * co - c.y * s, c.x * s + c.y * co);
    r.x /= u_aspectRatio;
    return r + 0.5;
  }

  vec4 sampleBlur(vec2 uv, float radius) {
    vec2 off = u_texelSize * radius;
    vec4 acc = texture(u_image, uv) * 0.25;
    acc += texture(u_image, uv + vec2(off.x, 0.0)) * 0.125;
    acc += texture(u_image, uv - vec2(off.x, 0.0)) * 0.125;
    acc += texture(u_image, uv + vec2(0.0, off.y)) * 0.125;
    acc += texture(u_image, uv - vec2(0.0, off.y)) * 0.125;
    acc += texture(u_image, uv + off) * 0.0625;
    acc += texture(u_image, uv - off) * 0.0625;
    acc += texture(u_image, uv + vec2(off.x, -off.y)) * 0.0625;
    acc += texture(u_image, uv + vec2(-off.x, off.y)) * 0.0625;
    return acc;
  }

  void main() {
    // Map viewport UV into crop rect
    vec2 croppedUV = u_crop.xy + v_uv * u_crop.zw;
    vec2 uv = transformUV(croppedUV);

    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      outColor = vec4(0.05, 0.05, 0.06, 1.0);
      return;
    }

    vec4 tex = texture(u_image, uv);
    if (u_compareOriginal == 1) {
      outColor = tex;
      return;
    }

    vec3 col = tex.rgb;
    if (u_blur > 0.2) {
      col = sampleBlur(uv, u_blur * 1.4).rgb;
    }

    // Linear RGB stage
    vec3 lin = srgbToLinear(col);

    // White Balance
    float tv = u_temp / 100.0;
    float nv = u_tint / 100.0;
    vec3 wb = clamp(vec3(1.0 + tv * 0.28 + nv * 0.12, 1.0 - nv * 0.22, 1.0 - tv * 0.28 + nv * 0.12), 0.2, 3.0);
    lin *= wb;

    // Exposure
    lin *= exp2(u_exposure);

    // Dehaze
    if (abs(u_dehaze) > 0.5) {
      float dh = u_dehaze / 100.0;
      lin = max((lin - 0.04 * dh) / max(0.2, 1.0 - 0.18 * dh), vec3(0.0));
    }

    vec3 srgb = linearToSrgb(lin);

    // Contrast
    if (abs(u_contrast) > 0.5) {
      float cf = 1.0 + (u_contrast / 100.0) * 0.85;
      srgb = clamp((srgb - 0.5) * cf + 0.5, 0.0, 1.0);
    }

    // Highlights / Shadows / Whites / Blacks
    float luma = dot(srgb, vec3(0.2126, 0.7152, 0.0722));
    if (abs(u_highlights) > 0.5) {
      float m = clamp((luma - 0.5) * 2.0, 0.0, 1.0);
      srgb = clamp(srgb + m * (u_highlights / 100.0) * 0.35, 0.0, 1.0);
    }
    if (abs(u_shadows) > 0.5) {
      float m = clamp((0.5 - luma) * 2.0, 0.0, 1.0);
      srgb = clamp(srgb + m * (u_shadows / 100.0) * 0.38, 0.0, 1.0);
    }
    if (abs(u_whites) > 0.5) {
      float m = clamp((luma - 0.75) * 4.0, 0.0, 1.0);
      srgb = clamp(srgb + m * (u_whites / 100.0) * 0.25, 0.0, 1.0);
    }
    if (abs(u_blacks) > 0.5) {
      float m = clamp((0.25 - luma) * 4.0, 0.0, 1.0);
      srgb = clamp(srgb + m * (u_blacks / 100.0) * 0.25, 0.0, 1.0);
    }

    // Clarity
    if (abs(u_clarity) > 0.5) {
      vec3 blurC = sampleBlur(uv, 5.0).rgb;
      srgb = clamp(srgb + (srgb - blurC) * (u_clarity / 100.0) * 0.65, 0.0, 1.0);
    }

    // Tone Curves (per-channel then master RGB)
    float cr = texture(u_curveLut, vec2(srgb.r, 0.5)).r;
    float cg = texture(u_curveLut, vec2(srgb.g, 0.5)).g;
    float cb = texture(u_curveLut, vec2(srgb.b, 0.5)).b;
    srgb.r = texture(u_curveLut, vec2(cr, 0.5)).a;
    srgb.g = texture(u_curveLut, vec2(cg, 0.5)).a;
    srgb.b = texture(u_curveLut, vec2(cb, 0.5)).a;

    // HSL Mixer (8 centers)
    float centers[8] = float[8](0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 280.0, 320.0);
    vec3 hsv = rgb2hsv(srgb);
    float hDeg = hsv.x * 360.0;
    for (int i = 0; i < 8; i++) {
      vec3 adj = u_hsl[i];
      if (abs(adj.x) > 0.5 || abs(adj.y) > 0.5 || abs(adj.z) > 0.5) {
        float diff = abs(mod(hDeg - centers[i] + 180.0, 360.0) - 180.0);
        float w = clamp(1.0 - diff / 35.0, 0.0, 1.0) * clamp(hsv.y * 4.0, 0.0, 1.0);
        hsv.x = fract((hDeg + w * (adj.x * 0.45)) / 360.0);
        hsv.y = clamp(hsv.y * (1.0 + w * (adj.y / 100.0)), 0.0, 1.0);
        hsv.z = clamp(hsv.z + w * (adj.z / 100.0) * 0.35, 0.0, 1.0);
        hDeg = hsv.x * 360.0;
      }
    }
    srgb = hsv2rgb(hsv);

    // Vibrance, Saturation, B&W
    luma = dot(srgb, vec3(0.2126, 0.7152, 0.0722));
    if (u_bw == 1) {
      srgb = vec3(luma);
    } else if (abs(u_vibrance) > 0.5 || abs(u_saturation) > 0.5) {
      float satF = 1.0 + u_saturation / 100.0;
      float maxC = max(srgb.r, max(srgb.g, srgb.b));
      float minC = min(srgb.r, min(srgb.g, srgb.b));
      float vibF = (u_vibrance / 100.0) * (1.0 - (maxC - minC));
      srgb = clamp(mix(vec3(luma), srgb, satF + vibF), 0.0, 1.0);
    }

    // Split Toning
    if (u_shSat > 0.5 || u_hlSat > 0.5) {
      luma = dot(srgb, vec3(0.2126, 0.7152, 0.0722));
      float pivot = 0.5 - (u_stBal / 200.0);
      float shW = clamp((pivot - luma) / max(0.05, pivot), 0.0, 1.0) * (u_shSat / 100.0) * 0.35;
      float hlW = clamp((luma - pivot) / max(0.05, 1.0 - pivot), 0.0, 1.0) * (u_hlSat / 100.0) * 0.35;
      vec3 shCol = hsl2rgb(u_shHue, 1.0, 0.5);
      vec3 hlCol = hsl2rgb(u_hlHue, 1.0, 0.5);
      srgb = mix(srgb, shCol, shW);
      srgb = mix(srgb, hlCol, hlW);
    }

    // Sharpen (Unsharp mask)
    if (u_sharpen > 0.5) {
      vec3 blurS = sampleBlur(uv, 1.2).rgb;
      srgb = clamp(srgb + (srgb - blurS) * (u_sharpen / 100.0) * 1.4, 0.0, 1.0);
    }

    // Vignette
    if (abs(u_vignette) > 0.5) {
      vec2 n = v_uv * 2.0 - 1.0;
      float dist = length(n);
      float mid = u_vignetteMid / 100.0;
      float vig = clamp((dist - mid) / max(0.1, 1.45 - mid), 0.0, 1.0);
      srgb = clamp(srgb + vig * (u_vignette / 100.0) * 0.75, 0.0, 1.0);
    }

    // Film Grain
    if (u_grain > 0.5) {
      float n = (hash12(v_uv * 1200.0) - 0.5) * (u_grain / 100.0) * 0.18;
      srgb = clamp(srgb + n, 0.0, 1.0);
    }

    // Clipping Warnings (J key)
    if (u_showClipping == 1) {
      if (srgb.r >= 0.995 && srgb.g >= 0.995 && srgb.b >= 0.995) {
        srgb = vec3(1.0, 0.15, 0.15);
      } else if (srgb.r <= 0.005 && srgb.g <= 0.005 && srgb.b <= 0.005) {
        srgb = vec3(0.15, 0.35, 1.0);
      }
    }

    outColor = vec4(srgb, tex.a);
  }`;

  const HSL_ORDER = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"];

  class PichaWebGL {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, premultipliedAlpha: false });
      if (!this.gl) {
        throw new Error("WebGL2 is not working on this browser.");
      }
      this.program = this._createProgram(VERT_SRC, FRAG_SRC);
      this.vao = this._createQuad();
      this.imgTex = null;
      this.curveTex = this._createCurveTexture();
      this.imgWidth = 1;
      this.imgHeight = 1;
    }

    _compile(type, src) {
      const gl = this.gl;
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(s));
      }
      return s;
    }

    _createProgram(vs, fs) {
      const gl = this.gl;
      const p = gl.createProgram();
      gl.attachShader(p, this._compile(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, this._compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(p));
      }
      return p;
    }

    _createQuad() {
      const gl = this.gl;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const data = new Float32Array([
        -1, -1, 0, 1,
         1, -1, 1, 1,
        -1,  1, 0, 0,
         1,  1, 1, 0,
      ]);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

      const posLoc = gl.getAttribLocation(this.program, "a_pos");
      const uvLoc = gl.getAttribLocation(this.program, "a_uv");
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(uvLoc);
      gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);
      return vao;
    }

    _createCurveTexture() {
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      const identity = new Uint8Array(256 * 4);
      for (let i = 0; i < 256; i++) {
        identity[i * 4 + 0] = i;
        identity[i * 4 + 1] = i;
        identity[i * 4 + 2] = i;
        identity[i * 4 + 3] = i;
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, identity);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    }

    updateCurveLUT(rLut, gLut, bLut, rgbLut) {
      const gl = this.gl;
      const data = new Uint8Array(256 * 4);
      for (let i = 0; i < 256; i++) {
        data[i * 4 + 0] = Math.round(rLut[i] * 255);
        data[i * 4 + 1] = Math.round(gLut[i] * 255);
        data[i * 4 + 2] = Math.round(bLut[i] * 255);
        data[i * 4 + 3] = Math.round(rgbLut[i] * 255);
      }
      gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }

    loadImage(img) {
      const gl = this.gl;
      if (this.imgTex) gl.deleteTexture(this.imgTex);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.imgTex = tex;
      this.imgWidth = img.naturalWidth || img.width;
      this.imgHeight = img.naturalHeight || img.height;
    }

    getImageScreenRect(edits, view) {
      const cw = this.canvas.width;
      const ch = this.canvas.height;
      const crop = edits.transform.crop;
      const effW = this.imgWidth * crop.w;
      const effH = this.imgHeight * crop.h;
      const fitScale = Math.min((cw * 0.88) / effW, (ch * 0.88) / effH);
      const drawW = effW * fitScale * view.zoom;
      const drawH = effH * fitScale * view.zoom;
      const cx = cw * 0.5 + view.panX;
      const cy = ch * 0.5 + view.panY;
      return {
        x: cx - drawW * 0.5,
        y: cy - drawH * 0.5,
        w: drawW,
        h: drawH,
      };
    }

    render(edits, view) {
      if (!this.imgTex) return;
      const gl = this.gl;
      const cw = this.canvas.width;
      const ch = this.canvas.height;
      gl.viewport(0, 0, cw, ch);
      gl.clearColor(0.05, 0.05, 0.06, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(this.program);
      gl.bindVertexArray(this.vao);

      const rect = this.getImageScreenRect(edits, view);
      const sx = rect.w / cw;
      const sy = rect.h / ch;
      const ox = (view.panX * 2.0) / cw;
      const oy = -(view.panY * 2.0) / ch;

      const u = (name) => gl.getUniformLocation(this.program, name);
      gl.uniform2f(u("u_scale"), sx, sy);
      gl.uniform2f(u("u_offset"), ox, oy);
      gl.uniform2f(u("u_texelSize"), 1.0 / this.imgWidth, 1.0 / this.imgHeight);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
      gl.uniform1i(u("u_image"), 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
      gl.uniform1i(u("u_curveLut"), 1);

      gl.uniform1f(u("u_exposure"), edits.exposure);
      gl.uniform1f(u("u_contrast"), edits.contrast);
      gl.uniform1f(u("u_highlights"), edits.highlights);
      gl.uniform1f(u("u_shadows"), edits.shadows);
      gl.uniform1f(u("u_whites"), edits.whites);
      gl.uniform1f(u("u_blacks"), edits.blacks);
      gl.uniform1f(u("u_temp"), edits.temp);
      gl.uniform1f(u("u_tint"), edits.tint);
      gl.uniform1f(u("u_vibrance"), edits.vibrance);
      gl.uniform1f(u("u_saturation"), edits.saturation);
      gl.uniform1f(u("u_clarity"), edits.clarity);
      gl.uniform1f(u("u_dehaze"), edits.dehaze);
      gl.uniform1f(u("u_vignette"), edits.vignette);
      gl.uniform1f(u("u_vignetteMid"), edits.vignette_midpoint);
      gl.uniform1f(u("u_grain"), edits.grain);
      gl.uniform1f(u("u_sharpen"), edits.sharpen);
      gl.uniform1f(u("u_blur"), edits.blur);
      gl.uniform1i(u("u_bw"), edits.bw ? 1 : 0);

      gl.uniform1f(u("u_shHue"), edits.split_tone.shadow_hue);
      gl.uniform1f(u("u_shSat"), edits.split_tone.shadow_sat);
      gl.uniform1f(u("u_hlHue"), edits.split_tone.highlight_hue);
      gl.uniform1f(u("u_hlSat"), edits.split_tone.highlight_sat);
      gl.uniform1f(u("u_stBal"), edits.split_tone.balance);

      const hslVec = new Float32Array(24);
      HSL_ORDER.forEach((name, idx) => {
        const chVal = edits.hsl[name] || { h: 0, s: 0, l: 0 };
        hslVec[idx * 3 + 0] = chVal.h;
        hslVec[idx * 3 + 1] = chVal.s;
        hslVec[idx * 3 + 2] = chVal.l;
      });
      gl.uniform3fv(u("u_hsl"), hslVec);

      const totalDeg = edits.transform.rotate_deg + edits.transform.straighten_deg;
      gl.uniform1f(u("u_angleRad"), (totalDeg * Math.PI) / 180.0);
      gl.uniform2f(u("u_flip"), edits.transform.flip_h ? -1.0 : 1.0, edits.transform.flip_v ? -1.0 : 1.0);
      const c = edits.transform.crop;
      gl.uniform4f(u("u_crop"), c.x, c.y, c.w, c.h);
      gl.uniform1f(u("u_aspectRatio"), this.imgWidth / Math.max(1, this.imgHeight));
      gl.uniform1i(u("u_compareOriginal"), view.compareOriginal ? 1 : 0);
      gl.uniform1i(u("u_showClipping"), view.showClipping ? 1 : 0);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  global.PichaWebGL = PichaWebGL;
})(window);
