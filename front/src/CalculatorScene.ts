// Real-time WebGL2 renderer for the 3D calculator model.
// No external 3D library: geometry, shading, picking and animation are all here.

import type { Key } from './calculator'
import {
  type Mat4,
  invert,
  lookAt,
  multiply,
  normalMatrix,
  perspective,
  rotationX,
  rotationY,
  rotationZ,
  scaling,
  transformPoint,
  translation,
} from './mat4'

type Kind = 'digit' | 'func' | 'op' | 'equals'

interface ButtonDef {
  key: Key
  label: string
  kind: Kind
  col: number
  row: number
  span: number
}

const LAYOUT: [Key, string, Kind, number?][][] = [
  [['AC', 'AC', 'func'], ['neg', '±', 'func'], ['%', '%', 'func'], ['/', '÷', 'op']],
  [['7', '7', 'digit'], ['8', '8', 'digit'], ['9', '9', 'digit'], ['*', '×', 'op']],
  [['4', '4', 'digit'], ['5', '5', 'digit'], ['6', '6', 'digit'], ['-', '−', 'op']],
  [['1', '1', 'digit'], ['2', '2', 'digit'], ['3', '3', 'digit'], ['+', '+', 'op']],
  [['0', '0', 'digit', 2], ['.', '.', 'digit'], ['=', '=', 'equals']],
]

export const BUTTONS: ButtonDef[] = LAYOUT.flatMap((row, r) => {
  let col = 0
  return row.map(([key, label, kind, span = 1]) => {
    const def = { key, label, kind, col, row: r, span }
    col += span
    return def
  })
})

// Model dimensions (world units)
const BODY = { w: 4.4, h: 7.3, d: 0.5 }
const FRONT_Z = BODY.d / 2
const PITCH = 0.95
const KEY_SIZE = 0.8
const KEY_DEPTH = 0.26
const KEY_TRAVEL = 0.14
const GRID_TOP = 1.25
const DISPLAY = { w: 3.8, h: 1.45, d: 0.05, y: 2.55 }

// sRGB colours
const COLORS: Record<Kind | 'body' | 'bezel', [number, number, number]> = {
  body: [0.12, 0.12, 0.15],
  bezel: [0.06, 0.06, 0.08],
  digit: [0.22, 0.22, 0.27],
  func: [0.62, 0.63, 0.68],
  op: [0.55, 0.25, 1.0],
  equals: [0.95, 0.45, 0.2],
}
const LABEL_LIGHT: [number, number, number] = [0.97, 0.97, 1.0]
const LABEL_DARK: [number, number, number] = [0.08, 0.08, 0.1]

const ATLAS_CELL = 128
const ATLAS_COLS = 8
const ATLAS_ROWS = 4

const DISPLAY_TEX_W = 1024
const DISPLAY_TEX_H = Math.round((DISPLAY_TEX_W * DISPLAY.h) / DISPLAY.w)

const VERT = `#version 300 es
in vec3 aPos;
in vec3 aNormal;
in vec2 aUv;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec3 vLocalPos;
out vec3 vLocalNormal;
out vec3 vWorldPos;
out vec2 vUv;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorldPos = world.xyz;
  vLocalPos = aPos;
  vLocalNormal = aNormal;
  vUv = aUv;
  gl_Position = uViewProj * world;
}`

