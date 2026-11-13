// Draws public/sky.svg: the star field behind every page.
//
// A fixed seed, so the sky is the same on every build and the file only
// changes when this script does. Real night skies are mostly faint stars with
// a few bright ones, so sizes and brightness are drawn from a steep power law
// rather than uniformly, and a small share are tinted warm or cool the way
// star colours actually vary. The tile is large and sparse enough that its
// repeat is hard to spot.
//
//   node scripts/make-starfield.mjs

import { writeFileSync } from "node:fs";

const WIDTH = 1600;
const HEIGHT = 1100;
const STARS = 230;

let seed = 20_261_113;
function random() {
  seed = (seed * 16_807) % 2_147_483_647;
  return seed / 2_147_483_647;
}

const TINTS = ["#ffffff", "#ffffff", "#ffffff", "#ffffff", "#fff4e0", "#ffe7c4", "#e3ecff", "#d6e2ff"];

const circles = [];
for (let i = 0; i < STARS; i++) {
  const x = random() * WIDTH;
  const y = random() * HEIGHT;
  // u⁶ puts most stars near the faint end and leaves a handful bright.
  const magnitude = random() ** 6;
  // Kept dim: the sky sits behind text, and a bright dot beside a word reads as
  // punctuation. Only the rare brightest stars approach full size.
  const r = 0.3 + magnitude * 0.95;
  const opacity = 0.1 + magnitude * 0.55 + random() * 0.08;
  const tint = TINTS[Math.floor(random() * TINTS.length)];
  circles.push(
    `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="${tint}" fill-opacity="${opacity.toFixed(2)}"/>`,
  );
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">${circles.join("")}</svg>\n`;
writeFileSync(new URL("../public/sky.svg", import.meta.url), svg);
console.log(`public/sky.svg: ${STARS} stars, ${(svg.length / 1024).toFixed(1)} kB`);
