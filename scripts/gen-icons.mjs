import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const iconsDir = path.resolve(__dirname, '../public/icons');

fs.mkdirSync(iconsDir, { recursive: true });

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const crcVal = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crcVal, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function generateIcon(size) {
  const width = size;
  const height = size;
  const stride = width * 4;
  const rawRows = [];

  const center = size / 2;
  const radius = size * 0.44;

  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(stride + 1);
    row[0] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const offset = 1 + x * 4;
      const dx = x - center + 0.5;
      const dy = y - center + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= radius) {
        // Gradient between TikTok Pink (#FF4F79) and Cyan (#36D5D8)
        const t = (x + y) / (width + height);
        const r = Math.round(255 * (1 - t) + 54 * t);
        const g = Math.round(79 * (1 - t) + 213 * t);
        const b = Math.round(121 * (1 - t) + 216 * t);
        
        // Inner "T" or checkmark accent
        const inCenter = dist < radius * 0.45;
        if (inCenter) {
          row[offset] = 255;
          row[offset + 1] = 255;
          row[offset + 2] = 255;
          row[offset + 3] = 255;
        } else {
          row[offset] = r;
          row[offset + 1] = g;
          row[offset + 2] = b;
          row[offset + 3] = 255;
        }
      } else if (dist <= radius + 1) {
        // Anti-aliased border
        const alpha = Math.max(0, Math.min(255, Math.round((1 - (dist - radius)) * 255)));
        row[offset] = 255;
        row[offset + 1] = 79;
        row[offset + 2] = 121;
        row[offset + 3] = alpha;
      } else {
        // Transparent
        row[offset] = 0;
        row[offset + 1] = 0;
        row[offset + 2] = 0;
        row[offset + 3] = 0;
      }
    }
    rawRows.push(row);
  }

  const rawData = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(rawData, { level: 9 });

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8-bit
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0; // Deflate
  ihdrData[11] = 0; // Filter
  ihdrData[12] = 0; // No interlace

  const ihdrChunk = makeChunk('IHDR', ihdrData);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

// If icons already exist (e.g. customized high-res logo), don't overwrite them
const icon128Path = path.join(iconsDir, 'icon128.png');
if (fs.existsSync(icon128Path) && fs.statSync(icon128Path).size > 3000) {
  console.log('✅ Custom logo icons found in public/icons, keeping existing icons.');
  process.exit(0);
}

for (const s of [16, 32, 48, 128]) {
  const iconBuf = generateIcon(s);
  const p = path.join(iconsDir, `icon${s}.png`);
  fs.writeFileSync(p, iconBuf);
  console.log(`Generated icon${s}.png (${iconBuf.length} bytes)`);
}
