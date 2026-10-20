import { describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Project } from "@opencode/core/project"
import { ProjectIcon } from "@opencode/core/project/icon"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath, RelativePath } from "@opencode/core/schema"
import { FSUtil } from "@opencode/util/fs-util"
import { initGit } from "./fixture/git"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Project.node, Database.node, Bus.node, FSUtil.node])))

const SVG = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='6'/></svg>"

function makePng(width: number, height = width) {
  const bytes = Buffer.alloc(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write("IHDR", 12, "ascii")
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  bytes[24] = 8
  bytes[25] = 6
  return bytes
}

async function writeFile(root: string, relative: string, content: string | Uint8Array) {
  const target = path.join(root, relative)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await Bun.write(target, content)
}

describe("ProjectIcon.discover", () => {
  it.live("orders candidates by priority and reads .appiconset and .icon bundles", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(async () => {
        await writeFile(tmp.path, "assets/logo.png", makePng(64))
        await writeFile(tmp.path, "public/favicon.ico", new Uint8Array([0, 0, 1, 0]))
        await writeFile(tmp.path, "app/icon.png", makePng(128))
        await writeFile(tmp.path, "public/favicon.svg", SVG)
        await writeFile(tmp.path, "Assets.xcassets/AppIcon.appiconset/icon_32.png", makePng(32))
        await writeFile(tmp.path, "Assets.xcassets/AppIcon.appiconset/icon_512.png", makePng(512))
        await writeFile(
          tmp.path,
          "AppIcon.icon/icon.json",
          JSON.stringify({ groups: [{ layers: [{ "image-name": "glyph.svg" }] }] }),
        )
        await writeFile(tmp.path, "AppIcon.icon/Assets/glyph.svg", SVG)
      })
      const fsUtil = yield* FSUtil.Service
      const found = yield* ProjectIcon.discover(fsUtil, AbsolutePath.make(tmp.path))

      expect(found.map((item) => item.path)).toEqual([
        "Assets.xcassets/AppIcon.appiconset/icon_512.png",
        "AppIcon.icon/Assets/glyph.svg",
        "public/favicon.svg",
        "app/icon.png",
        "public/favicon.ico",
        "assets/logo.png",
      ])
    }),
  )

  it.live("prefers opencode.jsonc icon, blocks path traversal, and skips oversized files", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const fsUtil = yield* FSUtil.Service
      const root = AbsolutePath.make(path.join(tmp.path, "repo"))
      yield* Effect.promise(async () => {
        await writeFile(tmp.path, "outside.svg", SVG)
        await writeFile(root, "public/favicon.svg", SVG)
        await writeFile(root, "assets/logo.png", new Uint8Array(ProjectIcon.MAX_BYTES + 1))
        await writeFile(root, "opencode.jsonc", `{\n  // custom icon\n  "icon": "https://example.com/icon.svg"\n}`)
      })

      const configured = yield* ProjectIcon.discover(fsUtil, root)
      expect(configured.map((item) => item.url)).toEqual([
        "https://example.com/icon.svg",
        `data:image/svg+xml;base64,${Buffer.from(SVG).toString("base64")}`,
      ])

      yield* Effect.promise(() => writeFile(root, "opencode.jsonc", JSON.stringify({ icon: "../outside.svg" })))
      const escaped = yield* ProjectIcon.discover(fsUtil, root)
      expect(escaped.map((item) => item.path)).toEqual(["public/favicon.svg"])
    }),
  )
})

describe("Project icon persistence", () => {
  it.live("discovers icon on resolve and refreshes existing projects without clobbering overrides", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(async () => {
        await initGit(tmp.path)
        await $`git remote add origin git@github.com:kitlangton/team-board.git`.cwd(tmp.path).quiet()
        await writeFile(tmp.path, "public/favicon.svg", SVG)
      })
      const project = yield* Project.Service
      const db = (yield* Database.Service).db
      const resolved = yield* project.resolve(AbsolutePath.make(tmp.path))
      const expectedUrl = `data:image/svg+xml;base64,${Buffer.from(SVG).toString("base64")}`

      expect((yield* project.list()).find((item) => item.id === resolved.id)).toMatchObject({
        name: "team-board",
        icon: { url: expectedUrl },
      })
      expect(yield* project.icons(AbsolutePath.make(tmp.path))).toEqual([
        { path: RelativePath.make("public/favicon.svg"), url: expectedUrl },
      ])

      const overridden = yield* project.update({
        projectID: resolved.id,
        icon: { override: "data:image/png;base64,AA==", color: "blue" },
      })
      expect(overridden.icon).toEqual({
        url: expectedUrl,
        override: "data:image/png;base64,AA==",
        color: "blue",
      })

      yield* db
        .update(ProjectTable)
        .set({ name: null, icon_url: null })
        .where(eq(ProjectTable.id, resolved.id))
        .run()
        .pipe(Effect.orDie)
      yield* project.sweep()
      expect((yield* project.list()).find((item) => item.id === resolved.id)).toMatchObject({
        name: "team-board",
        icon: {
          url: expectedUrl,
          override: "data:image/png;base64,AA==",
          color: "blue",
        },
      })
    }),
  )
})
