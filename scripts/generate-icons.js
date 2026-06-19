const { writeFileSync, readFileSync, existsSync, mkdirSync } = require('fs')
const { join } = require('path')
const zlib = require('zlib')

const iconsDir = join(__dirname, '..', 'resources', 'icons')
if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true })

const crc32 = (data) => {
  let crc = 0xFFFFFFFF
  for (const b of data) {
    crc ^= b
    for (let i = 0; i < 8; i++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
  }
  return (~crc >>> 0)
}

const makeChunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeB = Buffer.from(type, 'ascii')
  const crcData = Buffer.concat([typeB, data])
  const crcB = Buffer.alloc(4)
  crcB.writeUInt32BE(crc32(crcData))
  return Buffer.concat([len, typeB, data, crcB])
}

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

const makeIHDR = (width, height) => {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return makeChunk('IHDR', ihdr)
}

const createRawPixels = (width, height, pixelFn) => {
  const stride = width * 4 + 1
  const data = Buffer.alloc(stride * height, 0)
  for (let y = 0; y < height; y++) {
    data[y * stride] = 0
    for (let x = 0; x < width; x++) {
      const off = y * stride + 1 + x * 4
      const c = pixelFn(x, y)
      data[off] = c.r
      data[off + 1] = c.g
      data[off + 2] = c.b
      data[off + 3] = c.a
    }
  }
  return data
}

const createPNGBuffer = (width, height, pixelFn) => {
  const raw = createRawPixels(width, height, pixelFn)
  const deflated = zlib.deflateSync(raw)
  return Buffer.concat([
    PNG_SIG,
    makeIHDR(width, height),
    makeChunk('IDAT', deflated),
    makeChunk('IEND', Buffer.alloc(0))
  ])
}

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

const lerp = (a, b, t) => a + (b - a) * t

const distToCapsule = (px, py, cx, cy, w, h) => {
  const r = w / 2
  const halfH = h / 2 - r
  const dx = px - cx
  const dy = py - cy
  const clampedY = Math.max(-halfH, Math.min(halfH, dy))
  return Math.sqrt(dx * dx + (dy - clampedY) ** 2) - r
}

const distToLineSeg = (px, py, x1, y1, x2, y2) => {
  const dx = x2 - x1
  const dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2)
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.sqrt((px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2)
}

const distToRect = (px, py, x1, y1, x2, y2) => {
  const dx = Math.max(x1 - px, 0, px - x2)
  const dy = Math.max(y1 - py, 0, py - y2)
  if (dx > 0 || dy > 0) return Math.sqrt(dx * dx + dy * dy)
  return -Math.min(px - x1, x2 - px, py - y1, y2 - py)
}

const createMicPixelFn = (size) => {
  const cx = size / 2
  const cy = size / 2
  const bgRadius = size * 0.458
  const s = size / 256
  const AA = 1.2

  const capW = 48 * s
  const capH = 72 * s
  const capCY = cy - 8 * s

  const connW = 16 * s
  const connH = 10 * s
  const connY0 = capCY + capH / 2
  const connX0 = cx - connW / 2
  const connX1 = cx + connW / 2
  const connY1 = connY0 + connH

  const armThick = 5 * s
  const armSpread = 20 * s
  const armLen = 22 * s
  const aX0L = cx - connW / 2
  const aY0 = connY0 + connH
  const aX1L = aX0L - armSpread
  const aY1 = aY0 + armLen
  const aX0R = cx + connW / 2
  const aX1R = aX0R + armSpread

  const barThick = 5 * s

  return (x, y) => {
    const dx = x - cx
    const dy = y - cy
    const dist = Math.sqrt(dx * dx + dy * dy)

    const t = Math.min(1, dist / bgRadius)
    const bgR = Math.round(lerp(21, 124, t))
    const bgG = Math.round(lerp(101, 77, t))
    const bgB = Math.round(lerp(192, 255, t))

    let micDist = distToCapsule(x, y, cx, capCY, capW, capH)
    micDist = Math.min(micDist, distToRect(x, y, connX0, connY0, connX1, connY1))
    micDist = Math.min(micDist, distToLineSeg(x, y, aX0L, aY0, aX1L, aY1) - armThick / 2)
    micDist = Math.min(micDist, distToLineSeg(x, y, aX0R, aY0, aX1R, aY1) - armThick / 2)
    micDist = Math.min(micDist, distToLineSeg(x, y, aX1L, aY1, aX1R, aY1) - barThick / 2)

    if (micDist < 0) {
      return { r: 255, g: 255, b: 255, a: 255 }
    }

    if (micDist < AA) {
      const blend = smoothstep(0, AA, micDist)
      const opacity = dist > bgRadius ? (1 - smoothstep(bgRadius, bgRadius + 1, dist)) : 1
      return {
        r: Math.round(lerp(255, bgR, blend)),
        g: Math.round(lerp(255, bgG, blend)),
        b: Math.round(lerp(255, bgB, blend)),
        a: Math.round(255 * opacity)
      }
    }

    if (dist > bgRadius - AA) {
      const opacity = 1 - smoothstep(bgRadius - AA, bgRadius + 1, dist)
      return { r: bgR, g: bgG, b: bgB, a: Math.round(255 * opacity) }
    }

    return { r: bgR, g: bgG, b: bgB, a: 255 }
  }
}

