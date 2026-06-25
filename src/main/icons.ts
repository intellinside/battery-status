import { nativeImage, NativeImage } from 'electron'
import { deflateSync } from 'zlib'

// CRC32 lookup table for PNG chunk checksums
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function writePng(width: number, height: number, pixels: Uint8Array): Buffer {
  function chunk(type: string, data: Buffer): Buffer {
    const t = Buffer.from(type, 'ascii')
    const lenBuf = Buffer.allocUnsafe(4)
    lenBuf.writeUInt32BE(data.length, 0)
    const crcBuf = Buffer.allocUnsafe(4)
    crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
    return Buffer.concat([lenBuf, t, data, crcBuf])
  }

  const ihdr = Buffer.allocUnsafe(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8  // bit depth
  ihdr[9] = 6  // RGBA colour type
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

  // Prepend a filter byte (0 = None) to each row, then deflate
  const rowBytes = width * 4
  const raw = Buffer.allocUnsafe(height * (rowBytes + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (rowBytes + 1)] = 0
    const src = y * rowBytes
    const dst = y * (rowBytes + 1) + 1
    for (let i = 0; i < rowBytes; i++) raw[dst + i] = pixels[src + i]
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),  // PNG signature
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// Draws a horizontal battery outline (body + positive terminal nub) into an RGBA pixel buffer.
// Design is defined in 64-px space and scaled linearly to `size`.
function drawBattery(size: number, r: number, g: number, b: number, a: number): Uint8Array {
  const px = new Uint8Array(size * size * 4)  // all transparent

  const sc = (v: number) => Math.round(v * size / 64)

  const set = (x: number, y: number) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return
    const i = (y * size + x) * 4
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a
  }

  // Battery body — solid fill, 52×29 px in 64-px space
  const [bx1, by1, bx2, by2] = [sc(3), sc(18), sc(54), sc(46)]
  for (let x = bx1; x <= bx2; x++) {
    for (let y = by1; y <= by2; y++) set(x, y)
  }

  // Positive terminal nub — solid rectangle directly adjacent to body right wall
  const [tx1, ty1, tx2, ty2] = [sc(55), sc(25), sc(63), sc(39)]
  for (let x = tx1; x <= tx2; x++) {
    for (let y = ty1; y <= ty2; y++) set(x, y)
  }

  return px
}

function drawBatteryLevel(
  size: number,
  level: number,
  dark: boolean,
  warnThreshold: number,
  lowThreshold: number
): Uint8Array {
  const px = new Uint8Array(size * size * 4)
  const sc = (v: number) => Math.round(v * size / 64)

  const [or, og, ob, oa]: [number, number, number, number] = dark
    ? [255, 255, 255, 230]
    : [30, 30, 30, 220]

  let fr: number, fg: number, fb: number
  if (level >= warnThreshold) {
    ;[fr, fg, fb] = [80, 200, 80]
  } else if (level >= lowThreshold) {
    ;[fr, fg, fb] = [220, 160, 30]
  } else {
    ;[fr, fg, fb] = [220, 60, 60]
  }

  const setPixel = (x: number, y: number, r: number, g: number, b: number, a: number): void => {
    if (x < 0 || x >= size || y < 0 || y >= size) return
    const i = (y * size + x) * 4
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a
  }

  // Body centred vertically: 32 px tall in 64 px space → y 16..47
  const bx1 = sc(2), by1 = sc(16), bx2 = sc(54), by2 = sc(47)
  const border = Math.max(2, sc(5))

  // Body outline
  for (let x = bx1; x <= bx2; x++) {
    for (let y = by1; y <= by2; y++) {
      const isEdge = x <= bx1 + border - 1 || x >= bx2 - border + 1 ||
                     y <= by1 + border - 1 || y >= by2 - border + 1
      if (isEdge) setPixel(x, y, or, og, ob, oa)
    }
  }

  // Nub centred in body, ~65 % of body height
  const tx1 = sc(55), ty1 = sc(22), tx2 = sc(63), ty2 = sc(41)
  for (let x = tx1; x <= tx2; x++) {
    for (let y = ty1; y <= ty2; y++) setPixel(x, y, or, og, ob, oa)
  }

  // Interior fill left-to-right proportional to level
  const ix1 = bx1 + border, iy1 = by1 + border
  const ix2 = bx2 - border, iy2 = by2 - border
  const innerWidth = ix2 - ix1 + 1
  const fillWidth = Math.round(innerWidth * Math.max(0, Math.min(100, level)) / 100)
  for (let x = ix1; x < ix1 + fillWidth; x++) {
    for (let y = iy1; y <= iy2; y++) setPixel(x, y, fr, fg, fb, 220)
  }

  return px
}

export function createTrayIconWithBattery(
  dark: boolean,
  level: number,
  warnThreshold: number,
  lowThreshold: number
): NativeImage {
  const SIZE = 64
  const png = writePng(SIZE, SIZE, drawBatteryLevel(SIZE, level, dark, warnThreshold, lowThreshold))
  return nativeImage.createFromBuffer(png, { scaleFactor: 2 })
}

export function createTrayIcon(dark: boolean): NativeImage {
  // dark=true  → Windows is in dark mode → taskbar is dark → use white icon
  // dark=false → Windows is in light mode → taskbar is light → use dark icon
  const [r, g, b, a]: [number, number, number, number] = dark
    ? [255, 255, 255, 230]
    : [30, 30, 30, 220]

  const SIZE = 64
  const png = writePng(SIZE, SIZE, drawBattery(SIZE, r, g, b, a))
  // scaleFactor 2 tells Electron this is a 2× image representing a 32×32 logical icon
  return nativeImage.createFromBuffer(png, { scaleFactor: 2 })
}