const FRAG = `#version 300 es
precision highp float;
in vec3 vLocalPos;
in vec3 vLocalNormal;
in vec3 vWorldPos;
in vec2 vUv;
uniform mat3 uNormalMat;
uniform vec3 uScale;
uniform float uBevel;
uniform vec3 uColor;
uniform vec3 uCamPos;
uniform float uShininess;
uniform float uEmissive;
uniform float uGlow;
// 0 = none, 1 = label mask (alpha), 2 = full-colour screen
uniform int uTexMode;
uniform sampler2D uTex;
uniform vec4 uUvRect;
uniform vec3 uLabelColor;
out vec4 outColor;

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }

void main() {
  // Distance (world units) from each pair of faces; the middle value is the
  // distance to the nearest edge of the face being shaded.
  vec3 q = (0.5 - abs(vLocalPos)) * uScale;
  float edge = q.x + q.y + q.z - min(q.x, min(q.y, q.z)) - max(q.x, max(q.y, q.z));
  vec3 w = 1.0 - smoothstep(0.0, uBevel, q);
  vec3 bent = normalize(vLocalNormal + sign(vLocalPos) * w * 0.9);
  vec3 N = normalize(uNormalMat * bent);
  vec3 V = normalize(uCamPos - vWorldPos);

  vec3 base = toLinear(uColor);
  bool front = vLocalNormal.z > 0.5;
  vec2 uv = uUvRect.xy + vUv * uUvRect.zw;

  if (uTexMode == 2 && front && edge > uBevel) {
    vec3 screen = toLinear(texture(uTex, uv).rgb);
    vec3 H = normalize(normalize(vec3(-0.6, 1.0, 1.2)) + V);
    float glare = pow(max(dot(N, H), 0.0), 60.0) * 0.25;
    float sheen = smoothstep(0.35, 0.0, abs(vUv.y - vUv.x * 0.35 - 0.62)) * 0.04;
    outColor = vec4(pow(screen + glare + sheen, vec3(1.0 / 2.2)), 1.0);
    return;
  }

  if (uTexMode == 1 && front) {
    float a = texture(uTex, uv).a;
    base = mix(base, toLinear(uLabelColor), a);
  }

  vec3 L1 = normalize(vec3(0.5, 0.9, 1.1));
  vec3 L2 = normalize(vec3(-0.9, -0.3, 0.6));
  vec3 L3 = normalize(vec3(0.0, 0.4, -1.0));
  float d1 = max(dot(N, L1), 0.0);
  float d2 = max(dot(N, L2), 0.0);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 H1 = normalize(L1 + V);
  float s1 = pow(max(dot(N, H1), 0.0), uShininess) * (uShininess / 60.0);
  float hemi = 0.5 + 0.5 * N.y;

  vec3 col = base * (vec3(0.10, 0.10, 0.13) + vec3(0.05, 0.05, 0.08) * hemi);
  col += base * d1 * vec3(1.0, 0.97, 0.92) * 1.15;
  col += base * d2 * vec3(0.45, 0.5, 0.85) * 0.35;
  col += vec3(1.0) * s1 * 0.35;
  col += vec3(0.65, 0.45, 1.0) * rim * 0.35 * (0.5 + max(dot(N, L3), 0.0));
  col += base * uEmissive;
  col += toLinear(vec3(0.7, 0.5, 1.0)) * uGlow;

  outColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`

function buildCube(): Float32Array {
  // [normal, u-axis, v-axis] for each face; u × v = normal (CCW winding)
  const faces: number[][][] = [
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  ]
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
  const out: number[] = []
  for (const [n, u, v] of faces) {
    const verts = corners.map(([cu, cv]) => [
      ...[0, 1, 2].map((i) => n[i] * 0.5 + u[i] * cu * 0.5 + v[i] * cv * 0.5),
      ...n,
      (cu + 1) / 2,
      (cv + 1) / 2,
    ])
    for (const i of [0, 1, 2, 0, 2, 3]) out.push(...verts[i])
  }
  return new Float32Array(out)
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) ?? 'shader compile failed')
  }
  return sh
}

interface ButtonState {
  def: ButtonDef
  center: [number, number]
  size: [number, number]
  atlas: [number, number, number, number]
  press: number
  hover: number
  glow: number
  held: boolean
  releaseAt: number
}

export interface DisplayContent {
  main: string
  sub: string
  activeOp: Key | null
}

export class CalculatorScene {
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private vao: WebGLVertexArrayObject
  private atlasTex: WebGLTexture
  private displayTex: WebGLTexture
  private displayCanvas: HTMLCanvasElement
  private uniforms: Record<string, WebGLUniformLocation | null> = {}
  private buttons: ButtonState[]
  private raf = 0
  private lastTime = 0
  private disposed = false
  private resizeObserver: ResizeObserver
  private reducedMotion: boolean

  private viewProj: Mat4 = new Float32Array(16)
  private calcModel: Mat4 = new Float32Array(16)
  private camPos: [number, number, number] = [0, 0, 17]

  // Interaction state
  private pointer = { x: 0, y: 0, inside: false }
  private tilt = { x: 0, y: 0 }
  private drag = { active: false, id: -1, lastX: 0, lastY: 0, yaw: 0, pitch: 0, vYaw: 0, vPitch: 0 }
  private hovered = -1
  private activeOp: Key | null = null
  private wobble = 0

