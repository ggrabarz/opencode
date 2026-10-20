import {
  Renderable,
  RGBA,
  TextAttributes,
  type OptimizedBuffer,
  type RenderableOptions,
  type RenderContext,
} from "@opentui/core"
import { extend } from "@opentui/solid"
import { go } from "../logo"

// Ported from the v1 TUI's Go upsell (bg-pulse-render.ts): rings radiate from the GO logo while a shimmer crosses it.
const PERIOD = 4600
const RINGS = 3
const WIDTH = 3.8
const TAIL = 9.5
const AMP = 0.55
const TAIL_AMP = 0.16
const BREATH_AMP = 0.05
const BREATH_SPEED = 0.0008
// Offset so the background ring emits from the GO center when the logo shimmer peaks.
const PHASE_OFFSET = 0.29
// The frame shown when animations are off.
const STILL = PERIOD * 0.5
const LOGO_LEFT_WIDTH = go.left[0]?.length ?? 0
const LOGO_LINES = go.left.map((line, index) => line + " " + go.right[index])
const LOGO_WIDTH = LOGO_LINES[0]?.length ?? 0
const LOGO_HEIGHT = LOGO_LINES.length
const LOGO_REACH = Math.hypot(LOGO_WIDTH, LOGO_HEIGHT * 2) + 3

type Options = RenderableOptions<GoUpsellArtRenderable> & {
  animate?: boolean
  background?: RGBA
  primary?: RGBA
  logoBase?: RGBA
  /** The logo is centred on this renderable's rows. */
  logoAnchor?: Renderable
}

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const ease = (phase: number) => {
  const envelope = Math.sin(phase * Math.PI)
  return envelope * envelope * (3 - 2 * envelope)
}
const mix = (out: RGBA, a: RGBA, b: RGBA, amount: number) => {
  const t = clamp(amount)
  out.r = a.r + (b.r - a.r) * t
  out.g = a.g + (b.g - a.g) * t
  out.b = a.b + (b.b - a.b) * t
  out.a = 1
  return out
}

export class GoUpsellArtRenderable extends Renderable {
  private elapsed: number
  private _animate: boolean
  private _background = RGBA.fromInts(0, 0, 0)
  private _primary = RGBA.fromInts(255, 255, 255)
  private _logoBase = RGBA.fromInts(180, 180, 180)
  private anchor: Renderable | undefined
  private readonly white = RGBA.fromInts(255, 255, 255)
  private readonly shadow = RGBA.fromInts(0, 0, 0)
  private readonly pulse = RGBA.fromInts(0, 0, 0)
  private readonly fg = RGBA.fromInts(0, 0, 0)
  private readonly bg = RGBA.fromInts(0, 0, 0)
  private peak = 0
  private glow = 0

  constructor(ctx: RenderContext, options: Options = {}) {
    const animate = options.animate ?? true
    super(ctx, { ...options, live: animate })
    this._animate = animate
    this.elapsed = animate ? 0 : STILL
    if (options.background) this._background = options.background
    if (options.primary) this._primary = options.primary
    if (options.logoBase) this._logoBase = options.logoBase
    this.anchor = options.logoAnchor
  }

  set animate(value: boolean) {
    if (value === this._animate) return
    this._animate = value
    this.live = value
    if (!value) this.elapsed = STILL
    this.requestRender()
  }

  set background(value: RGBA) {
    this._background = value
    this.requestRender()
  }

  set primary(value: RGBA) {
    this._primary = value
    this.requestRender()
  }

  set logoBase(value: RGBA) {
    this._logoBase = value
    this.requestRender()
  }

  set logoAnchor(value: Renderable | undefined) {
    this.anchor = value
    this.requestRender()
  }

  protected override onUpdate(deltaTime: number) {
    if (this._animate) this.elapsed = (this.elapsed + deltaTime) % PERIOD
  }

  protected override destroySelf() {
    this.live = false
    this.anchor = undefined
    super.destroySelf()
  }

  /** Sets peak (white core) and glow (primary tint) for a logo half-cell at dist from the logo centre. */
  private logoPulse(dist: number, heads: [number, number], eased: [number, number]) {
    let peak = 0.04
    let glow = 0
    for (let i = 0; i < 2; i++) {
      const delta = dist - heads[i]!
      const core = Math.exp(-(Math.abs(delta / 1.2) ** 1.8))
      const soft = Math.exp(-(Math.abs(delta / 7) ** 1.6))
      const tail = delta < 0 && delta > -7 ? (1 + delta / 7) ** 2.6 : 0
      peak += core * 0.65 * eased[i]!
      glow += (soft * 0.16 + tail * 0.22) * eased[i]!
    }
    this.peak = Math.min(1, peak)
    this.glow = Math.min(1, glow)
  }

  private logoTint(out: RGBA, base: RGBA, glow: number, peak: number) {
    return mix(out, mix(out, base, this._primary, glow), this.white, peak)
  }

