/**
 * The default icon each template ships, rendered from the template's own tokens.
 *
 * A scaffolded harness needs SOME mark, or `lloyal ship` hands the developer an app wearing
 * Electron's logo and nothing tells them it was theirs to set. So each template carries one, drawn
 * from the palette and the face that template already uses, and a developer replaces it by dropping
 * their own file over `build/icon.icns` or pointing `ship.icon` somewhere else.
 *
 * Run from the repo root after changing a template's palette:  node scripts/make-template-icons.mjs
 *
 * WHY A RASTER AND NOT AN SVG. The packager rasterises a declared `.svg` with a renderer that draws
 * paths and NOT type: an SVG carrying a `<text>` mark ships an app with the body and no lettering,
 * silently, with no warning in the build. Verified 2026-09-28. So the lettering is rendered here,
 * once, and the committed result is what travels.
 *
 * The offsets below were MEASURED, not guessed: text is centred on its advance width and its font
 * metrics, neither of which is the ink, so `f(` overhangs left and a bracket pair sits low. Each was
 * rendered at dx=dy=0, the ink box compared with the body box, and the difference written down.
 * Re-derive the same way if a glyph or a face changes.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SERIF = "Georgia, 'Times New Roman', serif";

/** One mark per template, each in that template's own colours. */
const MARKS = {
  // `f(n)` is Fieldnote's mark, and research is the template Fieldnote is built from: the math face
  // (`font.math`) in `color.ink` on `color.panel`, from src/ui/theme.ts.
  research: { glyph: 'f(n)', body: '#EFEFEA', ink: '#1B1B1F', style: 'italic', size: 270, dx: 27.5, dy: -21.5 },
  // basic reads as an encyclopaedia article, so its mark is a citation rather than a function. Its
  // colours are `--text` and `--panel` from src/ui/app.css, inverted: the panel is nearly white and
  // an almost-white icon disappears against a Finder window.
  basic: { glyph: '[1]', body: '#202122', ink: '#F8F9FA', style: 'normal', size: 360, dx: 0, dy: -19.5 },
};

/** Apple's icon body is a superellipse, not a rounded rectangle: its curvature is continuous, which
 *  is why a CSS `border-radius` reads subtly wrong beside system icons. Sampled as a dense polyline,
 *  exact to the pixel at this size and needing no Bézier fitting. */
const squircle = (c, half, n = 5, steps = 720) =>
  Array.from({ length: steps }, (_, i) => {
    const t = (i / steps) * 2 * Math.PI, x = Math.cos(t), y = Math.sin(t);
    return `${i === 0 ? 'M' : 'L'}${(c + half * Math.sign(x) * Math.abs(x) ** (2 / n)).toFixed(3)},${(c + half * Math.sign(y) * Math.abs(y) ** (2 / n)).toFixed(3)}`;
  }).join('') + 'Z';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

for (const [template, m] of Object.entries(MARKS)) {
  const out = join(root, 'templates', template, 'build');
  mkdirSync(out, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), `icon-${template}-`));
  // The macOS grid: a 1024 canvas with the body 824 across, centred, the rest transparent.
  writeFileSync(join(work, 'icon.html'), `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;width:1024px;height:1024px;background:transparent}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <path d="${squircle(512, 412)}" fill="${m.body}"/>
  <text x="${512 + m.dx}" y="${512 + m.dy}" fill="${m.ink}" font-family="${SERIF}" font-style="${m.style}"
        font-size="${m.size}" text-anchor="middle" dominant-baseline="central">${m.glyph}</text>
</svg>`);

  const master = join(out, 'icon.png');
  execFileSync(CHROME, ['--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--default-background-color=00000000', '--window-size=1024,1024', `--screenshot=${master}`,
    `file://${join(work, 'icon.html')}`], { stdio: 'ignore' });

  // Every size macOS draws, downscaled from the one master.
  const set = join(work, 'icon.iconset');
  mkdirSync(set);
  for (const [px, name] of [[16, 'icon_16x16'], [32, 'icon_16x16@2x'], [32, 'icon_32x32'], [64, 'icon_32x32@2x'],
    [128, 'icon_128x128'], [256, 'icon_128x128@2x'], [256, 'icon_256x256'], [512, 'icon_256x256@2x'],
    [512, 'icon_512x512']]) {
    execFileSync('sips', ['-z', String(px), String(px), master, '--out', join(set, `${name}.png`)], { stdio: 'ignore' });
  }
  copyFileSync(master, join(set, 'icon_512x512@2x.png'));
  execFileSync('iconutil', ['-c', 'icns', set, '-o', join(out, 'icon.icns')], { stdio: 'inherit' });
  rmSync(work, { recursive: true, force: true });
  process.stdout.write(`templates/${template}/build/ — ${m.glyph}\n`);
}
