/* =====================================================================
   LIQUID SKY — a live, time-aware sky.

   One full-page WebGL canvas behind the whole site. Variant B ran eight
   separate WebGL contexts (248MB of texture, four rounds of perf fixes);
   this is one context, so the sky itself becomes the effect instead of
   eight separate cards.

   The palette is driven by the visitor's actual clock, so someone
   booking lunch and someone booking a nightcap see different sites —
   and at 11pm the deep-night sky says "still open" before you read a
   word. The restaurant runs 6pm-12:30am, so dusk and night are tuned
   hardest.
   ===================================================================== */
(function (global) {
  'use strict';

  var VERT = [
    'attribute vec2 a_pos;',
    'void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }'
  ].join('\n');

  var FRAG = [
    'precision highp float;',
    'uniform vec2  u_res;',
    'uniform float u_time;',
    'uniform float u_tod;',      // 0..1 through the day
    'uniform float u_reduced;',  // 1.0 = prefers-reduced-motion
    '',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float noise(vec2 p){',
    '  vec2 i = floor(p), f = fract(p);',
    '  vec2 u = f*f*(3.0-2.0*f);',
    '  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x),',
    '             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);',
    '}',
    'float fbm(vec2 p){',
    '  float v = 0.0, a = 0.5;',
    '  for(int i = 0; i < 3; i++){ v += a * noise(p); p *= 2.02; a *= 0.5; }',
    '  return v;',
    '}',
    '',
    /* Four keyed skies. Dusk is the signature — it is what the place is
       named for — so it gets the widest band in the blend below. */
    'void palette(float t, out vec3 top, out vec3 mid, out vec3 hor, out vec3 glow){',
    '  vec3 dawnTop = vec3(0.13,0.11,0.16), dawnMid = vec3(0.44,0.30,0.24), dawnHor = vec3(0.86,0.62,0.40), dawnGlow = vec3(0.92,0.63,0.34);',
    '  vec3 dayTop  = vec3(0.33,0.40,0.50), dayMid  = vec3(0.62,0.60,0.56), dayHor  = vec3(0.85,0.76,0.64), dayGlow  = vec3(0.94,0.83,0.66);',
    '  vec3 duskTop = vec3(0.09,0.07,0.09), duskMid = vec3(0.35,0.20,0.12), duskHor = vec3(0.88,0.48,0.18), duskGlow = vec3(0.88,0.52,0.20);',
    '  vec3 niteTop = vec3(0.030,0.024,0.016), niteMid = vec3(0.070,0.050,0.030), niteHor = vec3(0.28,0.16,0.09), niteGlow = vec3(0.78,0.42,0.15);',
    /* One monotonic ramp. An earlier version had two overlapping branches
       that both mixed day->dusk over different ranges, which snapped the
       sky back to full daylight at ~15:50. Bands must not overlap. */
    '  if(t < 0.20){ top=niteTop; mid=niteMid; hor=niteHor; glow=niteGlow; }',
    '  else if(t < 0.32){ float k = smoothstep(0.20,0.32,t);',
    '    top=mix(niteTop,dawnTop,k); mid=mix(niteMid,dawnMid,k); hor=mix(niteHor,dawnHor,k); glow=mix(niteGlow,dawnGlow,k); }',
    '  else if(t < 0.44){ float k = smoothstep(0.32,0.44,t);',
    '    top=mix(dawnTop,dayTop,k); mid=mix(dawnMid,dayMid,k); hor=mix(dawnHor,dayHor,k); glow=mix(dawnGlow,dayGlow,k); }',
    '  else if(t < 0.68){ top=dayTop; mid=dayMid; hor=dayHor; glow=dayGlow; }',
    '  else if(t < 0.82){ float k = smoothstep(0.68,0.82,t);',
    '    top=mix(dayTop,duskTop,k); mid=mix(dayMid,duskMid,k); hor=mix(dayHor,duskHor,k); glow=mix(dayGlow,duskGlow,k); }',
    '  else if(t < 0.86){ top=duskTop; mid=duskMid; hor=duskHor; glow=duskGlow; }',
    '  else { float k = smoothstep(0.86,0.96,t);',
    '    top=mix(duskTop,niteTop,k); mid=mix(duskMid,niteMid,k); hor=mix(duskHor,niteHor,k); glow=mix(duskGlow,niteGlow,k); }',
    '}',
    '',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / u_res;',
    '  float t = u_time * mix(1.0, 0.15, u_reduced);',
    '',
    '  vec3 top, mid, hor, glow;',
    '  palette(u_tod, top, mid, hor, glow);',
    '',
    /* vertical sky ramp */
    '  float y = uv.y;',
    '  vec3 col = mix(hor, mid, smoothstep(0.0, 0.55, y));',
    '  col = mix(col, top, smoothstep(0.45, 1.0, y));',
    '',
    /* LIQUID: domain-warped fbm, slow enough to read as flowing not boiling */
    '  vec2 p = vec2(uv.x * 2.2, uv.y * 1.5);',
    '  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.03)), fbm(p + vec2(5.2, 1.3) - t * 0.02));',
    '  vec2 r = vec2(fbm(p + 3.0*q + vec2(1.7, 9.2) + t * 0.02),',
    '               fbm(p + 3.0*q + vec2(8.3, 2.8) - t * 0.015));',
    '  float f = fbm(p + 3.5 * r);',
    '',
    /* clouds ride the warp; heavier low, thinner up top */
    '  float cloud = smoothstep(0.35, 0.85, f) * (1.0 - smoothstep(0.35, 1.0, y));',
    '  col = mix(col, glow, cloud * 0.34);',
    '  col += glow * pow(f, 3.0) * 0.12;',
    '',
    /* the sun/moon sits low and warm, the rooftop light source */
    /* The sun has to actually set. Left always-on, a warm disc still hung
       in the sky at 22:30, which reads as a bad gradient rather than night.
       sunUp fades the disc after dusk; the horizon city-glow carries the
       warmth instead, which is what Bengaluru actually looks like. */
    '  float sunUp = smoothstep(0.24, 0.34, u_tod) * (1.0 - smoothstep(0.80, 0.90, u_tod));',
    '  vec2 sunPos = vec2(0.72, 0.06 + 0.20 * sunUp);',
    '  float d = length((uv - sunPos) * vec2(u_res.x / u_res.y, 1.0));',
    '  col += glow * exp(-d * 3.4) * 0.55 * sunUp;',
    '  col += glow * exp(-d * 10.0) * 0.35 * sunUp;',
    '',
    /* stars, only once the sky is actually dark */
    '  float night = smoothstep(0.80, 0.95, u_tod) + smoothstep(0.22, 0.08, u_tod);',
    '  night = clamp(night, 0.0, 1.0);',
    '  if(night > 0.01){',
    '    vec2 sp = floor(uv * u_res / 2.6);',
    '    float s = hash(sp);',
    '    float star = step(0.9975, s) * (0.55 + 0.45 * sin(t * 1.6 + s * 90.0));',
    '    col += vec3(star) * night * smoothstep(0.25, 1.0, y);',
    '  }',
    '',
    /* horizon haze + a faint city glow at the base */
    '  col = mix(col, hor, pow(1.0 - y, 3.5) * 0.55);',
    '  float cityGlow = 0.22 + 0.40 * (1.0 - sunUp);',
    '  col += glow * pow(1.0 - y, 8.0) * cityGlow;',
    '',
    /* grain, so the gradient never bands on cheap panels */
    '  col += (hash(gl_FragCoord.xy + t) - 0.5) * 0.016;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('[sky] shader:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh); return null;
    }
    return sh;
  }

  /** Hours -> 0..1. Midnight 0.0, noon 0.5. */
  function timeOfDay(date) {
    var d = date || new Date();
    return (d.getHours() * 60 + d.getMinutes()) / 1440;
  }

  function LiquidSky(canvas, opts) {
    opts = opts || {};
    var gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false })
          || canvas.getContext('experimental-webgl');
    if (!gl) return null;

    var vs = compile(gl, gl.VERTEX_SHADER, VERT);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;
    var prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[sky] link:', gl.getProgramInfoLog(prog)); return null;
    }
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    var uRes = gl.getUniformLocation(prog, 'u_res'),
        uTime = gl.getUniformLocation(prog, 'u_time'),
        uTod = gl.getUniformLocation(prog, 'u_tod'),
        uReduced = gl.getUniformLocation(prog, 'u_reduced');

    var reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    gl.uniform1f(uReduced, reduced ? 1.0 : 0.0);

    var api = { gl: gl, tod: opts.tod != null ? opts.tod : timeOfDay(), frames: 0, running: false };

    /* This shader is fill-bound, and it was the reason the page dragged.
       Every pixel ran five fbm() calls of five octaves each — twenty-five
       noise evaluations per pixel, per frame, across the whole viewport.
       On a 1080p panel at DPR 2 that is about eighty million evaluations a
       frame, and a dozen backdrop-filter panels re-blurring on top of it.

       Two cuts, neither of them visible: three octaves instead of five,
       and a backing store at 0.55x stretched by CSS. Nothing in this sky
       has a hard edge — it is a slow gradient with drifting cloud — so
       resolution buys nothing, and together these shade roughly a sixth
       of the arithmetic per frame. */
    var RENDER_SCALE = 0.55;
    api.resize = function () {
      var dpr = Math.min(global.devicePixelRatio || 1, 1.25) * RENDER_SCALE;
      var w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      var h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w; canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
    };

    api.draw = function (seconds) {
      gl.uniform1f(uTime, seconds);
      gl.uniform1f(uTod, api.tod);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      api.frames++;
    };

    api.setTimeOfDay = function (v) { api.tod = v; };
    api.refreshClock = function () { api.tod = timeOfDay(); };
    return api;
  }

  LiquidSky.timeOfDay = timeOfDay;
  global.LiquidSky = LiquidSky;
})(window);