const createICO = (sizes, pixelFn) => {
  const pngs = sizes.map(s => createPNGBuffer(s, s, pixelFn(s)))
  const num = pngs.length

  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(num, 4)

  let offset = 6 + num * 16
  const dirs = []
  for (let i = 0; i < num; i++) {
    const size = sizes[i]
    const dir = Buffer.alloc(16)
    dir.writeUInt8(size >= 256 ? 0 : size, 0)
    dir.writeUInt8(size >= 256 ? 0 : size, 1)
    dir.writeUInt8(0, 2)
    dir.writeUInt8(0, 3)
    dir.writeUInt16LE(1, 4)
    dir.writeUInt16LE(32, 6)
    dir.writeUInt32LE(pngs[i].length, 8)
    dir.writeUInt32LE(offset, 12)
    offset += pngs[i].length
    dirs.push(dir)
  }

  return Buffer.concat([header, ...dirs, ...pngs])
}

const createICNS = (sizes, pixelFn) => {
  const entries = []
  for (const size of sizes) {
    const png = createPNGBuffer(size, size, pixelFn(size))
    const type = size === 128 ? 'ic07' : size === 256 ? 'ic08' : 'ic09'
    const entrySize = Buffer.alloc(4)
    entrySize.writeUInt32BE(8 + png.length)
    entries.push(Buffer.concat([Buffer.from(type, 'ascii'), entrySize, png]))
  }

  const entryData = Buffer.concat(entries)
  const totalSize = Buffer.alloc(4)
  totalSize.writeUInt32BE(8 + entryData.length)

  return Buffer.concat([Buffer.from('icns', 'ascii'), totalSize, entryData])
}

console.log('Generating icons...')

const icon256 = createPNGBuffer(256, 256, createMicPixelFn(256))
writeFileSync(join(iconsDir, 'icon.png'), icon256)
console.log('  created icon.png (256×256)')

const icon512 = createPNGBuffer(512, 512, createMicPixelFn(512))
writeFileSync(join(iconsDir, 'icon-512.png'), icon512)
console.log('  created icon-512.png (512×512)')

const ico = createICO([256, 48, 32, 16], createMicPixelFn)
writeFileSync(join(iconsDir, 'icon.ico'), ico)
console.log('  created icon.ico (256×256, 48×48, 32×32, 16×16)')

const icns = createICNS([512, 256], createMicPixelFn)
writeFileSync(join(iconsDir, 'icon.icns'), icns)
console.log('  created icon.icns (512×512, 256×256)')

console.log('\nVerifying icon headers...')
const verify = (file, expectedSig, name) => {
  const buf = readFileSync(file)
  const match = buf.slice(0, expectedSig.length).equals(expectedSig)
  const sizeKB = (buf.length / 1024).toFixed(1)
  console.log(`  ${match ? '✓' : '✗'} ${name} (${sizeKB} KB) - ${match ? 'valid' : 'INVALID header'}`)
  return match
}

const allOk = (
  verify(join(iconsDir, 'icon.png'), PNG_SIG, 'icon.png') &&
  verify(join(iconsDir, 'icon-512.png'), PNG_SIG, 'icon-512.png') &&
  verify(join(iconsDir, 'icon.ico'), Buffer.from([0, 0, 1, 0]), 'icon.ico') &&
  verify(join(iconsDir, 'icon.icns'), Buffer.from('icns'), 'icon.icns')
)

console.log(allOk ? '\nAll icons generated and verified successfully.' : '\nSome icons failed verification!')
