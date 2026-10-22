// Makes contact sheets (4 slides each) from the PNGs PowerPoint exported to .build/render, to look through a deck quickly.
//   node sheets.cjs        ->  .build/sheets/sheet-01.png ...
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const dir = path.join(__dirname, ".build", "render");
const out = path.join(__dirname, ".build", "sheets");
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) fs.unlinkSync(path.join(out, f));
const files = fs.readdirSync(dir).filter((f) => /^Slide\d+\.PNG$/i.test(f)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
(async () => {
  const TW = 960;
  const TH = 540;
  for (let s = 0; s * 4 < files.length; s++) {
    const group = files.slice(s * 4, s * 4 + 4);
    const tiles = await Promise.all(
      group.map(async (f, i) => ({ input: await sharp(path.join(dir, f)).resize(TW - 6, TH - 6).toBuffer(), left: (i % 2) * TW + 3, top: Math.floor(i / 2) * TH + 3 })),
    );
    await sharp({ create: { width: TW * 2, height: TH * 2, channels: 3, background: "#888888" } })
      .composite(tiles)
      .png()
      .toFile(path.join(out, `sheet-${String(s + 1).padStart(2, "0")}.png`));
  }
  console.log(`${Math.ceil(files.length / 4)} sheets in .build/sheets`);
})();
