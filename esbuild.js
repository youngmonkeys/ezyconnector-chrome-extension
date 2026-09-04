import esbuild from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

const staticFiles = [
  ['manifest.json', 'dist/manifest.json'],
  ['src/popup/popup.html', 'dist/popup.html'],
  ['src/popup/popup.css', 'dist/popup.css'],
];

async function copyStatic() {
  await mkdir('dist', { recursive: true });
  for (const [src, dest] of staticFiles) {
    await cp(src, dest);
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
  console.log('Watching for changes...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log('Build complete.');
}
