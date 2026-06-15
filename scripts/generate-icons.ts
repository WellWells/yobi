import * as fs from 'node:fs/promises';
import * as path from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pngToIco = (require('png-to-ico') as { default: (input: string | Buffer | string[]) => Promise<Buffer> }).default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const png2icons = require('png2icons') as {
  createICNS: (input: Buffer, scaler: number, numChannels: number) => Buffer | null;
  BICUBIC: number;
  BILINEAR: number;
};

const ASSETS = path.resolve('./assets');

async function generateIco(): Promise<void> {
  const src = path.join(ASSETS, 'icon-win.png');
  const dest = path.join(ASSETS, 'icon-win.ico');

  console.log(`📐 Generating Windows ICO from ${src}…`);
  const icoBuffer = await pngToIco(src);
  await fs.writeFile(dest, icoBuffer);
  console.log(`✅  ${dest} (${(icoBuffer.length / 1_024).toFixed(1)} KB)`);
}

async function generateIcns(): Promise<void> {
  const src = path.join(ASSETS, 'icon-mac.png');
  const dest = path.join(ASSETS, 'icon-mac.icns');

  console.log(`📐 Generating macOS ICNS from ${src}…`);
  const pngBuffer = await fs.readFile(src);
  const icnsBuffer = png2icons.createICNS(pngBuffer, png2icons.BICUBIC, 0);
  if (!icnsBuffer) throw new Error('png2icons returned null — check source PNG');
  await fs.writeFile(dest, icnsBuffer);
  console.log(`✅  ${dest} (${(icnsBuffer.length / 1_024).toFixed(1)} KB)`);
}

async function main(): Promise<void> {
  await generateIco();
  await generateIcns();
  console.log('\n🎉 Icon generation complete.');
}

main().catch((err: unknown) => {
  console.error('❌ Icon generation failed:', err);
  process.exit(1);
});