  protected override renderSelf(buffer: OptimizedBuffer) {
    const width = this.width
    const height = this.height
    if (!this.visible || this.isDestroyed || width <= 0 || height <= 0) return
    const t = this.elapsed
    const rgb = this._ctx.capabilities?.rgb === true
    const logoX = Math.max(0, Math.floor((width - LOGO_WIDTH) / 2))
    const rawLogoY = this.anchor ? this.anchor.screenY - this.screenY : Math.round((height - LOGO_HEIGHT) / 2) - 1
    const logoY = Math.max(0, Math.min(Math.max(0, height - LOGO_HEIGHT), rawLogoY))
    const centerX = logoX + LOGO_WIDTH / 2
    const centerY = logoY + LOGO_HEIGHT / 2
    const reach = Math.hypot(Math.max(centerX, width - centerX), Math.max(centerY, height - centerY) * 2) + TAIL
    const breath = (0.5 + 0.5 * Math.sin(t * BREATH_SPEED)) * BREATH_AMP
    const ringHeads: number[] = []
    const ringEased: number[] = []
    for (let ring = 0; ring < RINGS; ring++) {
      const phase = (t / PERIOD + ring / RINGS - PHASE_OFFSET + 1) % 1
      ringHeads.push(phase * reach)
      ringEased.push(ease(phase))
    }
    const logoPhase0 = (t / PERIOD) % 1
    const logoPhase1 = (t / PERIOD + 0.5) % 1
    const logoHeads: [number, number] = [logoPhase0 * LOGO_REACH, logoPhase1 * LOGO_REACH]
    const logoEased: [number, number] = [ease(logoPhase0), ease(logoPhase1)]
    mix(this.shadow, this._background, this._logoBase, 0.25)

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dist = Math.hypot(x + 0.5 - centerX, (y + 0.5 - centerY) * 2)
        let level = 0
        for (let ring = 0; ring < RINGS; ring++) {
          const delta = dist - ringHeads[ring]!
          const crest = Math.abs(delta) < WIDTH ? 0.5 + 0.5 * Math.cos((delta / WIDTH) * Math.PI) : 0
          const tail = delta < 0 && delta > -TAIL ? (1 + delta / TAIL) ** 2.3 : 0
          level += (crest * AMP + tail * TAIL_AMP) * ringEased[ring]!
        }
        const falloff = Math.max(0, 1 - (dist / (reach * 0.85)) ** 2)
        mix(this.pulse, this._background, this._primary, Math.min(1, (level / RINGS + breath) * falloff) * 0.7)

        const char = LOGO_LINES[y - logoY]?.[x - logoX]
        if (char === undefined || char === " ") {
          buffer.setCell(this.screenX + x, this.screenY + y, " ", this.pulse, this.pulse)
          continue
        }
        const lx = x - logoX
        const ly = y - logoY
        const attributes = lx > LOGO_LEFT_WIDTH ? TextAttributes.BOLD : 0
        this.logoPulse(Math.hypot(lx + 0.5 - LOGO_WIDTH / 2, ly * 2 - LOGO_HEIGHT), logoHeads, logoEased)
        const topPeak = this.peak
        const topGlow = this.glow
        this.logoPulse(Math.hypot(lx + 0.5 - LOGO_WIDTH / 2, ly * 2 + 1 - LOGO_HEIGHT), logoHeads, logoEased)
        const bottomPeak = this.peak
        const bottomGlow = this.glow
        const cellX = this.screenX + x
        const cellY = this.screenY + y
        if (char === "_") {
          mix(this.bg, this.shadow, this.white, Math.max(topPeak, bottomPeak) * 0.18)
          buffer.setCell(cellX, cellY, " ", this.bg, this.bg, attributes)
        } else if (char === "^") {
          this.logoTint(this.fg, this._logoBase, topGlow, topPeak)
          mix(this.bg, this.shadow, this.white, bottomPeak * 0.18)
          buffer.setCell(cellX, cellY, "▀", this.fg, this.bg, attributes)
        } else if (char === "~") {
          mix(this.fg, this.shadow, this.white, topPeak * 0.18)
          buffer.setCell(cellX, cellY, "▀", this.fg, this.pulse, attributes)
        } else if (char === "█" && rgb) {
          this.logoTint(this.fg, this._logoBase, topGlow, topPeak)
          this.logoTint(this.bg, this._logoBase, bottomGlow, bottomPeak)
          buffer.setCell(cellX, cellY, "▀", this.fg, this.bg, attributes)
        } else {
          this.logoTint(this.fg, this._logoBase, (topGlow + bottomGlow) / 2, (topPeak + bottomPeak) / 2)
          buffer.setCell(cellX, cellY, char, this.fg, this.pulse, attributes)
        }
      }
    }
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    go_upsell_art: typeof GoUpsellArtRenderable
  }
}

extend({ go_upsell_art: GoUpsellArtRenderable })
