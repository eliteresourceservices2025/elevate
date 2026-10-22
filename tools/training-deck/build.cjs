// Builds the ELEVATE HR training deck (one master deck, in parts) from the parts/*.cjs content and the Help center pictures.
//   cd tools/training-deck && npm install     (first time; this folder is not part of the pnpm workspace)
//   node build.cjs                            writes docs/training/ELEVATE-HR-training.pptx
// Pictures come from apps/elevate/content/help/assets (take them again with `pnpm help:shots` after a screen changes), cropped and given
// rounded corners here. Every slide has speaker notes: what to say, what to click, what to ask, and how long it takes.
// Slide types: title, concept (icon cards), task (steps + picture + watch-out), table, dos (avoid / do instead), checklist.
const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");
const sharp = require("sharp");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const lu = require("react-icons/lu");

const JSZip = require("jszip");
const ASSETS = path.resolve(__dirname, "../../apps/elevate/content/help/assets");
const OUT_FILE = path.resolve(__dirname, "../../docs/training/ELEVATE-HR-training.pptx");
const BUILD = path.join(__dirname, ".build");
const BOXES = JSON.parse(fs.readFileSync(path.join(ASSETS, "_boxes.json"), "utf8"));
const HELP = path.resolve(__dirname, "../../apps/elevate/content/help");
// What the Help center holds now: slide text can say {{guides}} and {{videos}}, and the guide titles and videos a slide points to are checked against it.
const GUIDE_TITLES = new Set();
for (const dir of fs.readdirSync(HELP).filter((d) => d !== "assets" && d !== "videos"))
  for (const f of fs.readdirSync(path.join(HELP, dir)).filter((x) => x.endsWith(".md"))) GUIDE_TITLES.add(/^title:\s*(.+)$/m.exec(fs.readFileSync(path.join(HELP, dir, f), "utf8"))[1].trim());
const VIDEO_IDS = new Set(fs.readdirSync(path.join(HELP, "videos")).filter((f) => f.endsWith(".mp4")).map((f) => f.slice(0, -4)));
const fillAll = (v) =>
  typeof v === "string" ? v.replace(/\{\{guides\}\}/g, String(GUIDE_TITLES.size)).replace(/\{\{videos\}\}/g, String(VIDEO_IDS.size))
  : Array.isArray(v) ? v.map(fillAll)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillAll(x)]))
  : v;
const PARTS = ["00-welcome", "a-people", "b-recruiting", "c-time", "d-docs-learning", "e-reports-settings", "z-closing"].map((f) => fillAll(require(`./parts/${f}.cjs`)));

/** A slide's guide titles and video must exist in the Help center now (a renamed guide or a removed video fails the build). */
function checkReferences(s) {
  if (s.guide) {
    let rest = s.guide;
    for (const t of [...GUIDE_TITLES].sort((a, b) => b.length - a.length)) rest = rest.replace(t, "");
    if (rest.replace(/[,\s]/g, "") !== "") throw new Error(`Slide "${s.title}": guide "${s.guide}" is not a Help center title`);
  }
  if (s.video && !VIDEO_IDS.has(s.video)) throw new Error(`Slide "${s.title}": there is no video "${s.video}" in content/help/videos`);
}

// Brand: ERS purple and gold on a deep ink, light content slides. Fonts that ship with Office.
const THEME = {
  name: "ELEVATE",
  headFontFace: "Cambria",
  bodyFontFace: "Calibri",
  colors: { dk1: "1F1535", lt1: "FFFFFF", dk2: "6C1ABA", lt2: "F4EEFB", accent1: "6C1ABA", accent2: "E2BE2B", accent3: "2E2250", accent4: "1F8A5B", accent5: "C0392B", accent6: "C9B2EE", hlink: "6C1ABA", folHlink: "6C1ABA" },
};
const HEX = { ink: "1F1535", purple: "6C1ABA", gold: "E2BE2B", lilac: "F4EEFB", muted: "5B5370", goldTint: "FFF6D6", greenTint: "E4F6EC", coralTint: "FDECEA" };

const W = 13.333;
const H = 7.5;
const FONT_H = "Cambria";
const FONT_B = "Calibri";

