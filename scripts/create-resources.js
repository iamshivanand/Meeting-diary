const { mkdirSync, writeFileSync, existsSync } = require('fs')
const { join } = require('path')

const resourcesDir = join(__dirname, '..', 'resources')
const iconsDir = join(resourcesDir, 'icons')
const nativeDir = join(resourcesDir, 'native')

if (!existsSync(resourcesDir)) mkdirSync(resourcesDir)
if (!existsSync(iconsDir)) mkdirSync(iconsDir)
if (!existsSync(nativeDir)) mkdirSync(nativeDir, { recursive: true })

// Create a minimal valid 16x16 PNG (blue square) as placeholder icon
const createPlaceholderIcon = () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <rect width="256" height="256" fill="#1a73e8" rx="32"/>
    <text x="128" y="160" font-family="Arial" font-size="100" font-weight="bold" fill="white" text-anchor="middle">MR</text>
  </svg>`
  writeFileSync(join(iconsDir, 'icon.svg'), svg)
  // Generate a valid 256x256 PNG icon (blue #1a73e8 fill)
  const zlib = require('zlib')
  const width = 256, height = 256
  const stride = width * 3 + 1
  const rawData = Buffer.alloc(stride * height, 0)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const off = y * stride + 1 + x * 3
      rawData[off] = 0x1a; rawData[off + 1] = 0x73; rawData[off + 2] = 0xe8
    }
  }
  const deflated = zlib.deflateSync(rawData)
  const makeChunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const typeB = Buffer.from(type, 'ascii')
    const crcData = Buffer.concat([typeB, data])
    let crc = 0xFFFFFFFF
    for (const b of crcData) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0) }
    const crcB = Buffer.alloc(4); crcB.writeUInt32BE(~crc >>> 0)
    return Buffer.concat([len, typeB, data, crcB])
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2
  const png = Buffer.concat([sig, makeChunk('IHDR', ihdr), makeChunk('IDAT', deflated), makeChunk('IEND', Buffer.alloc(0))])
  writeFileSync(join(iconsDir, 'icon.png'), png)
  console.log('Placeholder icons created in', iconsDir)
}

// Create macOS entitlements
const createEntitlements = () => {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.device.audio-input</key>
    <true/>
    <key>com.apple.security.device.microphone</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
</dict>
</plist>`
  writeFileSync(join(resourcesDir, 'entitlements.mac.plist'), plist)
  console.log('macOS entitlements created')
}

createPlaceholderIcon()
createEntitlements()
