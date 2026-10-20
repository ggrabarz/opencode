import { RGBA, TextAttributes, type Renderable } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import * as Open from "@opencode/util/open"
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { useConfig } from "../config"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { tint } from "../theme/color"
import { useDialog } from "../ui/dialog"
import { Link } from "../ui/link"
import "./go-upsell-art"

export const GO_URL = "https://opencode.ai/go"
const ACTIONS = ["don't show again", "dismiss", "subscribe"] as const
type Action = (typeof ACTIONS)[number]

export function DialogGoUpsell(props: { reset?: string; onSubscribe: () => void; onDontShowAgain: () => void }) {
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()
  const theme = useTheme().surface("dialog")
  const config = useConfig().data
  const renderer = useRenderer()
  const narrow = () => dimensions().width < 52
  const short = () => dimensions().height < 22
  const compact = () => short() || dimensions().height < (narrow() ? 26 : 22)
  const animate = () => (config.animations ?? true) && !compact()
  const [selected, setSelected] = createSignal<Action>("subscribe")
  const [anchor, setAnchor] = createSignal<Renderable>()
  // Text sits on a translucent panel so the rings stay legible behind it.
  const textBg = () => {
    const [r, g, b] = theme.background.base.toInts()
    return RGBA.fromInts(r, g, b, 186)
  }
  const primary = () => theme.background.action.primary.focused

  createEffect(() => {
    if (!short()) return
    dialog.setCentered(true)
    onCleanup(() => {
      if (dialog.stack.length > 0) dialog.setCentered(false)
    })
  })

  // Every cell changes each frame, so hold the renderer to 30 fps while the art plays.
  createEffect(() => {
    if (!animate()) return
    const fps = { target: renderer.targetFps, max: renderer.maxFps }
    renderer.targetFps = 30
    renderer.maxFps = 30
    onCleanup(() => {
      renderer.targetFps = fps.target
      renderer.maxFps = fps.max
    })
  })

  const run = (action: Action) => {
    if (action === "subscribe") {
      Open.openUrl(GO_URL).catch(() => {})
      props.onSubscribe()
      return
    }
    if (action === "don't show again") props.onDontShowAgain()
    dialog.clear()
  }
  const step = (by: number) =>
    setSelected((value) => ACTIONS[(ACTIONS.indexOf(value) + by + ACTIONS.length) % ACTIONS.length]!)

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "return", title: "Confirm Go option", group: "Dialog", run: () => run(selected()) },
      { bind: "left", title: "Previous Go option", group: "Dialog", run: () => step(-1) },
      { bind: "up", title: "Previous Go option", group: "Dialog", run: () => step(-1) },
      { bind: "shift+tab", title: "Previous Go option", group: "Dialog", run: () => step(-1) },
      { bind: "right", title: "Next Go option", group: "Dialog", run: () => step(1) },
      { bind: "down", title: "Next Go option", group: "Dialog", run: () => step(1) },
      { bind: "tab", title: "Next Go option", group: "Dialog", run: () => step(1) },
    ],
  }))

  const button = (action: Action) => (
    <box
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={selected() === action ? primary() : RGBA.fromInts(0, 0, 0, 0)}
      onMouseOver={() => setSelected(action)}
      onMouseUp={() => run(action)}
    >
      <text
        fg={
          selected() === action
            ? theme.text.action.primary.focused
            : action === "subscribe"
              ? theme.text.base
              : theme.text.muted
        }
        bg={selected() === action ? undefined : textBg()}
        attributes={selected() === action ? TextAttributes.BOLD : undefined}
      >
        {action}
      </text>
    </box>
  )

  const inset = () => (narrow() ? 2 : 3)
  const bodyMaxHeight = () => {
    const topInset = short() ? 1 : Math.floor(dimensions().height / 4) + 1
    const footerRows = narrow() ? ACTIONS.length : 1
    const gaps = short() ? 1 : 4
    return Math.max(2, dimensions().height - topInset - footerRows - gaps)
  }

  return (
    <box>
      <Show when={!compact()}>
        <box position="absolute" top={-1} left={0} right={0} bottom={0} zIndex={0}>
          <go_upsell_art
            width="100%"
            height="100%"
            animate={animate()}
            background={theme.background.base}
            primary={primary()}
            logoBase={tint(theme.background.base, theme.text.base, 0.62)}
            logoAnchor={anchor()}
          />
        </box>
      </Show>
      <box zIndex={1} paddingLeft={inset()} paddingRight={inset()} paddingBottom={short() ? 0 : 1} gap={short() ? 0 : 1}>
        <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
          <text attributes={TextAttributes.BOLD} fg={theme.text.base} bg={textBg()}>
            Free limit reached
          </text>
          <text fg={theme.text.muted} bg={textBg()} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
        <Show
          when={!compact()}
          fallback={
            <scrollbox maxHeight={bodyMaxHeight()} flexShrink={1}>
              <text fg={theme.text.muted} bg={textBg()} wrapMode="word">
                You've used today's free messages.{props.reset ? ` Resets at ${props.reset}.` : ""}
              </text>
              <text fg={theme.text.muted} bg={textBg()} wrapMode="word">
                OpenCode Go gives you reliable access to the best open-source models for $10/month.
              </text>
              <Link href={GO_URL} fg={primary()} bg={textBg()} wrapMode="none" />
            </scrollbox>
          }
        >
          <box>
            <text fg={theme.text.muted} bg={textBg()} wrapMode="word">
              You've used today's free messages.{props.reset ? ` Resets at ${props.reset}.` : ""}
            </text>
            <text fg={theme.text.muted} bg={textBg()} wrapMode="word">
              OpenCode Go gives you reliable access to the best open-source models for $10/month.
            </text>
          </box>
          <box ref={setAnchor} height={7} paddingBottom={1} alignItems="center" justifyContent="flex-end">
            <Link href={GO_URL} fg={primary()} bg={textBg()} wrapMode="none" />
          </box>
        </Show>
        <Show
          when={!narrow()}
          fallback={
            <box flexDirection="column" alignItems="flex-start" flexShrink={0}>
              <For each={ACTIONS}>{(action) => button(action)}</For>
            </box>
          }
        >
          <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
            {button("don't show again")}
            <box flexDirection="row" gap={1}>
              <For each={["dismiss", "subscribe"] as const}>{(action) => button(action)}</For>
            </box>
          </box>
        </Show>
      </box>
    </box>
  )
}
