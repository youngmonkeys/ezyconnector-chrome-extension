import esbuild from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import { watch as watchFile } from 'node:fs';
import { dirname } from 'node:path';

const watch = process.argv.includes('--watch');

const staticFiles = [
  ['manifest.json', 'dist/manifest.json'],
  ['_locales', 'dist/_locales'],
  ['assets/icons/icon16.png', 'dist/icons/icon16.png'],
  ['assets/icons/icon32.png', 'dist/icons/icon32.png'],
  ['assets/icons/icon48.png', 'dist/icons/icon48.png'],
  ['assets/icons/icon128.png', 'dist/icons/icon128.png'],
  ['src/popup/popup.html', 'dist/popup.html'],
  ['src/popup/popup.css', 'dist/popup.css'],
];

async function copyStatic() {
  await mkdir('dist', { recursive: true });
  for (const [src, dest] of staticFiles) {
    await mkdir(dirname(dest), { recursive: true });
    await cp(src, dest, { recursive: true });
  }
}

const ctx = await esbuild.context({
  entryPoints: {
    background: 'src/background/index.ts',
    popup: 'src/popup/popup.ts',
  },
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  target: 'chrome110',
  sourcemap: true,
});

await copyStatic();

if (watch) {
  await ctx.watch();
  for (const [src] of staticFiles) {
    watchFile(src, () => {
      copyStatic()
        .then(() => console.log(`Copied ${src}`))
        .catch((err) => console.error(err));
    });
  }
  console.log('Watching for changes...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log('Build complete.');
}