/** pptxgenjs cannot write theme colours: put them in the theme parts, so scheme colours (and a later restyle in PowerPoint) follow the brand. */
async function applyTheme(file, theme) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  for (const name of Object.keys(zip.files).filter((n) => /^ppt\/theme\/theme\d+\.xml$/.test(n))) {
    let xml = await zip.file(name).async("string");
    for (const [k, v] of Object.entries(theme.colors)) {
      const written = "<a:" + k + '><a:srgbClr val="' + v + '"/></a:' + k + ">";
      xml = xml.replace(new RegExp("<a:" + k + ">[\\s\\S]*?</a:" + k + ">"), written);
      if (!xml.includes(written)) throw new Error(`Theme colour ${k} could not be written in ${name}: the theme file layout changed`);
    }
    xml = xml.replace(/(<a:theme [^>]*name=")[^"]*"/, "$1" + theme.name + '"');
    zip.file(name, xml);
  }
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

async function iconPng(name, color) {
  const Icon = lu[name];
  if (!Icon) throw new Error(`Unknown icon ${name} (react-icons/lu)`);
  const svg = renderToStaticMarkup(React.createElement(Icon, { color: `#${color}`, size: "256" }));
  const buf = await sharp(Buffer.from(svg), { density: 300 }).resize(256, 256).png().toBuffer();
  return `image/png;base64,${buf.toString("base64")}`;
}

/** The picture as a 16:10, rounded-corner PNG; a taller picture is cut around the named part (or from the top). */
async function picture(key, cropName) {
  const src = path.join(ASSETS, `${key}.png`);
  if (!fs.existsSync(src)) throw new Error(`No picture ${key} (run pnpm help:shots in apps/elevate)`);
  const meta = await sharp(src).metadata();
  if (meta.width !== 1280 || meta.height < 800) throw new Error(`${key}.png is ${meta.width}x${meta.height}; the deck expects pictures 1280 wide and at least 800 high (pnpm help:shots takes them that way)`);
  let top = 0;
  if (meta.height > 800) {
    const box = cropName ? BOXES[key]?.[cropName] : null;
    if (cropName && !box) console.warn(`  warning: "${cropName}" is not recorded for ${key}; cut from the top`);
    if (box) top = Math.max(0, Math.min(meta.height - 800, Math.round(box.y + box.h / 2 - 400)));
  }
  const out = path.join(BUILD, "img", `${key.replace(/\//g, "__")}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const mask = Buffer.from('<svg width="1280" height="800"><rect width="1280" height="800" rx="26" ry="26"/></svg>');
  const cut = await sharp(src).resize({ width: 1280 }).extract({ left: 0, top, width: 1280, height: Math.min(800, meta.height) }).toBuffer();
  await sharp(cut).composite([{ input: mask, blend: "dest-in" }]).png({ compressionLevel: 9 }).toFile(out);
  return out;
}

/** Rough count of lines a text takes in a box (Calibri is about half an em wide per character): warns when a slide is likely to overflow. */
function lines(text, widthIn, pt) {
  const perLine = Math.floor(widthIn / (pt * 0.5 / 72));
  return Math.max(1, Math.ceil(text.length / perLine));
}

function notes(s, partTitle) {
  const demo = s.steps ? `\n\nDEMO (click through):\n${s.steps.map((x, i) => `${i + 1}. ${x}`).join("\n")}` : "";
  const watch = s.watch ? `\n\nWATCH OUT: ${s.watch}` : "";
  const guide = s.guide ? `\n\nHELP CENTER: ${s.guide}${s.video ? " (has a video)" : ""}` : "";
  return `SAY:\n${s.say}${demo}${watch}\n\nASK THE GROUP:\n${s.ask}${guide}\n\nTIME: about ${s.minutes} minutes${partTitle ? `\nPART: ${partTitle}` : ""}`;
}

(async () => {
  fs.mkdirSync(BUILD, { recursive: true });
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";
  pres.title = "ELEVATE for the HR team";
  pres.author = "Elite Resource Services";
  pres.subject = "HR training: how to use ELEVATE";
  pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
  const C = pres.SchemeColor;

  // Every slide's title is a real title placeholder (so PowerPoint's outline, slide sorter and screen readers see it); the layouts set where it goes.
  const titlePlaceholder = (o) => ({ placeholder: { options: { name: "title", type: "title", fontFace: FONT_H, bold: true, valign: "top", margin: 0, ...o }, text: "" } });
  pres.defineSlideMaster({
    title: "ELEVATE light",
    background: { color: C.background1 },
    objects: [
      titlePlaceholder({ x: 0.6, y: 0.55, w: 12.1, h: 0.85, fontSize: 32, color: C.text1, valign: "middle" }),
      { text: { text: "ELEVATE HR training", options: { x: 0.6, y: 7.05, w: 4, h: 0.3, fontFace: FONT_B, fontSize: 10, color: C.text2, isTextBox: true, margin: 0 } } },
    ],
    slideNumber: { x: 12.2, y: 7.05, w: 0.6, h: 0.3, fontFace: FONT_B, fontSize: 10, color: C.text2, align: "right" },
  });
  pres.defineSlideMaster({ title: "ELEVATE cover", background: { color: C.text1 }, objects: [titlePlaceholder({ x: 0.9, y: 3.0, w: 9.8, h: 1.7, fontSize: 50, color: C.background1, align: "left" })] });
  pres.defineSlideMaster({ title: "ELEVATE divider", background: { color: C.text1 }, objects: [titlePlaceholder({ x: 0.9, y: 3.4, w: 10.5, h: 1.2, fontSize: 44, color: C.background1, align: "left" })] });

  const iconCache = new Map();
  const icon = async (name, color) => {
    const k = `${name}:${color}`;
    if (!iconCache.has(k)) iconCache.set(k, await iconPng(name, color));
    return iconCache.get(k);
  };
  const shadow = () => ({ type: "outer", color: "000000", opacity: 0.16, blur: 8, offset: 3, angle: 90 });

  const addTitle = (slide, text) => slide.addText(text, { placeholder: "title" });
  const addPartTag = (slide, part) => {
    if (!part.letter) return;
    slide.addText(`PART ${part.letter}  ·  ${part.title.toUpperCase()}`, { x: 6.4, y: 0.2, w: 6.33, h: 0.3, fontFace: FONT_B, fontSize: 10, bold: true, color: C.accent1, align: "right", margin: 0, isTextBox: true, charSpacing: 1 });
  };

  let total = 0;
  let minutes = 0;
  const warnings = [];

  async function titleSlide(s) {
    const slide = pres.addSlide({ masterName: "ELEVATE cover" });
    slide.addShape(pres.ShapeType.ellipse, { x: 8.3, y: -1.6, w: 7.2, h: 7.2, fill: { color: C.accent1, transparency: 35 }, line: { type: "none" }, objectName: "Decoration circle" });
    slide.addShape(pres.ShapeType.ellipse, { x: 10.6, y: 4.4, w: 4.2, h: 4.2, fill: { color: C.accent2, transparency: 80 }, line: { type: "none" }, objectName: "Decoration circle 2" });
    slide.addText("ELEVATE.", { x: 0.9, y: 0.8, w: 5, h: 0.6, fontFace: FONT_H, fontSize: 28, bold: true, color: C.background1, charSpacing: 6, margin: 0, isTextBox: true });
    slide.addText("HR TEAM TRAINING", { x: 0.9, y: 2.2, w: 3.2, h: 0.5, fontFace: FONT_B, fontSize: 14, bold: true, color: C.text1, align: "center", valign: "middle", isTextBox: true, margin: 0, shape: pres.ShapeType.roundRect, rectRadius: 0.25, fill: { color: C.accent2 } });
    addTitle(slide, s.title);
    slide.addText(s.sub, { x: 0.9, y: 4.9, w: 7.6, h: 1.0, fontFace: FONT_B, fontSize: 22, color: C.accent6, margin: 0, isTextBox: true, valign: "top" });
    slide.addText("Elite Resource Services", { x: 0.9, y: 6.7, w: 6, h: 0.4, fontFace: FONT_B, fontSize: 14, color: C.accent6, margin: 0, isTextBox: true });
    slide.addNotes(notes(s, "Welcome"));
    total++;
    minutes += s.minutes;
  }

  async function divider(part) {
    const slide = pres.addSlide({ masterName: "ELEVATE divider", sectionTitle: `Part ${part.letter}: ${part.title}` });
    slide.addShape(pres.ShapeType.ellipse, { x: 9.0, y: -1.8, w: 7.0, h: 7.0, fill: { color: C.accent1, transparency: 40 }, line: { type: "none" }, objectName: "Decoration circle" });
    slide.addText(part.letter, { x: 0.9, y: 1.0, w: 1.7, h: 1.7, fontFace: FONT_H, fontSize: 80, bold: true, color: C.text1, align: "center", valign: "middle", margin: 0, isTextBox: true, shape: pres.ShapeType.ellipse, fill: { color: C.accent2 } });
    slide.addText(`PART ${part.letter}`, { x: 0.9, y: 3.0, w: 6, h: 0.4, fontFace: FONT_B, fontSize: 14, bold: true, color: C.accent2, charSpacing: 3, margin: 0, isTextBox: true });
    addTitle(slide, part.title);
    slide.addText(part.blurb, { x: 0.9, y: 4.6, w: 9.5, h: 0.6, fontFace: FONT_B, fontSize: 20, color: C.accent6, margin: 0, isTextBox: true, valign: "top" });
    const names = part.slides.map((x) => x.title);
    const half = Math.ceil(names.length / 2);
    [names.slice(0, half), names.slice(half)].forEach((col, i) =>
      slide.addText(col.map((t, j) => ({ text: t, options: { bullet: true, breakLine: j < col.length - 1 } })), { x: 0.9 + i * 5.6, y: 5.3, w: 5.4, h: 1.6, fontFace: FONT_B, fontSize: 13, color: C.background1, margin: 0, isTextBox: true, valign: "top", paraSpaceAfter: 2 }),
    );
    const t = part.slides.reduce((a, x) => a + x.minutes, 0);
    slide.addNotes(`SAY:\nPart ${part.letter} is ${part.title.toLowerCase()}: ${part.blurb.toLowerCase()} It has ${part.slides.length} short topics.\n\nTIME: about ${t} minutes for this part. Take a short break before the next part.`);
    total++;
  }

  async function taskSlide(s, part) {
    const slide = pres.addSlide({ masterName: "ELEVATE light", sectionTitle: part.letter ? `Part ${part.letter}: ${part.title}` : part.title });
    addTitle(slide, s.title);
    addPartTag(slide, part);
    // steps
    const items = s.steps.map((t, i) => ({ text: t, options: { bullet: { type: "number" }, breakLine: i < s.steps.length - 1 } }));
    const stepLines = s.steps.reduce((a, t) => a + lines(t, 5.0, 18), 0);
    if (stepLines * 0.3 + s.steps.length * 0.14 > 4.1) warnings.push(`${s.title}: steps may not fit`);
    slide.addText(items, { x: 0.6, y: 1.65, w: 5.0, h: 4.1, fontFace: FONT_B, fontSize: 18, color: C.text1, valign: "top", margin: 0, isTextBox: true, paraSpaceAfter: 9 });
    // picture
    const img = await picture(s.pic, s.crop);
    slide.addImage({ path: img, x: 5.95, y: 1.55, w: 6.78, h: 4.2375, altText: `Screenshot: ${s.title}`, shadow: shadow(), objectName: "Screenshot" });
    // watch-out card
    slide.addShape(pres.ShapeType.roundRect, { x: 0.6, y: 5.98, w: 12.13, h: 0.95, rectRadius: 0.14, fill: { color: C.background2 }, line: { type: "none" }, objectName: "Watch out card" });
    slide.addImage({ data: await icon("LuTriangleAlert", HEX.ink), x: 0.85, y: 6.18, w: 0.55, h: 0.55, altText: "Warning", objectName: "Warning icon" });
    slide.addText([{ text: "Watch out  ", options: { bold: true, color: C.accent1 } }, { text: s.watch, options: { color: C.text1 } }], { x: 1.65, y: 6.0, w: 10.9, h: 0.9, fontFace: FONT_B, fontSize: 16, valign: "middle", margin: 0, isTextBox: true });
    if (lines(s.watch + "Watch out  ", 10.9, 16) > 2) warnings.push(`${s.title}: watch-out text may not fit`);
    if (s.guide) slide.addText(`Help center: ${s.guide}${s.video ? "  ·  video available" : ""}`, { x: 4.6, y: 7.05, w: 7.0, h: 0.3, fontFace: FONT_B, fontSize: 10, color: C.text2, align: "right", margin: 0, isTextBox: true });
    slide.addNotes(notes(s, part.letter ? `Part ${part.letter}: ${part.title}` : part.title));
    total++;
    minutes += s.minutes;
  }

  async function conceptSlide(s, part) {
    const slide = pres.addSlide({ masterName: "ELEVATE light", sectionTitle: part.letter ? `Part ${part.letter}: ${part.title}` : part.title });
    addTitle(slide, s.title);
    addPartTag(slide, part);
    const n = s.cards.length;
    const cols = 3;
    const rows = Math.ceil(n / cols);
    const gap = 0.3;
    const cw = (12.13 - gap * (cols - 1)) / cols;
    const ch = rows === 1 ? 4.1 : 2.5;
    const top = rows === 1 ? 1.9 : 1.7;
    for (const [i, c] of s.cards.entries()) {
      const x = 0.6 + (i % cols) * (cw + gap);
      const y = top + Math.floor(i / cols) * (ch + gap);
      slide.addShape(pres.ShapeType.roundRect, { x, y, w: cw, h: ch, rectRadius: 0.16, fill: { color: C.background1 }, line: { color: C.accent6, width: 1 }, shadow: shadow(), objectName: `Card ${i + 1}` });
      const ic = rows === 1 ? 0.95 : 0.6;
      slide.addShape(pres.ShapeType.ellipse, { x: x + 0.3, y: y + 0.25, w: ic, h: ic, fill: { color: C.accent1 }, line: { type: "none" }, objectName: `Icon circle ${i + 1}` });
      slide.addImage({ data: await icon(c.icon, "FFFFFF"), x: x + 0.3 + ic * 0.24, y: y + 0.25 + ic * 0.24, w: ic * 0.52, h: ic * 0.52, altText: c.head, objectName: `Icon ${i + 1}` });
      const hy = y + 0.25 + ic + (rows === 1 ? 0.2 : 0.12);
      slide.addText(c.head, { x: x + 0.3, y: hy, w: cw - 0.6, h: rows === 1 ? 0.9 : 0.62, fontFace: FONT_H, fontSize: rows === 1 ? 22 : 17, bold: true, color: C.text1, valign: "top", margin: 0, isTextBox: true });
      slide.addText(c.text, { x: x + 0.3, y: hy + (rows === 1 ? 0.95 : 0.68), w: cw - 0.6, h: rows === 1 ? 1.5 : 0.75, fontFace: FONT_B, fontSize: rows === 1 ? 17 : 14, color: C.text1, valign: "top", margin: 0, isTextBox: true });
      if (rows === 2 && lines(c.text, cw - 0.6, 14) > 3) warnings.push(`${s.title}: card ${i + 1} text may not fit`);
    }
    slide.addNotes(notes(s, part.letter ? `Part ${part.letter}: ${part.title}` : part.title));
    total++;
    minutes += s.minutes;
  }

  async function tableSlide(s, part) {
    const slide = pres.addSlide({ masterName: "ELEVATE light", sectionTitle: part.title });
    addTitle(slide, s.title);
    addPartTag(slide, part);
    const head = s.head.map((t) => ({ text: t, options: { bold: true, color: C.background1, fill: { color: C.accent1 }, fontFace: FONT_B, fontSize: 16 } }));
    const body = s.rows.map((r, i) => r.map((t, j) => ({ text: t, options: { bold: j === 0, color: C.text1, fill: { color: i % 2 === 0 ? C.background2 : C.background1 }, fontFace: FONT_B, fontSize: 17 } })));
    slide.addTable([head, ...body], { x: 0.6, y: 1.7, w: 12.13, colW: [3.2, 8.93], rowH: 0.62, border: { type: "solid", pt: 0.75, color: "C9B2EE" }, valign: "middle", margin: [0.05, 0.15, 0.05, 0.15] });
    slide.addNotes(notes(s, part.title));
    total++;
    minutes += s.minutes;
  }

  async function dosSlide(s, part) {
    const slide = pres.addSlide({ masterName: "ELEVATE light", sectionTitle: part.title });
    addTitle(slide, s.title);
    const cols = [
      { data: s.left, x: 0.6, fill: HEX.coralTint, icon: "LuX", color: "C0392B" },
      { data: s.right, x: 6.85, fill: HEX.greenTint, icon: "LuCheck", color: "1F8A5B" },
    ];
    for (const c of cols) {
      slide.addShape(pres.ShapeType.roundRect, { x: c.x, y: 1.6, w: 5.88, h: 5.15, rectRadius: 0.16, fill: { color: c.fill }, line: { type: "none" }, objectName: `${c.data.head} card` });
      slide.addShape(pres.ShapeType.ellipse, { x: c.x + 0.3, y: 1.85, w: 0.6, h: 0.6, fill: { color: c.color }, line: { type: "none" }, objectName: `${c.data.head} icon circle` });
      slide.addImage({ data: await icon(c.icon, "FFFFFF"), x: c.x + 0.43, y: 1.98, w: 0.34, h: 0.34, altText: c.data.head, objectName: `${c.data.head} icon` });
      slide.addText(c.data.head, { x: c.x + 1.1, y: 1.85, w: 4.4, h: 0.6, fontFace: FONT_H, fontSize: 22, bold: true, color: C.text1, valign: "middle", margin: 0, isTextBox: true });
      slide.addText(c.data.items.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < c.data.items.length - 1 } })), { x: c.x + 0.35, y: 2.65, w: 5.2, h: 3.95, fontFace: FONT_B, fontSize: 18, color: C.text1, valign: "top", margin: 0, isTextBox: true, paraSpaceAfter: 10 });
      const need = c.data.items.reduce((a, t) => a + lines(t, 5.2, 18), 0);
      if (need * 0.3 + c.data.items.length * 0.14 > 3.95) warnings.push(`${s.title}: ${c.data.head} list may not fit`);
    }
    slide.addNotes(notes(s, part.title));
    total++;
    minutes += s.minutes;
  }

  async function checklistSlide(s, part) {
    const slide = pres.addSlide({ masterName: "ELEVATE light", sectionTitle: part.title });
    addTitle(slide, s.title);
    const half = Math.ceil(s.items.length / 2);
    [s.items.slice(0, half), s.items.slice(half)].forEach((col, ci) =>
      col.forEach((t, i) => {
        const x = 0.6 + ci * 6.2;
        const y = 1.75 + i * 1.2;
        slide.addShape(pres.ShapeType.roundRect, { x, y, w: 0.5, h: 0.5, rectRadius: 0.08, fill: { color: C.background1 }, line: { color: C.accent1, width: 2.25 }, objectName: `Checkbox ${ci * half + i + 1}` });
        slide.addText(t, { x: x + 0.75, y: y - 0.1, w: 5.1, h: 0.95, fontFace: FONT_B, fontSize: 18, color: C.text1, valign: "middle", margin: 0, isTextBox: true });
        if (lines(t, 5.1, 18) > 2) warnings.push(`${s.title}: item "${t}" may not fit`);
      }),
    );
    slide.addNotes(notes(s, part.title));
    total++;
    minutes += s.minutes;
  }

  for (const part of PARTS) {
    if (part.letter) {
      pres.addSection({ title: `Part ${part.letter}: ${part.title}` });
      await divider(part);
    } else pres.addSection({ title: part.title });
    for (const s of part.slides) {
      checkReferences(s);
      if (s.type === "title") await titleSlide(s);
      else if (s.type === "task") await taskSlide(s, part);
      else if (s.type === "concept") await conceptSlide(s, part);
      else if (s.type === "table") await tableSlide(s, part);
      else if (s.type === "dos") await dosSlide(s, part);
      else if (s.type === "checklist") await checklistSlide(s, part);
      else throw new Error(`Unknown slide type ${s.type} in ${s.title}`);
    }
  }

  await pres.writeFile({ fileName: OUT_FILE });
  await applyTheme(OUT_FILE, THEME);
  console.log(`${path.relative(process.cwd(), OUT_FILE)}: ${total} slides, about ${Math.round(minutes / 60 * 10) / 10} hours of teaching`);
  if (warnings.length) console.log("Check these (text may not fit):\n  " + warnings.join("\n  "));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