  private canvas: HTMLCanvasElement
  private onKey: (key: Key) => void

  constructor(canvas: HTMLCanvasElement, onKey: (key: Key) => void) {
    this.canvas = canvas
    this.onKey = onKey
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true })
    if (!gl) throw new Error('WebGL2 is not supported')
    this.gl = gl
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const program = gl.createProgram()!
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT))
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed')
    }
    this.program = program
    for (const name of [
      'uViewProj', 'uModel', 'uNormalMat', 'uScale', 'uBevel', 'uColor', 'uCamPos',
      'uShininess', 'uEmissive', 'uGlow', 'uTexMode', 'uTex', 'uUvRect', 'uLabelColor',
    ]) {
      this.uniforms[name] = gl.getUniformLocation(program, name)
    }

    const vao = gl.createVertexArray()!
    gl.bindVertexArray(vao)
    const vbo = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, buildCube(), gl.STATIC_DRAW)
    const stride = 8 * 4
    const attrib = (name: string, size: number, offset: number) => {
      const loc = gl.getAttribLocation(program, name)
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset)
    }
    attrib('aPos', 3, 0)
    attrib('aNormal', 3, 12)
    attrib('aUv', 2, 24)
    this.vao = vao

    this.buttons = this.layoutButtons()
    this.atlasTex = this.createTexture(this.drawAtlas())
    this.displayCanvas = document.createElement('canvas')
    this.displayCanvas.width = DISPLAY_TEX_W
    this.displayCanvas.height = DISPLAY_TEX_H
    this.drawDisplay({ main: '0', sub: '', activeOp: null })
    this.displayTex = this.createTexture(this.displayCanvas)

    gl.enable(gl.DEPTH_TEST)
    gl.enable(gl.CULL_FACE)

    canvas.addEventListener('pointermove', this.handlePointerMove)
    canvas.addEventListener('pointerdown', this.handlePointerDown)
    canvas.addEventListener('pointerup', this.handlePointerUp)
    canvas.addEventListener('pointercancel', this.handlePointerUp)
    canvas.addEventListener('pointerleave', this.handlePointerLeave)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)
    this.resize()

    this.raf = requestAnimationFrame(this.frame)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    const c = this.canvas
    c.removeEventListener('pointermove', this.handlePointerMove)
    c.removeEventListener('pointerdown', this.handlePointerDown)
    c.removeEventListener('pointerup', this.handlePointerUp)
    c.removeEventListener('pointercancel', this.handlePointerUp)
    c.removeEventListener('pointerleave', this.handlePointerLeave)
    const gl = this.gl
    gl.deleteTexture(this.atlasTex)
    gl.deleteTexture(this.displayTex)
    gl.deleteProgram(this.program)
    gl.deleteVertexArray(this.vao)
  }

  setDisplay(content: DisplayContent) {
    this.activeOp = content.activeOp
    this.drawDisplay(content)
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.displayTex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.displayCanvas)
    if (content.main === 'Error') this.wobble = 1
  }

  // Animate a key press triggered from outside (keyboard)
  flash(key: Key) {
    const b = this.buttons.find((b) => b.def.key === key)
    if (!b) return
    b.press = Math.max(b.press, 0.6)
    b.glow = 1
    b.releaseAt = performance.now() + 120
  }

  // --- setup -------------------------------------------------------------

  private layoutButtons(): ButtonState[] {
    let cell = 0
    return BUTTONS.map((def) => {
      const cx = (def.col + (def.span - 1) / 2 - 1.5) * PITCH
      const cy = GRID_TOP - def.row * PITCH
      const w = KEY_SIZE + (def.span - 1) * PITCH
      // Keep multi-cell labels on a single atlas row
      if ((cell % ATLAS_COLS) + def.span > ATLAS_COLS) {
        cell = Math.ceil(cell / ATLAS_COLS) * ATLAS_COLS
      }
      const u = (cell % ATLAS_COLS) / ATLAS_COLS
      const v = 1 - (Math.floor(cell / ATLAS_COLS) + 1) / ATLAS_ROWS
      const state: ButtonState = {
        def,
        center: [cx, cy],
        size: [w, KEY_SIZE],
        atlas: [u, v, def.span / ATLAS_COLS, 1 / ATLAS_ROWS],
        press: 0,
        hover: 0,
        glow: 0,
        held: false,
        releaseAt: 0,
      }
      cell += def.span
      return state
    })
  }

  private drawAtlas(): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = ATLAS_CELL * ATLAS_COLS
    c.height = ATLAS_CELL * ATLAS_ROWS
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const b of this.buttons) {
      const x = b.atlas[0] * c.width
      const y = (1 - b.atlas[1] - b.atlas[3]) * c.height
      const w = b.atlas[2] * c.width
      const size = b.def.label.length > 1 ? 44 : 62
      ctx.font = `500 ${size}px system-ui, "Segoe UI", Roboto, sans-serif`
      ctx.fillText(b.def.label, x + w / 2, y + ATLAS_CELL / 2 + 3)
    }
    return c
  }

  private drawDisplay({ main, sub }: DisplayContent) {
    const ctx = this.displayCanvas.getContext('2d')!
    const W = DISPLAY_TEX_W
    const H = DISPLAY_TEX_H
    const bg = ctx.createLinearGradient(0, 0, W, H)
    bg.addColorStop(0, '#0b0d18')
    bg.addColorStop(1, '#161029')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // Subtle grid for an "LCD" feel
    ctx.strokeStyle = 'rgba(160, 120, 255, 0.05)'
    ctx.lineWidth = 2
    for (let x = 0; x < W; x += 32) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
    }
    for (let y = 0; y < H; y += 32) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
    }

    const pad = 56
    ctx.textAlign = 'right'
    ctx.textBaseline = 'alphabetic'

    ctx.fillStyle = 'rgba(200, 180, 255, 0.6)'
    ctx.font = '500 52px ui-monospace, Consolas, monospace'
    ctx.fillText(sub, W - pad, 88)

    let size = 180
    const font = (s: number) => `300 ${s}px system-ui, "Segoe UI", Roboto, sans-serif`
    ctx.font = font(size)
    const maxW = W - pad * 2
    const measured = ctx.measureText(main).width
    if (measured > maxW) {
      size = Math.floor((size * maxW) / measured)
      ctx.font = font(size)
    }
    ctx.shadowColor = main === 'Error' ? 'rgba(255, 80, 80, 0.9)' : 'rgba(170, 110, 255, 0.9)'
    ctx.shadowBlur = 28
    ctx.fillStyle = main === 'Error' ? '#ff8a8a' : '#f4f0ff'
    ctx.fillText(main, W - pad, H - 64)
    ctx.shadowBlur = 0
  }

  private createTexture(source: HTMLCanvasElement): WebGLTexture {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return tex
  }

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr))
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
  }

  // --- interaction -------------------------------------------------------

  private toNdc(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)]
  }

  // Ray-cast against button boxes in calculator-local space
  private pick(ndcX: number, ndcY: number): number {
    const inv = invert(multiply(this.viewProj, this.calcModel))
    if (!inv) return -1
    const o = transformPoint(inv, ndcX, ndcY, -1)
    const f = transformPoint(inv, ndcX, ndcY, 1)
    const d = [f[0] - o[0], f[1] - o[1], f[2] - o[2]]
    let best = -1
    let bestT = Infinity
    this.buttons.forEach((b, i) => {
      const zc = FRONT_Z + KEY_DEPTH / 2 - b.press * KEY_TRAVEL
      const min = [b.center[0] - b.size[0] / 2, b.center[1] - b.size[1] / 2, zc - KEY_DEPTH / 2]
      const max = [b.center[0] + b.size[0] / 2, b.center[1] + b.size[1] / 2, zc + KEY_DEPTH / 2]
      let t0 = -Infinity
      let t1 = Infinity
      for (let a = 0; a < 3; a++) {
        if (Math.abs(d[a]) < 1e-9) {
          if (o[a] < min[a] || o[a] > max[a]) return
          continue
        }
        let ta = (min[a] - o[a]) / d[a]
        let tb = (max[a] - o[a]) / d[a]
        if (ta > tb) [ta, tb] = [tb, ta]
        t0 = Math.max(t0, ta)
        t1 = Math.min(t1, tb)
        if (t0 > t1) return
      }
      if (t1 >= 0 && t0 < bestT) {
        bestT = t0
        best = i
      }
    })
    return best
  }

  private handlePointerMove = (e: PointerEvent) => {
    const [x, y] = this.toNdc(e)
    this.pointer = { x, y, inside: true }
    if (this.drag.active && e.pointerId === this.drag.id) {
      const dx = e.clientX - this.drag.lastX
      const dy = e.clientY - this.drag.lastY
      this.drag.lastX = e.clientX
      this.drag.lastY = e.clientY
      this.drag.vYaw = dx * 0.01
      this.drag.vPitch = dy * 0.01
      this.drag.yaw += this.drag.vYaw
      this.drag.pitch = Math.max(-1.2, Math.min(1.2, this.drag.pitch + this.drag.vPitch))
      return
    }
    if (e.pointerType === 'mouse') {
      this.hovered = this.pick(x, y)
      this.canvas.style.cursor = this.hovered >= 0 ? 'pointer' : 'grab'
    }
  }

  private handlePointerDown = (e: PointerEvent) => {
    const [x, y] = this.toNdc(e)
    const hit = this.pick(x, y)
    this.canvas.setPointerCapture(e.pointerId)
    if (hit >= 0) {
      const b = this.buttons[hit]
      b.held = true
      b.glow = 1
      this.hovered = hit
      this.onKey(b.def.key)
      if (navigator.vibrate && e.pointerType !== 'mouse') navigator.vibrate(8)
    } else {
      this.drag = { ...this.drag, active: true, id: e.pointerId, lastX: e.clientX, lastY: e.clientY, vYaw: 0, vPitch: 0 }
      this.canvas.style.cursor = 'grabbing'
    }
  }

  private handlePointerUp = (e: PointerEvent) => {
    for (const b of this.buttons) b.held = false
    if (this.drag.active && e.pointerId === this.drag.id) {
      this.drag.active = false
      this.canvas.style.cursor = 'grab'
    }
    if (e.pointerType !== 'mouse') this.hovered = -1
  }

  private handlePointerLeave = () => {
    this.pointer.inside = false
    if (!this.drag.active) this.hovered = -1
  }

  // --- rendering ---------------------------------------------------------

  private frame = (now: number) => {
    if (this.disposed) return
    const dt = Math.min((now - (this.lastTime || now)) / 1000, 0.05)
    this.lastTime = now
    this.update(dt, now)
    this.render(now)
    this.raf = requestAnimationFrame(this.frame)
  }

  private update(dt: number, now: number) {
    const ease = (rate: number) => 1 - Math.exp(-rate * dt)

    // Tilt toward the pointer
    const tx = this.pointer.inside ? this.pointer.y * -0.25 : 0
    const ty = this.pointer.inside ? this.pointer.x * 0.35 : 0
    this.tilt.x += (tx - this.tilt.x) * ease(5)
    this.tilt.y += (ty - this.tilt.y) * ease(5)

    // Drag: inertia while spinning, then spring back to the front
    if (!this.drag.active) {
      this.drag.yaw += this.drag.vYaw
      this.drag.pitch += this.drag.vPitch
      this.drag.vYaw *= Math.exp(-dt * 6)
      this.drag.vPitch *= Math.exp(-dt * 6)
      // Spring back along the shortest path
      const full = Math.PI * 2
      this.drag.yaw = ((((this.drag.yaw + Math.PI) % full) + full) % full) - Math.PI
      this.drag.yaw += (0 - this.drag.yaw) * ease(3)
      this.drag.pitch += (0 - this.drag.pitch) * ease(3)
    }

    this.wobble = Math.max(0, this.wobble - dt * 2)

    for (const [i, b] of this.buttons.entries()) {
      if (b.releaseAt && now >= b.releaseAt) b.releaseAt = 0
      const target = b.held || b.releaseAt ? 1 : 0
      b.press += (target - b.press) * ease(target ? 40 : 18)
      b.hover += ((i === this.hovered ? 1 : 0) - b.hover) * ease(12)
      b.glow = Math.max(0, b.glow - dt * 2.5)
    }
  }

  private render(now: number) {
    const gl = this.gl
    const { width, height } = this.canvas
    gl.viewport(0, 0, width, height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    // Camera: fit the model in both dimensions
    const aspect = width / height
    const fov = (30 * Math.PI) / 180
    const halfH = 4.4
    const halfW = 3.1
    const t = Math.tan(fov / 2)
    const dist = Math.max(halfH / t, halfW / (t * aspect)) + 1
    this.camPos = [0, 0.4, dist]
    const proj = perspective(fov, aspect, 0.1, 100)
    const view = lookAt(this.camPos, [0, 0, 0], [0, 1, 0])
    this.viewProj = multiply(proj, view)

    const s = now / 1000
    const idle = this.reducedMotion ? 0 : 1
    const wob = Math.sin(s * 40) * this.wobble * 0.06
    this.calcModel = multiply(
      translation(0, Math.sin(s * 1.1) * 0.08 * idle, 0),
      multiply(
        rotationY(this.tilt.y + this.drag.yaw + Math.sin(s * 0.6) * 0.06 * idle + wob),
        multiply(
          rotationX(this.tilt.x + this.drag.pitch + Math.sin(s * 0.8) * 0.03 * idle),
          rotationZ(Math.sin(s * 0.5) * 0.015 * idle),
        ),
      ),
    )

    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    const u = this.uniforms
    gl.uniformMatrix4fv(u.uViewProj, false, this.viewProj)
    gl.uniform3fv(u.uCamPos, this.camPos)
    gl.uniform1i(u.uTex, 0)
    gl.activeTexture(gl.TEXTURE0)

    // Body
    this.drawBox(0, 0, 0, BODY.w, BODY.h, BODY.d, {
      color: COLORS.body, bevel: 0.22, shininess: 40,
    })
    // Display bezel + screen
    this.drawBox(0, DISPLAY.y, FRONT_Z, DISPLAY.w + 0.16, DISPLAY.h + 0.16, 0.04, {
      color: COLORS.bezel, bevel: 0.05, shininess: 80,
    })
    gl.bindTexture(gl.TEXTURE_2D, this.displayTex)
    this.drawBox(0, DISPLAY.y, FRONT_Z + 0.02, DISPLAY.w, DISPLAY.h, DISPLAY.d, {
      color: COLORS.bezel, bevel: 0.015, shininess: 80, texMode: 2, uvRect: [0, 0, 1, 1],
    })

    // Keys
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex)
    for (const b of this.buttons) {
      const active = b.def.kind === 'op' && b.def.key === this.activeOp
      const base = active ? LABEL_LIGHT : COLORS[b.def.kind]
      const label = active
        ? COLORS.op
        : b.def.kind === 'func' ? LABEL_DARK : LABEL_LIGHT
      const z = FRONT_Z + KEY_DEPTH / 2 - b.press * KEY_TRAVEL + b.hover * 0.03
      this.drawBox(b.center[0], b.center[1], z, b.size[0], b.size[1], KEY_DEPTH, {
        color: base,
        bevel: 0.12,
        shininess: 50,
        emissive: b.hover * 0.15,
        glow: b.glow * 0.35,
        texMode: 1,
        uvRect: b.atlas,
        labelColor: label,
      })
    }
  }

  private drawBox(
    x: number, y: number, z: number, w: number, h: number, d: number,
    opts: {
      color: [number, number, number]
      bevel: number
      shininess: number
      emissive?: number
      glow?: number
      texMode?: number
      uvRect?: [number, number, number, number]
      labelColor?: [number, number, number]
    },
  ) {
    const gl = this.gl
    const u = this.uniforms
    const model = multiply(this.calcModel, multiply(translation(x, y, z), scaling(w, h, d)))
    gl.uniformMatrix4fv(u.uModel, false, model)
    gl.uniformMatrix3fv(u.uNormalMat, false, normalMatrix(model))
    gl.uniform3f(u.uScale, w, h, d)
    gl.uniform1f(u.uBevel, opts.bevel)
    gl.uniform3fv(u.uColor, opts.color)
    gl.uniform1f(u.uShininess, opts.shininess)
    gl.uniform1f(u.uEmissive, opts.emissive ?? 0)
    gl.uniform1f(u.uGlow, opts.glow ?? 0)
    gl.uniform1i(u.uTexMode, opts.texMode ?? 0)
    gl.uniform4fv(u.uUvRect, opts.uvRect ?? [0, 0, 1, 1])
    gl.uniform3fv(u.uLabelColor, opts.labelColor ?? LABEL_LIGHT)
    gl.drawArrays(gl.TRIANGLES, 0, 36)
  }
}
