// Converte public/mh-logo.svg em PNGs de múltiplos tamanhos (1024/512/256/128).
// Roda com: cd C:/Users/rauls/crm-gestao-madeira && node scripts/svg2png.cjs
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const svg = fs.readFileSync(path.join(__dirname, '..', 'public', 'mh-logo.svg'));
const outDir = path.join(__dirname, '..', 'public');

(async () => {
  const sizes = [1024, 512, 256, 128];
  for (const s of sizes) {
    await sharp(svg, { density: Math.max(72, s / 64 * 72) })
      .resize(s, s)
      .png()
      .toFile(path.join(outDir, `mh-logo-${s}.png`));
    console.log(`  mh-logo-${s}.png ok`);
  }
})();
