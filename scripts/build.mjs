import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { build as viteBuild } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.resolve(rootDir, 'dist');

async function main() {
  console.log('🚀 Starting TikTok Cleaner Pro Build...');
  const start = Date.now();

  // 1. Clean dist directory
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  // 2. Build React UI Pages (SidePanel & Dashboard) with Vite
  console.log('📦 Building UI Pages (Vite)...');
  await viteBuild({
    root: rootDir,
    base: './',
    build: {
      outDir: distDir,
      emptyOutDir: false,
      target: 'chrome114',
    },
  });

  // 3. Build Background Service Worker with esbuild (ESM)
  console.log('⚙️ Building Background Service Worker (esbuild)...');
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/background/service-worker.ts')],
    outfile: path.join(distDir, 'service-worker.js'),
    bundle: true,
    format: 'esm',
    target: 'chrome114',
    platform: 'browser',
    minify: false,
    sourcemap: false,
  });

  // 4. Build Content Script with esbuild (IIFE)
  console.log('🧩 Building Content Script (esbuild)...');
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/content/index.ts')],
    outfile: path.join(distDir, 'content.js'),
    bundle: true,
    format: 'iife',
    target: 'chrome114',
    platform: 'browser',
    minify: false,
    sourcemap: false,
  });

  // 5. Copy manifest.json
  console.log('📄 Copying manifest.json...');
  fs.copyFileSync(path.join(rootDir, 'manifest.json'), path.join(distDir, 'manifest.json'));

  // 6. Copy icons
  console.log('🎨 Copying Icons...');
  const srcIcons = path.join(rootDir, 'public/icons');
  const destIcons = path.join(distDir, 'icons');
  fs.mkdirSync(destIcons, { recursive: true });
  if (fs.existsSync(srcIcons)) {
    for (const f of fs.readdirSync(srcIcons)) {
      fs.copyFileSync(path.join(srcIcons, f), path.join(destIcons, f));
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`✅ Build completed successfully in ${elapsed}s! Output directory: dist/`);
}

main().catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
