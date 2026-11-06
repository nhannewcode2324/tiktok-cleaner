import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.resolve(rootDir, 'dist');
const zipOut = path.resolve(rootDir, 'tiktok-cleaner-pro.zip');

if (!fs.existsSync(distDir)) {
  console.error('Error: dist/ does not exist. Run "npm run build" first.');
  process.exit(1);
}

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

function getAllFiles(dir, base = '') {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const full = path.join(dir, file);
    const rel = base ? `${base}/${file}` : file;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results = results.concat(getAllFiles(full, rel));
    } else {
      results.push({ fullPath: full, relPath: rel.replace(/\\/g, '/') });
    }
  }
  return results;
}

console.log('📦 Creating release zip package with pure Node.js...');

const files = getAllFiles(distDir);
const localHeaders = [];
const centralHeaders = [];
let offset = 0;

for (const f of files) {
  const content = fs.readFileSync(f.fullPath);
  const crc = crc32(content);
  const compressed = zlib.deflateRawSync(content, { level: 9 });
  const nameBuf = Buffer.from(f.relPath, 'utf8');

  // DOS time/date (2026-01-01 12:00:00)
  const dosTime = (12 << 11) | (0 << 5) | 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

  // Local File Header
  const lfh = Buffer.alloc(30 + nameBuf.length);
  lfh.writeUInt32LE(0x04034b50, 0); // signature
  lfh.writeUInt16LE(20, 4);         // version needed
  lfh.writeUInt16LE(0, 6);          // flags
  lfh.writeUInt16LE(8, 8);          // compression method (deflate)
  lfh.writeUInt16LE(dosTime, 10);
  lfh.writeUInt16LE(dosDate, 12);
  lfh.writeUInt32LE(crc, 14);
  lfh.writeUInt32LE(compressed.length, 18);
  lfh.writeUInt32LE(content.length, 22);
  lfh.writeUInt16LE(nameBuf.length, 26);
  lfh.writeUInt16LE(0, 28);         // extra field len
  nameBuf.copy(lfh, 30);

  localHeaders.push(lfh, compressed);

  // Central Directory File Header
  const cdfh = Buffer.alloc(46 + nameBuf.length);
  cdfh.writeUInt32LE(0x02014b50, 0); // signature
  cdfh.writeUInt16LE(20, 4);         // version made by
  cdfh.writeUInt16LE(20, 6);         // version needed
  cdfh.writeUInt16LE(0, 8);          // flags
  cdfh.writeUInt16LE(8, 10);         // compression method
  cdfh.writeUInt16LE(dosTime, 12);
  cdfh.writeUInt16LE(dosDate, 14);
  cdfh.writeUInt32LE(crc, 16);
  cdfh.writeUInt32LE(compressed.length, 20);
  cdfh.writeUInt32LE(content.length, 24);
  cdfh.writeUInt16LE(nameBuf.length, 28);
  cdfh.writeUInt16LE(0, 30);         // extra len
  cdfh.writeUInt16LE(0, 32);         // comment len
  cdfh.writeUInt16LE(0, 34);         // disk number start
  cdfh.writeUInt16LE(0, 36);         // internal attrs
  cdfh.writeUInt32LE(0, 38);         // external attrs
  cdfh.writeUInt32LE(offset, 42);    // relative offset
  nameBuf.copy(cdfh, 46);

  centralHeaders.push(cdfh);
  offset += lfh.length + compressed.length;
}

const centralDirOffset = offset;
const centralDirBuf = Buffer.concat(centralHeaders);
const centralDirSize = centralDirBuf.length;

// End of Central Directory Record
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0); // signature
eocd.writeUInt16LE(0, 4);          // disk number
eocd.writeUInt16LE(0, 6);          // start disk
eocd.writeUInt16LE(files.length, 8); // entries on disk
eocd.writeUInt16LE(files.length, 10); // total entries
eocd.writeUInt32LE(centralDirSize, 12);
eocd.writeUInt32LE(centralDirOffset, 16);
eocd.writeUInt16LE(0, 20);         // comment len

const fullZip = Buffer.concat([...localHeaders, centralDirBuf, eocd]);
fs.writeFileSync(zipOut, fullZip);

console.log(`✅ Package created successfully: ${zipOut} (${(fullZip.length / 1024).toFixed(1)} KB, ${files.length} files compressed)`);
