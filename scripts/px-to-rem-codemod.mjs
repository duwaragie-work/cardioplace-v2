// One-off codemod: convert Tailwind arbitrary px font-size + line-height
// classes to rem so they respond to the browser's font-size setting.
//   text-[13px]    -> text-[0.8125rem]
//   leading-[18px] -> leading-[1.125rem]
// Only touches these two utilities (font-size + line-height). Does NOT touch
// width/height/inset/gap px, SVG fontSize props, or icon dimensions.
import { readFileSync, writeFileSync } from 'node:fs';
import { globSync } from 'node:fs';

const root = process.argv[2];
if (!root) {
  console.error('usage: node px-to-rem-codemod.mjs <glob-root>');
  process.exit(1);
}

const files = globSync(`${root}/**/*.tsx`);
const pxToRem = (px) => {
  const rem = Number(px) / 16;
  // strip trailing zeros: 1.0 -> 1, 0.8125 -> 0.8125
  return `${parseFloat(rem.toFixed(5))}rem`;
};

let totalFiles = 0;
let totalSubs = 0;
const re = /\b(text|leading)-\[(\d+(?:\.\d+)?)px\]/g;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  let subs = 0;
  const out = src.replace(re, (_m, util, px) => {
    subs++;
    return `${util}-[${pxToRem(px)}]`;
  });
  if (subs > 0) {
    writeFileSync(file, out);
    totalFiles++;
    totalSubs += subs;
    console.log(`${subs.toString().padStart(3)}  ${file}`);
  }
}
console.log(`\n${totalSubs} substitutions across ${totalFiles} files`);
