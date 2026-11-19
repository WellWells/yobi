import { isTheme, themeDef } from '../../../shared/themes';
import type { ThemeDef } from '../../../shared/themes';
import { hexToRgb } from './colorUtils';
import { BACKDROP_SHEEN_ALPHA } from './backdrop';

/*
 * Paints a theme's backdrop on a canvas with a fragment shader, and lets it flow.
 *
 * A shader and not CSS gradients, for one reason: banding. A dark gradient that crosses a wide
 * window changes by one 8-bit step every few dozen pixels, and each step shows as a flat block of
 * colour. Only dithering hides that, and it has to happen where the colour is still a float, before
 * it is rounded: here, per pixel. Noise laid over a finished gradient
 * does not remove the steps, it only adds visible speckle.
 *
 * Every colour drawn is a `mix` of the theme's page colour, sheets and sheen, nothing brighter or
 * darker than those: that is what the contrast maths (`backdropColors`) relies on.
 */

/**
 * Frames are drawn at half the display's rate (the motion is slow), and at a sixth of it while
 * another window has the focus: still plainly flowing, for a fraction of the work.
 */
const PAINT_EVERY = { on: 2, idle: 6 } as const;

/** The most pixels the canvas is given: a 3840×2160 window, whatever the display's scale. */
const MAX_CANVAS_PIXELS = 3_840 * 2_160;

/** Seconds of shader time per second: how fast the sheets flow, before a theme's own `flow`. */
export const BACKDROP_FLOW_SPEED = 0.12;

/** Where the flow stands while it is not moving, so a still backdrop is a composed picture. */
const RESTING_TIME = 12;

const VERTEX_SHADER = `
attribute vec2 aCorner;
void main() {
  gl_Position = vec4(aCorner, 0.0, 1.0);
}`;

export const BACKDROP_FRAGMENT_SHADER = `
precision highp float;
uniform vec2 uSize;
uniform float uTime;
uniform vec3 uBase;
uniform vec3 uSheetA;
uniform vec3 uSheetB;
uniform vec3 uSheetC;
uniform vec3 uSheen;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 p = gl_FragCoord.xy / uSize;
  p.x *= uSize.x / uSize.y;
  float t = uTime;

  // The cloth: the plane is bent gently by two slow waves, so the sheets fold instead of sliding.
  // Small bends: diagonal folds, not blobs that squirm. The waves are short enough that a window
  // always holds a whole one (never a single sheet from edge to edge), and each sheet covers
  // under half of its wave, so the page colour and two or three sheets show together.
  vec2 w = p + 0.1 * vec2(sin(p.y * 2.0 + t * 0.9), cos(p.x * 1.7 - t * 0.7));

  float a = 0.5 + 0.5 * sin(w.x * 2.4 + w.y * 1.7 + t * 0.6);
  float b = 0.5 + 0.5 * sin(w.y * 2.7 - w.x * 1.8 - t * 0.5 + 1.7);
  float c = 0.5 + 0.5 * sin(w.x * 1.5 - w.y * 2.2 + t * 0.4 + 4.1);
  float crest = 0.5 + 0.5 * sin(w.x * 3.1 + w.y * 2.3 + t * 0.8);

  vec3 color = uBase;
  color = mix(color, uSheetA, smoothstep(0.45, 1.0, a) * 0.85);
  color = mix(color, uSheetB, smoothstep(0.5, 1.0, b) * 0.8);
  color = mix(color, uSheetC, smoothstep(0.55, 1.0, c) * 0.7);
  color = mix(color, uSheen, smoothstep(0.75, 1.0, crest) * ${BACKDROP_SHEEN_ALPHA.toFixed(2)});

  // Dither: one 8-bit step of triangular noise, fixed per pixel, added before the colour is rounded.
  float noise = hash(gl_FragCoord.xy) + hash(gl_FragCoord.xy + 31.7) - 1.0;
  gl_FragColor = vec4(color + noise / 255.0, 1.0);
}`;

type Rgb = [number, number, number];

export interface BackdropPalette {
  base: Rgb;
  sheets: [Rgb, Rgb, Rgb];
  sheen: Rgb;
}

function unit(hex: string): Rgb {
  const [r, g, b] = hexToRgb(hex);
  return [r / 255, g / 255, b / 255];
}

