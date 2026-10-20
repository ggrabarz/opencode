export * as ProjectIcon from "./icon.js"

import path from "path"
import { Effect, Option, Schema } from "effect"
import { parse } from "jsonc-parser"
import { FSUtil } from "@opencode/util/fs-util"
import { AbsolutePath } from "../schema.js"

/** Largest image discovery reads. */
export const MAX_BYTES = 1024 * 1024

export interface Candidate {
  /** Posix path relative to the discovery root, omitted when configured as a URL. */
  readonly path?: string
  readonly url: string
}

const IMAGES = new Set([".svg", ".png", ".ico", ".jpg", ".jpeg", ".webp"])
const CONFIGS = ["opencode.jsonc", "opencode.json", ".opencode/opencode.jsonc", ".opencode/opencode.json"]
const CANDIDATES = [
  "app-icon.svg",
  "app-icon.png",
  "assets/app-icon.svg",
  "assets/app-icon.png",
  "Assets.xcassets/AppIcon.appiconset",
  "app/Assets.xcassets/AppIcon.appiconset",
  "ios/App/Assets.xcassets/AppIcon.appiconset",
  "AppIcon.icon",
  "app/AppIcon.icon",
  "assets/AppIcon.icon",
  "build/icon.svg",
  "build/icon.png",
  "src-tauri/icons/icon.svg",
  "src-tauri/icons/icon.png",
  "resources/icon.svg",
  "resources/icon.png",
  "icons/icon.svg",
  "icons/icon.png",
  "extension/icons/icon.svg",
  "extension/icons/icon.png",
  ...["favicon.svg", "icon.svg", "favicon.png", "apple-touch-icon.png", "icon.png", "favicon.ico"].flatMap((file) =>
    ["", "public/", "app/", "src/app/", "site/public/"].map((dir) => `${dir}${file}`),
  ),
  "logo.svg",
  "logo.png",
  "public/logo.svg",
  "public/logo.png",
  "assets/icon.svg",
  "assets/icon.png",
  "assets/logo.svg",
  "assets/logo.png",
]

const decodeConfig = Schema.decodeUnknownOption(Schema.Struct({ icon: Schema.String }))
const decodeManifest = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      groups: Schema.Array(
        Schema.Struct({ layers: Schema.Array(Schema.Struct({ "image-name": Schema.optional(Schema.String) })) }),
      ),
    }),
  ),
)

/** Ordered icon candidates in `root`: project config first, then fixed well-known paths. */
export const discover = Effect.fn("ProjectIcon.discover")(function* (
  fs: FSUtil.Interface,
  root: AbsolutePath,
  options?: { readonly limit?: number },
): Effect.fn.Return<readonly Candidate[]> {
  const configured = yield* config(fs, root)
  const found: Candidate[] = configured ? [configured] : []
  for (const candidate of CANDIDATES) {
    if (options?.limit && found.length >= options.limit) break
    const item = yield* resolveCandidate(fs, root, candidate)
    if (item && item.path !== configured?.path) found.push(item)
  }
  return found
})

const config = Effect.fnUntraced(function* (fs: FSUtil.Interface, root: AbsolutePath) {
  for (const name of CONFIGS) {
    const text = yield* fs.readFileString(path.join(root, name)).pipe(Effect.orElseSucceed(() => undefined))
    if (text === undefined) continue
    const value = Option.getOrUndefined(decodeConfig(parse(text)))?.icon.trim()
    if (!value) continue
    if (/^(https?:|data:image\/)/i.test(value)) return { url: value }
    const file = path.resolve(root, path.dirname(name), value)
    if (!FSUtil.contains(root, file)) continue
    const image = yield* read(fs, file)
    if (image) return { path: path.relative(root, file).split(path.sep).join("/"), url: image.url }
  }
})

const resolveCandidate = Effect.fnUntraced(function* (fs: FSUtil.Interface, root: AbsolutePath, candidate: string) {
  if (candidate.endsWith(".appiconset")) {
    const entries = yield* fs
      .readDirectoryEntries(path.join(root, candidate))
      .pipe(Effect.orElseSucceed((): FSUtil.DirEntry[] => []))
    const images = yield* Effect.forEach(
      entries.filter((entry) => entry.type === "file"),
      (entry) =>
        read(fs, path.join(root, candidate, entry.name)).pipe(
          Effect.map((image) => (image ? [{ path: `${candidate}/${entry.name}`, url: image.url, size: image.size }] : [])),
        ),
    )
    return images.flat().toSorted((a, b) => b.size - a.size)[0]
  }
  if (candidate.endsWith(".icon")) {
    const manifest = yield* fs
      .readFileString(path.join(root, candidate, "icon.json"))
      .pipe(Effect.orElseSucceed(() => undefined))
    const layer = Option.getOrUndefined(decodeManifest(manifest))
      ?.groups.flatMap((group) => group.layers.flatMap((item) => item["image-name"] ?? []))
      .at(0)
    if (!layer) return undefined
    const relative = `${candidate}/Assets/${layer}`
    const image = yield* read(fs, path.join(root, relative))
    return image ? { path: relative, url: image.url } : undefined
  }
  const image = yield* read(fs, path.join(root, candidate))
  return image ? { path: candidate, url: image.url } : undefined
})

const read = Effect.fnUntraced(function* (fs: FSUtil.Interface, file: string) {
  const extension = path.extname(file).toLowerCase()
  if (!IMAGES.has(extension)) return undefined
  const info = yield* fs.stat(file).pipe(Effect.orElseSucceed(() => undefined))
  if (!info || info.type !== "File" || !Number(info.size) || Number(info.size) > MAX_BYTES) return undefined
  const bytes = yield* fs.readFile(file).pipe(Effect.orElseSucceed(() => undefined))
  if (!bytes) return undefined
  const type = extension === ".ico" ? "image/x-icon" : FSUtil.mimeType(file)
  const size =
    bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16)
      : bytes.length
  return { url: `data:${type};base64,${Buffer.from(bytes).toString("base64")}`, size }
})
