/* ══════════════════════════════════════════════════════════════════════
   Fluid Text — 글자 모양으로 잘라낸 유체 시뮬레이션

   Originkit 의 React 컴포넌트(FluidText)를 이 사이트에 맞게 바닐라로 옮긴 것.
   셰이더와 시뮬레이션 코드는 원본 그대로이고, React 훅·TS 타입만 걷어냈다.
   글자는 2D 캔버스에 그려 알파 마스크로 올리고, 마스크가 있는 픽셀에만
   염료(dye)를 그린다. 포인터가 지나가면 그 자리에 물감이 번진다.

     FluidText(canvasElement, { text, font, color, paletteColors, ... })

   반환값의 destroy() 를 부르면 GL 자원과 이벤트를 모두 정리한다.
   ══════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  var DEFAULT_FONT = {
    fontFamily: 'Inter',
    fontWeight: 700,
    fontSize: '120px',
    lineHeight: '1.5em',
    letterSpacing: '0em',
    textAlign: 'center'
  };

  var DEFAULT_PALETTE = ['#A855F7', '#EC4899', '#3B82F6', '#AFFF00', '#00FFF5'];

  var ALIGNMENTS = { left: 'left', center: 'center', right: 'right', justify: 'left' };

  var DEFAULTS = {
    text: 'StUDiO\nCaNVaS',
    color: '#FFFFFF',
    splatRadius: 9,
    splatForce: 5,
    curl: 12,
    densityDissipation: 3
  };

  var SHADING = true;
  var COLOR_SPEED = 0.125;
  var VELOCITY_DISSIPATION = 2;
  var PRESSURE = 1 / 20;
  var SIM_RESOLUTION = 128;
  var DYE_RESOLUTION = 1440;
  var PRESSURE_ITERATIONS = 20;
  var MAX_COLORS = 5;

  /* ── 색 파싱 ───────────────────────────────────────────────── */

  function parseColor(input, multiplier) {
    var black = { r: 0, g: 0, b: 0 };
    if (typeof input !== 'string' || !input) return black;
    var str = input.trim();

    var rgb = str.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (rgb) {
      return {
        r: (parseFloat(rgb[1]) / 255) * multiplier,
        g: (parseFloat(rgb[2]) / 255) * multiplier,
        b: (parseFloat(rgb[3]) / 255) * multiplier
      };
    }

    var val = str.replace('#', '');
    if (val.length === 3 || val.length === 4) {
      val = val.slice(0, 3).split('').map(function (c) { return c + c; }).join('');
    }
    var n = parseInt(val.slice(0, 6), 16);
    if (!isFinite(n)) return black;
    return {
      r: (((n >> 16) & 255) / 255) * multiplier,
      g: (((n >> 8) & 255) / 255) * multiplier,
      b: ((n & 255) / 255) * multiplier
    };
  }

  function parseRGBA(color) {
    var s = String(color || '').trim();
    var m = s.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)[\s,]*([\d.]*)/i);
    if (m) {
      var a = (m[4] === '' || m[4] === undefined) ? 1 : parseFloat(m[4]);
      return [parseFloat(m[1]) / 255, parseFloat(m[2]) / 255, parseFloat(m[3]) / 255,
              isFinite(a) ? a : 1];
    }
    var c = parseColor(s, 1);
    return [c.r, c.g, c.b, 1];
  }

  function toPx(value, relativeTo, fallback) {
    if (typeof value === 'number') return isFinite(value) ? value : fallback;
    if (typeof value !== 'string') return fallback;
    var n = parseFloat(value);
    if (!isFinite(n)) return fallback;
    if (value.indexOf('em') !== -1) return n * relativeTo;
    if (value.indexOf('%') !== -1) return (n / 100) * relativeTo;
    return n;
  }

  var WEIGHT_NAMES = {
    thin: 100, extralight: 200, ultralight: 200, light: 300,
    regular: 400, normal: 400, book: 400, medium: 500,
    semibold: 600, demibold: 600, bold: 700, extrabold: 800,
    ultrabold: 800, black: 900, heavy: 900
  };

  function fontWeightOf(font) {
    var explicit = parseFloat(font && font.fontWeight);
    if (isFinite(explicit)) return explicit;
    var v = String((font && font.variant) || 'Regular').toLowerCase();
    var digits = v.match(/\d{3}/);
    if (digits) return parseInt(digits[0], 10);
    for (var name in WEIGHT_NAMES) {
      if (v.indexOf(name) !== -1) return WEIGHT_NAMES[name];
    }
    return 400;
  }

  function fontItalicOf(font) {
    var v = String((font && font.variant) || '').toLowerCase();
    return String((font && font.fontStyle) || '').toLowerCase() === 'italic' ||
           v.indexOf('italic') !== -1 || v.indexOf('oblique') !== -1;
  }

  function setCanvasFont(ctx, font, sizePx) {
    var family = String((font && font.fontFamily) || '').trim();
    var stack = family
      ? (/["',]/.test(family) ? family : family + ', sans-serif')
      : 'sans-serif';
    var weight = fontWeightOf(font);
    var style = fontItalicOf(font) ? 'italic ' : '';
    ctx.font = style + weight + ' ' + sizePx + 'px ' + stack;
    if (ctx.font.indexOf(sizePx + 'px') === -1) {
      ctx.font = style + weight + ' ' + sizePx + 'px sans-serif';
    }
  }

  /* ── 셰이더 ────────────────────────────────────────────────── */

  var BASE_VERTEX_SHADER = [
    'precision highp float;',
    'attribute vec2 aPosition;',
    'varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;',
    'uniform vec2 texelSize;',
    'void main () {',
    '  vUv = aPosition * 0.5 + 0.5;',
    '  vL = vUv - vec2(texelSize.x, 0.0);',
    '  vR = vUv + vec2(texelSize.x, 0.0);',
    '  vT = vUv + vec2(0.0, texelSize.y);',
    '  vB = vUv - vec2(0.0, texelSize.y);',
    '  gl_Position = vec4(aPosition, 0.0, 1.0);',
    '}'
  ].join('\n');

  var COPY_SHADER = [
    'precision mediump float; precision mediump sampler2D;',
    'varying highp vec2 vUv; uniform sampler2D uTexture;',
    'void main () { gl_FragColor = texture2D(uTexture, vUv); }'
  ].join('\n');

  var CLEAR_SHADER = [
    'precision mediump float; precision mediump sampler2D;',
    'varying highp vec2 vUv; uniform sampler2D uTexture; uniform float value;',
    'void main () { gl_FragColor = value * texture2D(uTexture, vUv); }'
  ].join('\n');

  var DISPLAY_SHADER = [
    'precision highp float; precision highp sampler2D;',
    'varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;',
    'uniform sampler2D uTexture; uniform sampler2D uMask;',
    'uniform vec2 texelSize; uniform vec4 uBase;',
    'void main () {',
    '  float mask = texture2D(uMask, vUv).a;',
    '  if (mask <= 0.0) discard;',
    '  vec3 c = texture2D(uTexture, vUv).rgb;',
    '  #ifdef SHADING',
    '    vec3 lc = texture2D(uTexture, vL).rgb;',
    '    vec3 rc = texture2D(uTexture, vR).rgb;',
    '    vec3 tc = texture2D(uTexture, vT).rgb;',
    '    vec3 bc = texture2D(uTexture, vB).rgb;',
    '    float dx = length(rc) - length(lc);',
    '    float dy = length(tc) - length(bc);',
    '    vec3 n = normalize(vec3(dx, dy, length(texelSize)));',
    '    vec3 l = vec3(0.0, 0.0, 1.0);',
    '    float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);',
    '    c *= diffuse;',
    '  #endif',
    '  float d = clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0);',
    '  vec3 color = uBase.rgb * uBase.a * (1.0 - d) + c;',
    '  float m = max(color.r, max(color.g, color.b));',
    '  if (m > 1.0) color /= m;',
    '  gl_FragColor = vec4(color, mask * max(uBase.a, d));',
    '}'
  ].join('\n');

  var SPLAT_SHADER = [
    'precision highp float; precision highp sampler2D;',
    'varying vec2 vUv; uniform sampler2D uTarget; uniform float aspectRatio;',
    'uniform vec3 color; uniform vec2 point; uniform float radius;',
    'void main () {',
    '  vec2 p = vUv - point.xy;',
    '  p.x *= aspectRatio;',
    '  vec3 splat = exp(-dot(p, p) / radius) * color;',
    '  vec3 base = texture2D(uTarget, vUv).xyz;',
    '  gl_FragColor = vec4(base + splat, 1.0);',
    '}'
  ].join('\n');

  var ADVECTION_SHADER = [
    'precision highp float; precision highp sampler2D;',
    'varying vec2 vUv; uniform sampler2D uVelocity; uniform sampler2D uSource;',
    'uniform vec2 texelSize; uniform vec2 dyeTexelSize; uniform float dt; uniform float dissipation;',
    'vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {',
    '  vec2 st = uv / tsize - 0.5;',
    '  vec2 iuv = floor(st);',
    '  vec2 fuv = fract(st);',
    '  vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);',
    '  vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);',
    '  vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);',
    '  vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);',
    '  return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);',
    '}',
    'void main () {',
    '  #ifdef MANUAL_FILTERING',
    '    vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;',
    '    vec4 result = bilerp(uSource, coord, dyeTexelSize);',
    '  #else',
    '    vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;',
    '    vec4 result = texture2D(uSource, coord);',
    '  #endif',
    '  float decay = 1.0 + dissipation * dt;',
    '  gl_FragColor = result / decay;',
    '}'
  ].join('\n');

  var DIVERGENCE_SHADER = [
    'precision mediump float; precision mediump sampler2D;',
    'varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR;',
    'varying highp vec2 vT; varying highp vec2 vB; uniform sampler2D uVelocity;',
    'void main () {',
    '  float L = texture2D(uVelocity, vL).x;',
    '  float R = texture2D(uVelocity, vR).x;',
    '  float T = texture2D(uVelocity, vT).y;',
    '  float B = texture2D(uVelocity, vB).y;',
    '  vec2 C = texture2D(uVelocity, vUv).xy;',
    '  if (vL.x < 0.0) { L = -C.x; }',
    '  if (vR.x > 1.0) { R = -C.x; }',
    '  if (vT.y > 1.0) { T = -C.y; }',
    '  if (vB.y < 0.0) { B = -C.y; }',
    '  float div = 0.5 * (R - L + T - B);',
    '  gl_FragColor = vec4(div, 0.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  var CURL_SHADER = [
    'precision mediump float; precision mediump sampler2D;',
    'varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR;',
    'varying highp vec2 vT; varying highp vec2 vB; uniform sampler2D uVelocity;',
    'void main () {',
    '  float L = texture2D(uVelocity, vL).y;',
    '  float R = texture2D(uVelocity, vR).y;',
    '  float T = texture2D(uVelocity, vT).x;',
    '  float B = texture2D(uVelocity, vB).x;',
    '  float vorticity = R - L - T + B;',
    '  gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  var VORTICITY_SHADER = [
    'precision highp float; precision highp sampler2D;',
    'varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;',
    'uniform sampler2D uVelocity; uniform sampler2D uCurl; uniform float curl; uniform float dt;',
    'void main () {',
    '  float L = texture2D(uCurl, vL).x;',
    '  float R = texture2D(uCurl, vR).x;',
    '  float T = texture2D(uCurl, vT).x;',
    '  float B = texture2D(uCurl, vB).x;',
    '  float C = texture2D(uCurl, vUv).x;',
    '  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));',
    '  force /= length(force) + 0.0001;',
    '  force *= curl * C;',
    '  force.y *= -1.0;',
    '  vec2 velocity = texture2D(uVelocity, vUv).xy;',
    '  velocity += force * dt;',
    '  velocity = min(max(velocity, -1000.0), 1000.0);',
    '  gl_FragColor = vec4(velocity, 0.0, 1.0);',
    '}'
  ].join('\n');

  var PRESSURE_SHADER = [
    'precision mediump float; precision mediump sampler2D;',
    'varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR;',
    'varying highp vec2 vT; varying highp vec2 vB;',
    'uniform sampler2D uPressure; uniform sampler2D uDivergence;',
    'void main () {',
    '  float L = texture2D(uPressure, vL).x;',
    '  float R = texture2D(uPressure, vR).x;',
    '  float T = texture2D(uPressure, vT).x;',
    '  float B = texture2D(uPressure, vB).x;',
    '  float divergence = texture2D(uDivergence, vUv).x;',
    '  float pressure = (L + R + B + T - divergence) * 0.25;',
    '  gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  var GRADIENT_SUBTRACT_SHADER = [
    'precision mediump float; precision mediump sampler2D;',
    'varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR;',
    'varying highp vec2 vT; varying highp vec2 vB;',
    'uniform sampler2D uPressure; uniform sampler2D uVelocity;',
    'void main () {',
    '  float L = texture2D(uPressure, vL).x;',
    '  float R = texture2D(uPressure, vR).x;',
    '  float T = texture2D(uPressure, vT).x;',
    '  float B = texture2D(uPressure, vB).x;',
    '  vec2 velocity = texture2D(uVelocity, vUv).xy;',
    '  velocity.xy -= vec2(R - L, T - B);',
    '  gl_FragColor = vec4(velocity, 0.0, 1.0);',
    '}'
  ].join('\n');

  /* ── 본체 ──────────────────────────────────────────────────── */

  function FluidText(canvas, props) {
    if (!canvas) return null;
    props = props || {};

    var font = {};
    var k;
    for (k in DEFAULT_FONT) font[k] = DEFAULT_FONT[k];
    if (props.font) for (k in props.font) font[k] = props.font[k];

    var live = {
      text: props.text != null ? props.text : DEFAULTS.text,
      font: font,
      align: ALIGNMENTS[String(font.textAlign || '').toLowerCase()] || 'center',
      color: props.color || DEFAULTS.color,
      paletteColors: (Array.isArray(props.paletteColors) && props.paletteColors.length)
        ? props.paletteColors.slice(0, MAX_COLORS) : DEFAULT_PALETTE,
      densityDissipation: (props.densityDissipation != null
        ? props.densityDissipation : DEFAULTS.densityDissipation) * 0.5,
      curl: props.curl != null ? props.curl : DEFAULTS.curl,
      splatRadius: (props.splatRadius != null ? props.splatRadius : DEFAULTS.splatRadius) / 20,
      splatForce: (props.splatForce != null ? props.splatForce : DEFAULTS.splatForce) * 1000
    };

    /* 글자 크기를 화면 폭에 맞춰 다시 정하고 싶을 때 쓰는 훅 */
    var sizeFor = typeof props.fontSizeFor === 'function' ? props.fontSizeFor : null;

    var teardown = null;
    var doSplat = null;      /* boot() 안의 splat() 을 밖에서 부르기 위한 손잡이 */
    var colorNow = null;     /* 지금 팔레트 색 */
    var doClear = null;      /* 칠한 물감을 전부 지운다 */

    function boot() {
      var params = {
        alpha: true, depth: false, stencil: false,
        antialias: false, premultipliedAlpha: false
      };
      var isWebGL2 = true;
      var g = canvas.getContext('webgl2', params);
      if (!g) {
        isWebGL2 = false;
        g = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);
      }
      if (!g) return false;

      if (g.isContextLost()) {
        var lose = g.getExtension('WEBGL_lose_context');
        if (lose) lose.restoreContext();
        return false;
      }

      var halfFloat, supportLinearFiltering;
      if (isWebGL2) {
        g.getExtension('EXT_color_buffer_float');
        supportLinearFiltering = g.getExtension('OES_texture_float_linear');
      } else {
        halfFloat = g.getExtension('OES_texture_half_float');
        supportLinearFiltering = g.getExtension('OES_texture_half_float_linear');
      }
      g.clearColor(0, 0, 0, 0);
      var halfFloatTexType = isWebGL2 ? g.HALF_FLOAT : (halfFloat && halfFloat.HALF_FLOAT_OES);

      function supportRenderTextureFormat(internalFormat, format, type) {
        var texture = g.createTexture();
        g.bindTexture(g.TEXTURE_2D, texture);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
        g.texImage2D(g.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
        var fbo = g.createFramebuffer();
        g.bindFramebuffer(g.FRAMEBUFFER, fbo);
        g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, texture, 0);
        var ok = g.checkFramebufferStatus(g.FRAMEBUFFER) === g.FRAMEBUFFER_COMPLETE;
        g.deleteFramebuffer(fbo);
        g.deleteTexture(texture);
        return ok;
      }

      function getSupportedFormat(internalFormat, format, type) {
        if (!supportRenderTextureFormat(internalFormat, format, type)) {
          switch (internalFormat) {
            case g.R16F:  return getSupportedFormat(g.RG16F, g.RG, type);
            case g.RG16F: return getSupportedFormat(g.RGBA16F, g.RGBA, type);
            default:      return null;
          }
        }
        return { internalFormat: internalFormat, format: format };
      }

      var formatRGBA = isWebGL2
        ? getSupportedFormat(g.RGBA16F, g.RGBA, halfFloatTexType)
        : getSupportedFormat(g.RGBA, g.RGBA, halfFloatTexType);
      var formatRG = isWebGL2
        ? getSupportedFormat(g.RG16F, g.RG, halfFloatTexType)
        : getSupportedFormat(g.RGBA, g.RGBA, halfFloatTexType);
      var formatR = isWebGL2
        ? getSupportedFormat(g.R16F, g.RED, halfFloatTexType)
        : getSupportedFormat(g.RGBA, g.RGBA, halfFloatTexType);
      if (!formatRGBA || !formatRG || !formatR) return false;

      function effectiveDyeRes() {
        return supportLinearFiltering ? DYE_RESOLUTION : Math.min(DYE_RESOLUTION, 256);
      }
      function effectiveShading() {
        return supportLinearFiltering ? SHADING : false;
      }

      function hashCode(s) {
        var hash = 0;
        for (var i = 0; i < s.length; i++) {
          hash = (hash << 5) - hash + s.charCodeAt(i);
          hash |= 0;
        }
        return hash;
      }

      function compileShader(type, source, keywords) {
        var withDefines = keywords
          ? keywords.map(function (kw) { return '#define ' + kw + '\n'; }).join('') + source
          : source;
        var shader = g.createShader(type);
        g.shaderSource(shader, withDefines);
        g.compileShader(shader);
        if (!g.getShaderParameter(shader, g.COMPILE_STATUS)) {
          console.warn('Fluid Text shader:', g.getShaderInfoLog(shader));
        }
        return shader;
      }

      function createProgram(vs, fs) {
        var program = g.createProgram();
        g.attachShader(program, vs);
        g.attachShader(program, fs);
        g.linkProgram(program);
        if (!g.getProgramParameter(program, g.LINK_STATUS)) {
          console.warn('Fluid Text link:', g.getProgramInfoLog(program));
        }
        return program;
      }

      function getUniforms(program) {
        var uniforms = {};
        var count = g.getProgramParameter(program, g.ACTIVE_UNIFORMS);
        for (var i = 0; i < count; i++) {
          var name = g.getActiveUniform(program, i).name;
          uniforms[name] = g.getUniformLocation(program, name);
        }
        return uniforms;
      }

      function Program(vs, fs) {
        this.program = createProgram(vs, fs);
        this.uniforms = getUniforms(this.program);
      }
      Program.prototype.bind = function () { g.useProgram(this.program); };

      function Material(vertexShader, fragmentShaderSource) {
        this.vertexShader = vertexShader;
        this.fragmentShaderSource = fragmentShaderSource;
        this.programs = {};
        this.activeProgram = null;
        this.uniforms = {};
      }
      Material.prototype.setKeywords = function (keywords) {
        var hash = 0;
        for (var i = 0; i < keywords.length; i++) hash += hashCode(keywords[i]);
        var program = this.programs[hash];
        if (program == null) {
          var fs = compileShader(g.FRAGMENT_SHADER, this.fragmentShaderSource, keywords);
          program = createProgram(this.vertexShader, fs);
          this.programs[hash] = program;
        }
        if (program === this.activeProgram) return;
        this.uniforms = getUniforms(program);
        this.activeProgram = program;
      };
      Material.prototype.bind = function () { g.useProgram(this.activeProgram); };

      var baseVertexShader = compileShader(g.VERTEX_SHADER, BASE_VERTEX_SHADER);
      var copyProgram = new Program(baseVertexShader, compileShader(g.FRAGMENT_SHADER, COPY_SHADER));
      var clearProgram = new Program(baseVertexShader, compileShader(g.FRAGMENT_SHADER, CLEAR_SHADER));
      var splatProgram = new Program(baseVertexShader, compileShader(g.FRAGMENT_SHADER, SPLAT_SHADER));
      var advectionProgram = new Program(baseVertexShader, compileShader(
        g.FRAGMENT_SHADER, ADVECTION_SHADER,
        supportLinearFiltering ? undefined : ['MANUAL_FILTERING']));
      var divergenceProgram = new Program(baseVertexShader, compileShader(g.FRAGMENT_SHADER, DIVERGENCE_SHADER));
      var curlProgram = new Program(baseVertexShader, compileShader(g.FRAGMENT_SHADER, CURL_SHADER));
      var vorticityProgram = new Program(baseVertexShader, compileShader(g.FRAGMENT_SHADER, VORTICITY_SHADER));
      var pressureProgram = new Program(baseVertexShader, compileShader(g.FRAGMENT_SHADER, PRESSURE_SHADER));
      var gradientSubtractProgram = new Program(baseVertexShader, compileShader(g.FRAGMENT_SHADER, GRADIENT_SUBTRACT_SHADER));
      var displayMaterial = new Material(baseVertexShader, DISPLAY_SHADER);

      var quadBuffer = g.createBuffer();
      var quadIndices = g.createBuffer();
      g.bindBuffer(g.ARRAY_BUFFER, quadBuffer);
      g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), g.STATIC_DRAW);
      g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, quadIndices);
      g.bufferData(g.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), g.STATIC_DRAW);
      g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
      g.enableVertexAttribArray(0);

      function blit(target, clear) {
        if (target == null) {
          g.viewport(0, 0, g.drawingBufferWidth, g.drawingBufferHeight);
          g.bindFramebuffer(g.FRAMEBUFFER, null);
        } else {
          g.viewport(0, 0, target.width, target.height);
          g.bindFramebuffer(g.FRAMEBUFFER, target.fbo);
        }
        if (clear) {
          g.clearColor(0, 0, 0, target == null ? 0 : 1);
          g.clear(g.COLOR_BUFFER_BIT);
        }
        g.drawElements(g.TRIANGLES, 6, g.UNSIGNED_SHORT, 0);
      }

      function createFBO(w, h, internalFormat, format, type, param) {
        g.activeTexture(g.TEXTURE0);
        var texture = g.createTexture();
        g.bindTexture(g.TEXTURE_2D, texture);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, param);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, param);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
        g.texImage2D(g.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
        var fbo = g.createFramebuffer();
        g.bindFramebuffer(g.FRAMEBUFFER, fbo);
        g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, texture, 0);
        g.viewport(0, 0, w, h);
        g.clear(g.COLOR_BUFFER_BIT);
        return {
          texture: texture, fbo: fbo, width: w, height: h,
          texelSizeX: 1 / w, texelSizeY: 1 / h,
          attach: function (id) {
            g.activeTexture(g.TEXTURE0 + id);
            g.bindTexture(g.TEXTURE_2D, texture);
            return id;
          }
        };
      }

      function destroyFBO(target) {
        if (!target) return;
        g.deleteFramebuffer(target.fbo);
        g.deleteTexture(target.texture);
      }
      function destroyDoubleFBO(target) {
        if (!target) return;
        destroyFBO(target.read);
        destroyFBO(target.write);
      }

      function createDoubleFBO(w, h, internalFormat, format, type, param) {
        var fbo1 = createFBO(w, h, internalFormat, format, type, param);
        var fbo2 = createFBO(w, h, internalFormat, format, type, param);
        return {
          width: w, height: h,
          texelSizeX: fbo1.texelSizeX, texelSizeY: fbo1.texelSizeY,
          get read() { return fbo1; },
          set read(v) { fbo1 = v; },
          get write() { return fbo2; },
          set write(v) { fbo2 = v; },
          swap: function () { var t = fbo1; fbo1 = fbo2; fbo2 = t; }
        };
      }

      function resizeFBO(target, w, h, internalFormat, format, type, param) {
        var next = createFBO(w, h, internalFormat, format, type, param);
        copyProgram.bind();
        g.uniform1i(copyProgram.uniforms.uTexture, target.attach(0));
        blit(next);
        destroyFBO(target);
        return next;
      }

      function resizeDoubleFBO(target, w, h, internalFormat, format, type, param) {
        if (target.width === w && target.height === h) return target;
        target.read = resizeFBO(target.read, w, h, internalFormat, format, type, param);
        destroyFBO(target.write);
        target.write = createFBO(w, h, internalFormat, format, type, param);
        target.width = w;
        target.height = h;
        target.texelSizeX = 1 / w;
        target.texelSizeY = 1 / h;
        return target;
      }

      /* 가로로 아주 긴 캔버스(예: 1325x230)에서는 이 계산이 8000px 를 넘는 텍스처를
         요구해 버퍼 생성이 조용히 실패한다. GPU 한도 안으로 줄여서 쓴다. */
      var maxTex = g.getParameter(g.MAX_TEXTURE_SIZE) || 4096;

      function getResolution(resolution) {
        var aspectRatio = g.drawingBufferWidth / g.drawingBufferHeight;
        if (aspectRatio < 1) aspectRatio = 1 / aspectRatio;
        var min = Math.round(resolution);
        var max = Math.round(resolution * aspectRatio);
        var w = g.drawingBufferWidth > g.drawingBufferHeight ? max : min;
        var h = g.drawingBufferWidth > g.drawingBufferHeight ? min : max;

        var biggest = Math.max(w, h);
        if (biggest > maxTex) {
          var k = maxTex / biggest;
          w = Math.max(2, Math.floor(w * k));
          h = Math.max(2, Math.floor(h * k));
        }
        return { width: w, height: h };
      }

      var dye, velocity, divergence, curlFBO, pressureFBO;

      function initFramebuffers() {
        var simRes = getResolution(SIM_RESOLUTION);
        var dyeRes = getResolution(effectiveDyeRes());
        var texType = halfFloatTexType;
        var filtering = supportLinearFiltering ? g.LINEAR : g.NEAREST;
        g.disable(g.BLEND);

        dye = dye
          ? resizeDoubleFBO(dye, dyeRes.width, dyeRes.height, formatRGBA.internalFormat, formatRGBA.format, texType, filtering)
          : createDoubleFBO(dyeRes.width, dyeRes.height, formatRGBA.internalFormat, formatRGBA.format, texType, filtering);
        velocity = velocity
          ? resizeDoubleFBO(velocity, simRes.width, simRes.height, formatRG.internalFormat, formatRG.format, texType, filtering)
          : createDoubleFBO(simRes.width, simRes.height, formatRG.internalFormat, formatRG.format, texType, filtering);

        if (divergence && divergence.width === simRes.width && divergence.height === simRes.height) return;

        destroyFBO(divergence);
        destroyFBO(curlFBO);
        destroyDoubleFBO(pressureFBO);
        divergence = createFBO(simRes.width, simRes.height, formatR.internalFormat, formatR.format, texType, g.NEAREST);
        curlFBO = createFBO(simRes.width, simRes.height, formatR.internalFormat, formatR.format, texType, g.NEAREST);
        pressureFBO = createDoubleFBO(simRes.width, simRes.height, formatR.internalFormat, formatR.format, texType, g.NEAREST);
      }

      function updateKeywords() {
        displayMaterial.setKeywords(effectiveShading() ? ['SHADING'] : []);
      }
      updateKeywords();
      initFramebuffers();

      /* ── 글자 마스크 ── */

      var MASK_UNIT = 8;
      var maskCanvas = document.createElement('canvas');
      var maskTexture = g.createTexture();
      g.activeTexture(g.TEXTURE0 + MASK_UNIT);
      g.bindTexture(g.TEXTURE_2D, maskTexture);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);

      function currentFontSize() {
        if (sizeFor) return sizeFor(canvas.clientWidth, canvas.clientHeight);
        return toPx(live.font.fontSize, 100, 160);
      }

      function paintMask(dpr) {
        var w = Math.max(1, canvas.width);
        var h = Math.max(1, canvas.height);
        maskCanvas.width = w;
        maskCanvas.height = h;
        var ctx = maskCanvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, w, h);

        var f = live.font;
        var fontSize = currentFontSize();
        setCanvasFont(ctx, f, fontSize * dpr);
        try {
          ctx.letterSpacing = (toPx(f.letterSpacing, fontSize, 0) * dpr) + 'px';
        } catch (e) { /* 지원하지 않는 브라우저는 그냥 기본 자간 */ }
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'middle';
        ctx.textAlign = live.align;
        var pad = 8 * dpr;
        var x = live.align === 'left' ? pad : (live.align === 'right' ? w - pad : w / 2);

        var lines = String(live.text == null ? '' : live.text).split('\n');
        var lineHeight = toPx(f.lineHeight, fontSize, fontSize) * dpr || fontSize * dpr;
        var startY = h / 2 - ((lines.length - 1) * lineHeight) / 2;
        for (var i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], x, startY + i * lineHeight);
        }

        g.activeTexture(g.TEXTURE0 + MASK_UNIT);
        g.bindTexture(g.TEXTURE_2D, maskTexture);
        g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true);
        g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, maskCanvas);
        g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
      }

      var maskKey = '';
      function syncMask(dpr) {
        var key = [canvas.width, canvas.height, dpr, live.text, live.align,
                   currentFontSize(), JSON.stringify(live.font)].join('|');
        if (key === maskKey) return;
        maskKey = key;
        paintMask(dpr);
      }
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { maskKey = ''; });
      }

      /* ── 포인터 ── */

      var colorPhase = Math.random();

      function paletteAt(phase) {
        var list = live.paletteColors.length ? live.paletteColors : DEFAULT_PALETTE;
        var t = 0.5;
        if (list.length === 1) return parseColor(list[0], t);
        var scaled = phase * list.length;
        var i = Math.floor(scaled) % list.length;
        var a = parseColor(list[i], t);
        var b = parseColor(list[(i + 1) % list.length], t);
        var f = scaled - Math.floor(scaled);
        return { r: a.r + (b.r - a.r) * f, g: a.g + (b.g - a.g) * f, b: a.b + (b.b - a.b) * f };
      }

      var pointer = {
        texcoordX: 0, texcoordY: 0, prevTexcoordX: 0, prevTexcoordY: 0,
        deltaX: 0, deltaY: 0, moved: false,
        color: paletteAt(colorPhase), clientX: 0, clientY: 0
      };

      function correctRadius(radius) {
        var aspectRatio = canvas.width / canvas.height;
        return aspectRatio > 1 ? radius * aspectRatio : radius;
      }

      function splat(x, y, dx, dy, c) {
        g.disable(g.BLEND);
        splatProgram.bind();
        g.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
        g.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
        g.uniform2f(splatProgram.uniforms.point, x, y);
        g.uniform3f(splatProgram.uniforms.color, dx, dy, 0);
        g.uniform1f(splatProgram.uniforms.radius, correctRadius(live.splatRadius / 100));
        blit(velocity.write);
        velocity.swap();

        g.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
        g.uniform3f(splatProgram.uniforms.color, c.r, c.g, c.b);
        blit(dye.write);
        dye.swap();
      }

      doSplat = splat;
      colorNow = function () { return paletteAt(colorPhase); };

      /* 바깥에서 프레임마다 손을 댈 수 있게 열어 둔 창구.
         시뮬레이션과 같은 프레임·같은 컨텍스트 안에서 뿌려야 확실히 남는다. */
      var hook = typeof props.onFrame === 'function' ? props.onFrame : null;
      var api = {
        paint: function (x, y, dx, dy, gain) {
          var c = paletteAt(colorPhase);
          var k = gain == null ? 1 : gain;
          splat(x, y, dx, dy, { r: c.r * k, g: c.g * k, b: c.b * k });
        },
        clear: function () { doClear(); }
      };

      /* 0 을 곱해 비운다. glClear 로 FBO 를 직접 건드리면 이후 splat 이
         화면에 나타나지 않아, 이 파일이 쓰는 파이프라인을 그대로 탄다. */
      function wipe(target) {
        clearProgram.bind();
        g.uniform1i(clearProgram.uniforms.uTexture, target.read.attach(0));
        g.uniform1f(clearProgram.uniforms.value, 0);
        blit(target.write);
        target.swap();
      }
      doClear = function () {
        g.disable(g.BLEND);
        wipe(dye);
        wipe(velocity);
      };

      function splatPointer() {
        splat(pointer.texcoordX, pointer.texcoordY,
              pointer.deltaX * live.splatForce, pointer.deltaY * live.splatForce,
              pointer.color);
      }

      function clickSplat() {
        var c = paletteAt(colorPhase);
        splat(pointer.texcoordX, pointer.texcoordY,
              10 * (Math.random() - 0.5), 30 * (Math.random() - 0.5),
              { r: c.r * 10, g: c.g * 10, b: c.b * 10 });
      }

      function isInsideHoverZone(clientX, clientY) {
        var rect = canvas.getBoundingClientRect();
        return clientX >= rect.left && clientX <= rect.right &&
               clientY >= rect.top && clientY <= rect.bottom;
      }

      var inside = false;

      function scaleByPixelRatio(input) {
        return Math.floor(input * (window.devicePixelRatio || 1));
      }

      function texcoords(clientX, clientY) {
        var rect = canvas.getBoundingClientRect();
        return {
          x: rect.width > 0 ? (clientX - rect.left) / rect.width : 0,
          y: rect.height > 0 ? 1 - (clientY - rect.top) / rect.height : 0
        };
      }

      function correctDeltaX(delta) {
        var aspectRatio = canvas.width / canvas.height;
        return aspectRatio < 1 ? delta * aspectRatio : delta;
      }
      function correctDeltaY(delta) {
        var aspectRatio = canvas.width / canvas.height;
        return aspectRatio > 1 ? delta / aspectRatio : delta;
      }

      function leave() {
        if (!inside) return;
        inside = false;
        pointer.moved = false;
      }

      function enter(tc) {
        inside = true;
        pointer.prevTexcoordX = tc.x;
        pointer.prevTexcoordY = tc.y;
        pointer.deltaX = 0;
        pointer.deltaY = 0;
        pointer.moved = false;
        pointer.color = paletteAt(colorPhase);
      }

      function onPointerMove(e) {
        if (!isInsideHoverZone(e.clientX, e.clientY)) { leave(); return; }
        var tc = texcoords(e.clientX, e.clientY);
        pointer.clientX = e.clientX;
        pointer.clientY = e.clientY;
        if (!inside) {
          enter(tc);
          pointer.texcoordX = tc.x;
          pointer.texcoordY = tc.y;
          return;
        }
        pointer.prevTexcoordX = pointer.texcoordX;
        pointer.prevTexcoordY = pointer.texcoordY;
        pointer.texcoordX = tc.x;
        pointer.texcoordY = tc.y;
        pointer.deltaX = correctDeltaX(pointer.texcoordX - pointer.prevTexcoordX);
        pointer.deltaY = correctDeltaY(pointer.texcoordY - pointer.prevTexcoordY);
        pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0;
      }

      function onPointerDown(e) {
        if (!isInsideHoverZone(e.clientX, e.clientY)) { leave(); return; }
        var tc = texcoords(e.clientX, e.clientY);
        pointer.clientX = e.clientX;
        pointer.clientY = e.clientY;
        pointer.texcoordX = tc.x;
        pointer.texcoordY = tc.y;
        enter(tc);
        clickSplat();
      }

      function onWindowLeave() { leave(); }
      function onScrollEvent() {
        if (inside && !isInsideHoverZone(pointer.clientX, pointer.clientY)) leave();
      }

      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('pointerdown', onPointerDown, { passive: true });
      document.addEventListener('pointerleave', onWindowLeave);
      window.addEventListener('blur', onWindowLeave);
      window.addEventListener('scroll', onScrollEvent, { passive: true, capture: true });

      function applyInputs() {
        if (!pointer.moved) return;
        pointer.moved = false;
        if (inside) splatPointer();
      }

      /* ── 한 스텝 ── */

      function step(dt) {
        g.disable(g.BLEND);

        curlProgram.bind();
        g.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        g.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
        blit(curlFBO);

        vorticityProgram.bind();
        g.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        g.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
        g.uniform1i(vorticityProgram.uniforms.uCurl, curlFBO.attach(1));
        g.uniform1f(vorticityProgram.uniforms.curl, live.curl);
        g.uniform1f(vorticityProgram.uniforms.dt, dt);
        blit(velocity.write);
        velocity.swap();

        divergenceProgram.bind();
        g.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        g.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
        blit(divergence);

        clearProgram.bind();
        g.uniform1i(clearProgram.uniforms.uTexture, pressureFBO.read.attach(0));
        g.uniform1f(clearProgram.uniforms.value, PRESSURE);
        blit(pressureFBO.write);
        pressureFBO.swap();

        pressureProgram.bind();
        g.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        g.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
        for (var i = 0; i < PRESSURE_ITERATIONS; i++) {
          g.uniform1i(pressureProgram.uniforms.uPressure, pressureFBO.read.attach(1));
          blit(pressureFBO.write);
          pressureFBO.swap();
        }

        gradientSubtractProgram.bind();
        g.uniform2f(gradientSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        g.uniform1i(gradientSubtractProgram.uniforms.uPressure, pressureFBO.read.attach(0));
        g.uniform1i(gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
        blit(velocity.write);
        velocity.swap();

        advectionProgram.bind();
        g.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        if (!supportLinearFiltering) {
          g.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
        }
        var velocityId = velocity.read.attach(0);
        g.uniform1i(advectionProgram.uniforms.uVelocity, velocityId);
        g.uniform1i(advectionProgram.uniforms.uSource, velocityId);
        g.uniform1f(advectionProgram.uniforms.dt, dt);
        g.uniform1f(advectionProgram.uniforms.dissipation, VELOCITY_DISSIPATION);
        blit(velocity.write);
        velocity.swap();

        if (!supportLinearFiltering) {
          g.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
        }
        g.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
        g.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
        g.uniform1f(advectionProgram.uniforms.dissipation, live.densityDissipation);
        blit(dye.write);
        dye.swap();
      }

      function render() {
        g.blendFunc(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA);
        g.enable(g.BLEND);
        displayMaterial.bind();
        if (effectiveShading()) {
          g.uniform2f(displayMaterial.uniforms.texelSize,
                      1 / g.drawingBufferWidth, 1 / g.drawingBufferHeight);
        }
        g.uniform1i(displayMaterial.uniforms.uTexture, dye.read.attach(0));
        g.activeTexture(g.TEXTURE0 + MASK_UNIT);
        g.bindTexture(g.TEXTURE_2D, maskTexture);
        g.uniform1i(displayMaterial.uniforms.uMask, MASK_UNIT);
        var base = parseRGBA(live.color);
        g.uniform4f(displayMaterial.uniforms.uBase, base[0], base[1], base[2], base[3]);
        blit(null, true);
      }

      /* ── 루프 ── */

      var lastUpdateTime = performance.now();
      var lastSimRes = SIM_RESOLUTION;
      var lastDyeRes = effectiveDyeRes();
      var lastShading = effectiveShading();
      var needsResize = true;
      var raf = 0;

      function frame() {
        if (g.isContextLost()) { raf = 0; return; }
        var now = performance.now();
        var dt = Math.min((now - lastUpdateTime) / 1000, 0.016666);
        lastUpdateTime = now;

        var rebuild = false;
        if (needsResize) {
          needsResize = false;
          var w = scaleByPixelRatio(canvas.clientWidth);
          var h = scaleByPixelRatio(canvas.clientHeight);
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
            rebuild = true;
          }
        }
        if (rebuild || SIM_RESOLUTION !== lastSimRes || effectiveDyeRes() !== lastDyeRes) {
          lastSimRes = SIM_RESOLUTION;
          lastDyeRes = effectiveDyeRes();
          initFramebuffers();
        }
        var shadingNow = effectiveShading();
        if (shadingNow !== lastShading) {
          lastShading = shadingNow;
          updateKeywords();
        }

        syncMask(window.devicePixelRatio || 1);

        colorPhase = (colorPhase + dt * COLOR_SPEED) % 1;
        pointer.color = paletteAt(colorPhase);

        if (hook) hook(api);
        applyInputs();
        step(dt);
        render();
        raf = requestAnimationFrame(frame);
      }

      function start() {
        if (raf) return;
        lastUpdateTime = performance.now();
        raf = requestAnimationFrame(frame);
      }
      function stop() {
        if (!raf) return;
        cancelAnimationFrame(raf);
        raf = 0;
      }

      var ro = new ResizeObserver(function () { needsResize = true; });
      ro.observe(canvas);

      var onScreen = true;
      function sync() {
        if (onScreen && !document.hidden) start();
        else stop();
      }
      var io = new IntersectionObserver(function (entries) {
        onScreen = entries[0] ? entries[0].isIntersecting : true;
        sync();
      }, { threshold: 0 });
      io.observe(canvas);
      document.addEventListener('visibilitychange', sync);
      start();

      teardown = function () {
        stop();
        doSplat = null;
        colorNow = null;
        doClear = null;
        ro.disconnect();
        io.disconnect();
        document.removeEventListener('visibilitychange', sync);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerdown', onPointerDown);
        document.removeEventListener('pointerleave', onWindowLeave);
        window.removeEventListener('blur', onWindowLeave);
        window.removeEventListener('scroll', onScrollEvent, { capture: true });
        destroyDoubleFBO(dye);
        destroyDoubleFBO(velocity);
        destroyDoubleFBO(pressureFBO);
        destroyFBO(divergence);
        destroyFBO(curlFBO);
        g.deleteTexture(maskTexture);
        g.deleteBuffer(quadBuffer);
        g.deleteBuffer(quadIndices);
      };

      return true;
    }

    /* 컨텍스트를 잃으면 되살아난 뒤 다시 세운다 */
    function onLost(e) { e.preventDefault(); }
    function onRestored() {
      if (teardown) { teardown(); teardown = null; }
      boot();
    }
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    var ok = boot();

    return {
      ok: ok,

      /* 포인터 없이도 원하는 자리에 물감을 뿌린다.
         x, y 는 0~1 (y 는 아래가 0), dx·dy 는 퍼지는 방향, gain 은 세기. */
      paint: function (x, y, dx, dy, gain) {
        if (!doSplat || !colorNow) return;
        var c = colorNow();
        var k = gain == null ? 1 : gain;
        doSplat(x, y, dx, dy, { r: c.r * k, g: c.g * k, b: c.b * k });
      },

      /* 칠한 물감을 전부 지운다 — 다시 들어왔을 때 처음부터 번지게 하려고 쓴다 */
      clear: function () { if (doClear) doClear(); },

      set: function (patch) {
        for (var key in patch) live[key] = patch[key];
      },
      destroy: function () {
        canvas.removeEventListener('webglcontextlost', onLost);
        canvas.removeEventListener('webglcontextrestored', onRestored);
        if (teardown) { teardown(); teardown = null; }
      }
    };
  }

  global.FluidText = FluidText;
})(window);