/** A theme's backdrop colours as the shader takes them, or null for a theme without one. */
export function backdropPalette(def: ThemeDef): BackdropPalette | null {
  if (!def.backdrop) return null;
  const [a, b, c] = def.backdrop.sheets;
  return { base: unit(def.colors.bgPrimary), sheets: [unit(a), unit(b), unit(c)], sheen: unit(def.backdrop.sheen) };
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

interface Painter {
  gl: WebGLRenderingContext;
  uniform: (name: string) => WebGLUniformLocation | null;
}

function createPainter(canvas: HTMLCanvasElement): Painter | null {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
  if (!gl) return null;
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, BACKDROP_FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  // One triangle that covers the whole canvas.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const corner = gl.getAttribLocation(program, 'aCorner');
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
  return { gl, uniform: (name) => gl.getUniformLocation(program, name) };
}

/**
 * Draws the current theme's backdrop on `canvas` and keeps it in step with <html>: the theme
 * (`data-theme`) and whether it moves (`data-backdrop-motion`: `on` and `idle` flow, `paused` and
 * absent hold the picture). Without WebGL the canvas hides itself and the CSS layers under it show.
 * Returns the function that stops it.
 */
export function mountBackdropPainter(canvas: HTMLCanvasElement): () => void {
  const root = document.documentElement;
  let painter = createPainter(canvas);
  if (!painter) {
    canvas.hidden = true;
    return () => {};
  }

  let palette: BackdropPalette | null = null;
  let moving = false;
  let flow = 1;
  let paintEvery: number = PAINT_EVERY.on;
  let frame = 0;
  let tick = 0;
  let clock = RESTING_TIME;
  let last = 0;

  const draw = (): void => {
    if (!painter || !palette || canvas.width === 0 || canvas.height === 0) return;
    const { gl, uniform } = painter;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uniform('uSize'), canvas.width, canvas.height);
    gl.uniform1f(uniform('uTime'), clock);
    gl.uniform3fv(uniform('uBase'), palette.base);
    gl.uniform3fv(uniform('uSheetA'), palette.sheets[0]);
    gl.uniform3fv(uniform('uSheetB'), palette.sheets[1]);
    gl.uniform3fv(uniform('uSheetC'), palette.sheets[2]);
    gl.uniform3fv(uniform('uSheen'), palette.sheen);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const step = (now: number): void => {
    frame = requestAnimationFrame(step);
    // A long gap (the window was hidden, the machine slept) does not make the flow jump.
    clock += Math.min((now - last) / 1_000, 0.1) * BACKDROP_FLOW_SPEED * flow;
    last = now;
    tick += 1;
    if (tick % paintEvery === 0) draw();
  };

  const stop = (): void => {
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const sync = (): void => {
    const theme = root.getAttribute('data-theme');
    const def = isTheme(theme) ? themeDef(theme) : null;
    palette = def ? backdropPalette(def) : null;
    flow = def?.backdrop?.flow ?? 1;
    const motion = root.getAttribute('data-backdrop-motion');
    moving = palette !== null && (motion === 'on' || motion === 'idle');
    paintEvery = motion === 'idle' ? PAINT_EVERY.idle : PAINT_EVERY.on;
    if (moving && frame === 0) {
      last = performance.now();
      frame = requestAnimationFrame(step);
    }
    if (!moving) stop();
    draw();
  };

  const resize = (): void => {
    // Device pixels, so the dither is one noise value per pixel on screen (stretched, it shows as
    // speckle and lets the steps back in), up to a ceiling a 4K window stays under.
    const area = canvas.clientWidth * canvas.clientHeight;
    const scale = area === 0 ? 1 : Math.min(window.devicePixelRatio, Math.sqrt(MAX_CANVAS_PIXELS / area));
    const width = Math.round(canvas.clientWidth * scale);
    const height = Math.round(canvas.clientHeight * scale);
    if (width === canvas.width && height === canvas.height) return;
    canvas.width = width;
    canvas.height = height;
    draw();
  };

  const onLost = (event: Event): void => {
    event.preventDefault();
    stop();
    painter = null;
  };
  const onRestored = (): void => {
    painter = createPainter(canvas);
    sync();
  };

  const attributes = new MutationObserver(sync);
  attributes.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-backdrop-motion'] });
  const size = new ResizeObserver(resize);
  size.observe(canvas);
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  resize();
  sync();

  return () => {
    stop();
    attributes.disconnect();
    size.disconnect();
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
  };
}
