/**
 * Generates `media/menu.jpg` — the default large-preview cover for `.menu`.
 * Run with `npm run generate:menu` (or let `postinstall` do it once).
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(root, 'media', 'menu.jpg')
fs.mkdirSync(path.dirname(target), { recursive: true })

const jimpModule = await import('jimp')
const Jimp = jimpModule?.Jimp ?? jimpModule.default?.Jimp ?? jimpModule.default ?? jimpModule

const WIDTH = 640
const HEIGHT = 360

const image = new Jimp({ width: WIDTH, height: HEIGHT, color: 0x0b0f19ff })

// Diagonal accent stripes.
for (let offset = -HEIGHT; offset < WIDTH; offset += 48) {
  for (let y = 0; y < HEIGHT; y++) {
    const x = offset + y
    for (let dx = 0; dx < 14 && x + dx < WIDTH; dx++) {
      if (x + dx >= 0) image.setPixelColor(0x7c3aed66, x + dx, y)
    }
  }
}

// jimp v2 removed the bundled bitmap fonts, so the cover is a clean branded
// gradient without text — good enough for a default; replace with your own.
const highlight = new Jimp({ width: WIDTH, height: 120, color: 0x7c3aed88 })
image.composite(highlight, 0, HEIGHT / 2 - 60)

await image.getBuffer('image/jpeg', { quality: 85 }).then(buffer => fs.writeFileSync(target, buffer))
console.log(`menu cover written to ${path.relative(root, target)} (${buffer => buffer.length} bytes)`.replace(' (buffer => buffer.length bytes)', ` (${fs.statSync(target).size} bytes)`))
