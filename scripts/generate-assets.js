#!/usr/bin/env node
'use strict';

/**
 * generate-assets.js
 *
 * Emits the original Matrix-themed SVG assets used by README.md into assets/.
 *
 * Everything here is generated from scratch — no third-party artwork, no
 * embedded raster images, no external image services. Output is fully
 * deterministic (seeded PRNG), so re-running produces byte-identical files
 * and never creates spurious git diffs.
 *
 * IMPORTANT — why every animation is a generated CSS class:
 *   GitHub sanitises SVGs before rendering them in a README and drops inline
 *   `style="..."` attributes. Anything animated through an inline style is
 *   therefore frozen once the file is on GitHub, even though it animates fine
 *   when opened locally in a browser. So all timing (duration + delay) is
 *   baked into per-element classes inside <style>, which does survive.
 *   Do not move animation timing back into inline styles.
 *
 *   node scripts/generate-assets.js
 */

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'assets');

/* ------------------------------------------------------------------ *
 * Identity — the single place profile text lives.
 * ------------------------------------------------------------------ */

const ID = {
  name: 'GIA QUYEN',
  role: 'IT BUSINESS ANALYST',
  tagline: 'REQUIREMENTS  ·  PROCESS  ·  SPECIFICATION',
  handle: 'bgq1011',
};

/* ------------------------------------------------------------------ *
 * Palette — carried over from the previous theme so the whole profile
 * still reads as one system.
 * ------------------------------------------------------------------ */

const C = {
  bgDeep: '#05080c',
  bgMid: '#0a1017',
  bgSoft: '#0b1118',
  rain: '#3fb950', // classic matrix green
  rainAlt: '#1de9b6', // teal accent
  blue: '#58a6ff',
  amber: '#d29922',
  white: '#e6edf3',
  dim: '#4a5a68',
  txt: '#a9c2d1',
};

const MONO =
  'ui-monospace, SFMono-Regular, "Cascadia Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';

/* ------------------------------------------------------------------ *
 * Deterministic PRNG (mulberry32) — stable output across runs/platforms.
 * ------------------------------------------------------------------ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Glyph pool. ASCII only, so it renders identically on every platform. */
const GLYPHS = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ$%#@&*+=<>[]{}|/\\_-?!'.split('');

const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;
const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/**
 * Build a keyframes body that shows an element only between two percentages
 * of the cycle. Used for flip-book style sequences (scramble frames, slides).
 *
 * steps(1, end) timing turns this into a hard cut with no cross-fade.
 */
function visWindow(startPct, endPct) {
  const s = r3(startPct);
  const e = r3(Math.min(endPct, 100));
  const eps = 0.001;
  const stops = [];

  if (s <= 0) {
    stops.push('0%{opacity:1}');
  } else {
    stops.push('0%{opacity:0}', `${r3(s - eps)}%{opacity:0}`, `${s}%{opacity:1}`);
  }

  if (e >= 100) {
    stops.push('100%{opacity:1}');
  } else {
    stops.push(`${r3(e - eps)}%{opacity:1}`, `${e}%{opacity:0}`, '100%{opacity:0}');
  }

  return stops.join('');
}

/* ------------------------------------------------------------------ *
 * Matrix rain generator.
 *
 * Each column is a <g> carrying only an animation class; the glyph x is set
 * on the <text> elements themselves. That keeps the CSS transform from
 * fighting a positioning transform on the same element, and keeps all timing
 * inside <style> where GitHub will not strip it.
 * ------------------------------------------------------------------ */

function rainLayer({
  prefix, // unique per-SVG class prefix
  width,
  height,
  spacing = 22,
  fontSize = 13,
  lineH = 18,
  rows = 14,
  minDur = 5,
  maxDur = 13,
  peak = 0.55,
  head = true,
  seed = 20260906,
}) {
  const rand = mulberry32(seed);
  const contentH = rows * lineH;
  const cols = [];
  const rules = [];
  let n = 0;

  for (let x = spacing / 2; x < width; x += spacing) {
    const dur = r2(minDur + rand() * (maxDur - minDur));
    // Negative delay starts each column mid-flight, so the very first frame
    // already looks like rain in progress rather than an empty screen.
    const delay = r2(-rand() * dur);
    const cls = `${prefix}${n}`;
    const glyphs = [];

    for (let i = 0; i < rows; i++) {
      const g = GLYPHS[Math.floor(rand() * GLYPHS.length)];
      const isHead = head && i === rows - 1;
      // Tail fades out, head burns bright.
      const o = isHead ? 1 : r2(peak * Math.pow((i + 1) / rows, 2.1));
      const fill = isHead ? C.white : rand() < 0.14 ? C.rainAlt : C.rain;
      glyphs.push(
        `<text x="${r2(x)}" y="${i * lineH}" fill="${fill}" opacity="${o}">${esc(
          g
        )}</text>`
      );
    }

    rules.push(
      `.${cls}{animation:${prefix}fall ${dur}s linear infinite ${delay}s}`
    );
    cols.push(`<g class="${cls}">${glyphs.join('')}</g>`);
    n++;
  }

  const css =
    `.rain text{font-family:${MONO};font-size:${fontSize}px}` +
    `@keyframes ${prefix}fall{` +
    `from{transform:translateY(${-contentH}px)}` +
    `to{transform:translateY(${height}px)}}` +
    rules.join('');

  const reduce = cols.map((_, i) => `.${prefix}${i}`).join(',') + '{animation:none}';

  return { markup: `<g class="rain">${cols.join('')}</g>`, css, reduce };
}

/* ------------------------------------------------------------------ *
 * 1. Hero banner — matrix rain + identity plate.
 * ------------------------------------------------------------------ */

function heroBanner() {
  const W = 1000;
  const H = 260;
  const rain = rainLayer({
    prefix: 'hb',
    width: W,
    height: H,
    spacing: 23,
    rows: 15,
    minDur: 3.2,
    maxDur: 8.5,
    peak: 0.5,
    seed: 1011,
  });

  const plateW = 640;
  const plateH = 118;
  const plateX = (W - plateW) / 2;
  const plateY = (H - plateH) / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(
    ID.name
  )} — ${esc(ID.role)}">
  <title>${esc(ID.name)} // ${esc(ID.role)}</title>
  <defs>
    <linearGradient id="hbBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.bgDeep}"/>
      <stop offset="0.55" stop-color="${C.bgSoft}"/>
      <stop offset="1" stop-color="${C.bgDeep}"/>
    </linearGradient>
    <linearGradient id="hbEdge" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.rainAlt}" stop-opacity="0.75"/>
      <stop offset="0.5" stop-color="${C.blue}" stop-opacity="0.4"/>
      <stop offset="1" stop-color="${C.rainAlt}" stop-opacity="0.15"/>
    </linearGradient>
    <linearGradient id="hbScan" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.rainAlt}" stop-opacity="0"/>
      <stop offset="0.5" stop-color="${C.rainAlt}" stop-opacity="0.15"/>
      <stop offset="1" stop-color="${C.rainAlt}" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="hbVig" cx="0.5" cy="0.5" r="0.72">
      <stop offset="0.45" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.72"/>
    </radialGradient>
    <clipPath id="hbClip"><rect x="1" y="1" width="${W - 2}" height="${
    H - 2
  }" rx="14"/></clipPath>
  </defs>
  <style>
    .mono{font-family:${MONO}}
    ${rain.css}
    .scan{animation:hbScanMove 8s linear infinite}
    @keyframes hbScanMove{from{transform:translateY(-70px)}to{transform:translateY(${H}px)}}
    .cur{animation:hbBlink 1.15s steps(1,end) infinite}
    @keyframes hbBlink{0%,49%{opacity:1}50%,100%{opacity:0}}
    .in{animation:hbIn .5s ease-out backwards}
    @keyframes hbIn{from{opacity:0}to{opacity:1}}
    .d1{animation-delay:.15s}.d2{animation-delay:.4s}.d3{animation-delay:.65s}
    @media (prefers-reduced-motion:reduce){
      ${rain.reduce}
      .scan,.cur{animation:none}
    }
  </style>

  <rect width="${W}" height="${H}" rx="14" fill="url(#hbBg)"/>
  <g clip-path="url(#hbClip)">
    ${rain.markup}
    <rect class="scan" width="${W}" height="70" fill="url(#hbScan)"/>
    <rect width="${W}" height="${H}" fill="url(#hbVig)"/>

    <!-- identity plate -->
    <rect x="${plateX}" y="${plateY}" width="${plateW}" height="${plateH}" rx="10"
          fill="${C.bgDeep}" fill-opacity="0.82" stroke="${C.rainAlt}" stroke-opacity="0.28"/>
    <rect x="${plateX}" y="${plateY}" width="3" height="${plateH}" rx="1.5" fill="${
    C.rainAlt
  }" fill-opacity="0.8"/>

    <text class="mono in d1" x="${W / 2}" y="${
    plateY + 30
  }" text-anchor="middle" font-size="10.5" fill="${
    C.dim
  }" letter-spacing="3.5">SYSTEM ONLINE  //  SESSION AUTHENTICATED</text>

    <text class="mono in d2" x="${W / 2}" y="${
    plateY + 68
  }" text-anchor="middle" font-size="34" font-weight="700" fill="${
    C.white
  }" letter-spacing="6">${esc(ID.name)}<tspan class="cur" fill="${
    C.rainAlt
  }" letter-spacing="0">_</tspan></text>

    <text class="mono in d3" x="${W / 2}" y="${
    plateY + 92
  }" text-anchor="middle" font-size="11" fill="${
    C.rainAlt
  }" letter-spacing="4.5">${esc(ID.role)}</text>

    <text class="mono in d3" x="${W / 2}" y="${
    H - 22
  }" text-anchor="middle" font-size="9.5" fill="${
    C.dim
  }" letter-spacing="3">${esc(ID.tagline)}</text>

    <!-- corner ticks -->
    <g stroke="${C.rainAlt}" stroke-opacity="0.5" stroke-width="1.5" fill="none">
      <path d="M18 40V22h18"/><path d="M${W - 18} 40V22h-18"/>
      <path d="M18 ${H - 40}v18h18"/><path d="M${W - 18} ${H - 40}v18h-18"/>
    </g>
  </g>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${
    H - 1
  }" rx="14" fill="none" stroke="url(#hbEdge)"/>
</svg>
`;
}

/* ------------------------------------------------------------------ *
 * 2. Divider — thin matrix rain strip.
 * ------------------------------------------------------------------ */

function divider() {
  const W = 1000;
  const H = 34;
  const rain = rainLayer({
    prefix: 'dv',
    width: W,
    height: H,
    spacing: 26,
    fontSize: 11,
    lineH: 14,
    rows: 4,
    minDur: 2.2,
    maxDur: 6,
    peak: 0.42,
    seed: 7742,
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Section divider">
  <title>matrix divider</title>
  <defs>
    <linearGradient id="dvLine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.rainAlt}" stop-opacity="0"/>
      <stop offset="0.15" stop-color="${C.rainAlt}" stop-opacity="0.65"/>
      <stop offset="0.5" stop-color="${C.blue}" stop-opacity="0.5"/>
      <stop offset="0.85" stop-color="${C.rainAlt}" stop-opacity="0.65"/>
      <stop offset="1" stop-color="${C.rainAlt}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="dvPulse" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.rainAlt}" stop-opacity="0"/>
      <stop offset="0.5" stop-color="${C.white}" stop-opacity="0.9"/>
      <stop offset="1" stop-color="${C.rainAlt}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="dvFade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.bgDeep}"/>
      <stop offset="0.12" stop-color="${C.bgDeep}" stop-opacity="0"/>
      <stop offset="0.88" stop-color="${C.bgDeep}" stop-opacity="0"/>
      <stop offset="1" stop-color="${C.bgDeep}"/>
    </linearGradient>
    <clipPath id="dvClip"><rect width="${W}" height="${H}"/></clipPath>
  </defs>
  <style>
    ${rain.css}
    .glide{animation:dvGlide 9s linear infinite}
    @keyframes dvGlide{from{transform:translateX(-180px)}to{transform:translateX(${W}px)}}
    @media (prefers-reduced-motion:reduce){
      ${rain.reduce}
      .glide{animation:none}
    }
  </style>
  <g clip-path="url(#dvClip)">
    ${rain.markup}
    <rect width="${W}" height="${H}" fill="url(#dvFade)"/>
    <rect y="${H / 2 - 1}" width="${W}" height="2" fill="url(#dvLine)"/>
    <rect class="glide" y="${H / 2 - 1}" width="180" height="2" fill="url(#dvPulse)"/>
  </g>
  <g fill="${C.rainAlt}" fill-opacity="0.5">
    <rect x="0" y="${H / 2 - 5}" width="2" height="10"/>
    <rect x="${W - 2}" y="${H / 2 - 5}" width="2" height="10"/>
  </g>
</svg>
`;
}

/* ------------------------------------------------------------------ *
 * 3. Name scramble — glyphs decrypt left-to-right into the name, then hold.
 *
 * Flip-book: one <text> per frame, each with its own keyframes window, so
 * exactly one frame is visible at a time. Frame N locks the first N letters
 * and keeps scrambling the rest.
 * ------------------------------------------------------------------ */

function nameScramble() {
  const W = 700;
  const H = 140;
  const target = ID.name;
  const rand = mulberry32(4242);

  const STEP = 0.11; // seconds per scramble frame
  const HOLD = 2.6; // seconds the resolved name stays up
  const letters = target.replace(/ /g, '').length;
  const PER = 3; // scramble frames per letter locked
  const FRAMES = letters * PER;
  const scrambleT = FRAMES * STEP;
  const TOTAL = r2(scrambleT + HOLD);

  const frames = [];
  const rules = [];

  for (let i = 0; i < FRAMES; i++) {
    const locked = Math.floor(i / PER);
    let s = '';
    let seenLetters = 0;
    for (let c = 0; c < target.length; c++) {
      if (target[c] === ' ') {
        s += ' ';
        continue;
      }
      if (seenLetters < locked) s += target[c];
      else s += GLYPHS[Math.floor(rand() * GLYPHS.length)];
      seenLetters++;
    }

    // Locked prefix reads white; the churning tail stays matrix green, with an
    // occasional blue flicker so it feels like it is still resolving.
    const tailFill = i % 5 === 3 ? C.blue : C.rain;
    const cls = `nsf${i}`;
    const start = (i * STEP) / TOTAL * 100;
    const end = ((i + 1) * STEP) / TOTAL * 100;

    rules.push(
      `.${cls}{animation:kf${cls} ${TOTAL}s steps(1,end) infinite}` +
        `@keyframes kf${cls}{${visWindow(start, end)}}`
    );

    frames.push(
      `<text class="mono ${cls}" x="${
        W / 2
      }" y="78" text-anchor="middle" font-size="46" font-weight="700" fill="${tailFill}" letter-spacing="4">${esc(
        s
      )}</text>`
    );
  }

  // Final resolved frame — name + role, held to the end of the cycle.
  const lockStart = (scrambleT / TOTAL) * 100;
  rules.push(
    `.nslock{animation:kfnslock ${TOTAL}s steps(1,end) infinite}` +
      `@keyframes kfnslock{${visWindow(lockStart, 100)}}`
  );

  const rain = rainLayer({
    prefix: 'ns',
    width: W,
    height: H,
    spacing: 28,
    fontSize: 11,
    lineH: 15,
    rows: 10,
    minDur: 2.6,
    maxDur: 6.5,
    peak: 0.22,
    head: false,
    seed: 9090,
  });

  const allFrames = frames.map((_, i) => `.nsf${i}`).join(',');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(
    target
  )} — ${esc(ID.role)}">
  <title>${esc(target)}</title>
  <defs>
    <clipPath id="nsClip"><rect width="${W}" height="${H}" rx="10"/></clipPath>
  </defs>
  <style>
    .mono{font-family:${MONO}}
    ${rain.css}
    ${allFrames}{opacity:0}
    .nslock{opacity:0}
    ${rules.join('\n    ')}
    @media (prefers-reduced-motion:reduce){
      ${rain.reduce}
      ${allFrames}{animation:none;opacity:0}
      .nslock{animation:none;opacity:1}
    }
  </style>
  <rect width="${W}" height="${H}" rx="10" fill="${C.bgMid}"/>
  <g clip-path="url(#nsClip)">
    ${rain.markup}
    ${frames.join('\n    ')}
    <g class="nslock">
      <text class="mono" x="${
        W / 2
      }" y="78" text-anchor="middle" font-size="46" font-weight="700" fill="${
    C.white
  }" letter-spacing="4">${esc(target)}</text>
      <text class="mono" x="${
        W / 2
      }" y="106" text-anchor="middle" font-size="10" fill="${
    C.rainAlt
  }" letter-spacing="3.5">${esc(ID.role)}</text>
    </g>
    <text class="mono" x="18" y="24" font-size="9.5" fill="${
      C.dim
    }" letter-spacing="2">DECRYPT://IDENTITY</text>
  </g>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${
    H - 1
  }" rx="10" fill="none" stroke="${C.rainAlt}" stroke-opacity="0.25"/>
</svg>
`;
}

/* ------------------------------------------------------------------ *
 * 4. Terminal slides — three auto-rotating BA console panes.
 * ------------------------------------------------------------------ */

function terminalSlides() {
  const W = 740;
  const H = 270;
  const SLIDE = 7; // seconds each
  const slides = [
    {
      cmd: 'elicit --stakeholder all --until unambiguous',
      lines: [
        ['ok', 'interviews + workshops logged'],
        ['ok', 'stated request separated from real need'],
        ['ok', 'root cause isolated, symptom discarded'],
        ['warn', '3 open questions queued for follow-up'],
        ['out', 'RAW NEED CAPTURED — 0 assumptions unlogged'],
      ],
    },
    {
      cmd: 'model --as-is --to-be --notation bpmn2',
      lines: [
        ['ok', 'as-is flow mapped, 2 bottlenecks flagged'],
        ['ok', 'to-be flow drafted with swimlanes'],
        ['ok', 'UML use case + sequence attached'],
        ['warn', 'handoff at step 04 needs owner sign-off'],
        ['out', 'MODEL VALIDATED — process is now obvious'],
      ],
    },
    {
      cmd: 'specify --format story --with-acceptance-criteria',
      lines: [
        ['ok', 'user stories sliced to deliverable size'],
        ['ok', 'Given / When / Then criteria written'],
        ['ok', 'traceability matrix linked to REQ ids'],
        ['ok', 'definition of done agreed with team'],
        ['out', 'SPEC TESTABLE — 0 orphaned requirements'],
      ],
    },
  ];

  const N = slides.length;
  const TOTAL = SLIDE * N;
  const glyphFor = { ok: '[ OK ]', warn: '[WARN]', out: '  ==> ' };
  const fillFor = { ok: C.rain, warn: C.amber, out: C.white };

  const rules = [];
  const panes = slides
    .map((s, i) => {
      const cls = `tsp${i}`;
      const start = ((i * SLIDE) / TOTAL) * 100;
      const end = (((i + 1) * SLIDE) / TOTAL) * 100;
      rules.push(
        `.${cls}{animation:kf${cls} ${TOTAL}s steps(1,end) infinite}` +
          `@keyframes kf${cls}{${visWindow(start, end)}}`
      );

      const rows = s.lines
        .map(
          (l, j) =>
            `<text x="26" y="${128 + j * 24}" font-size="11.5">` +
            `<tspan fill="${fillFor[l[0]]}">${esc(glyphFor[l[0]])}</tspan>` +
            `<tspan fill="${l[0] === 'out' ? C.white : C.txt}" dx="10">${esc(
              l[1]
            )}</tspan></text>`
        )
        .join('\n      ');

      return `<g class="mono ${cls}">
      <text x="26" y="60" font-size="12">` +
        `<tspan fill="${C.rain}">${esc(ID.handle)}@analysis</tspan>` +
        `<tspan fill="${C.dim}" dx="6">:~$</tspan>` +
        `<tspan fill="${C.white}" dx="8">${esc(s.cmd)}</tspan></text>
      <text x="26" y="88" font-size="10" fill="${C.dim}" letter-spacing="1.5">STAGE ${
        i + 1
      } / ${N}  //  PIPELINE RUNNING</text>
      ${rows}
    </g>`;
    })
    .join('\n    ');

  const allPanes = slides.map((_, i) => `.tsp${i}`).join(',');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Business analysis pipeline console: elicit, model, specify">
  <title>analysis console — elicit / model / specify</title>
  <defs>
    <linearGradient id="tsBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.bgSoft}"/>
      <stop offset="1" stop-color="${C.bgDeep}"/>
    </linearGradient>
    <clipPath id="tsClip"><rect width="${W}" height="${H}" rx="10"/></clipPath>
  </defs>
  <style>
    .mono{font-family:${MONO}}
    ${allPanes}{opacity:0}
    ${rules.join('\n    ')}
    .cur{animation:tsBlink 1.15s steps(1,end) infinite}
    @keyframes tsBlink{0%,49%{opacity:1}50%,100%{opacity:0}}
    @media (prefers-reduced-motion:reduce){
      ${allPanes}{animation:none;opacity:0}
      .tsp0{opacity:1}
      .cur{animation:none}
    }
  </style>
  <rect width="${W}" height="${H}" rx="10" fill="url(#tsBg)"/>
  <g clip-path="url(#tsClip)">
    <!-- title bar -->
    <rect width="${W}" height="30" fill="${C.bgDeep}"/>
    <g>
      <circle cx="20" cy="15" r="4.5" fill="#f85149" fill-opacity="0.85"/>
      <circle cx="38" cy="15" r="4.5" fill="${C.amber}" fill-opacity="0.85"/>
      <circle cx="56" cy="15" r="4.5" fill="${C.rain}" fill-opacity="0.85"/>
    </g>
    <text class="mono" x="${
      W / 2
    }" y="19" text-anchor="middle" font-size="10" fill="${
    C.dim
  }" letter-spacing="2">${esc(ID.handle)} — analysis console</text>
    <rect y="30" width="${W}" height="1" fill="${C.rainAlt}" fill-opacity="0.2"/>

    ${panes}

    <text class="mono cur" x="26" y="${
      H - 26
    }" font-size="12" fill="${C.rainAlt}">_</text>
    <text class="mono" x="${W - 26}" y="${
    H - 26
  }" text-anchor="end" font-size="9" fill="${
    C.dim
  }" letter-spacing="1.5">auto-advance ${SLIDE}s</text>
  </g>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${
    H - 1
  }" rx="10" fill="none" stroke="${C.rainAlt}" stroke-opacity="0.22"/>
</svg>
`;
}

/* ------------------------------------------------------------------ *
 * 5. Spacer — forces a minimum column width in GitHub-rendered tables.
 * ------------------------------------------------------------------ */

function spacer() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"><rect width="1" height="1" fill="none"/></svg>\n`;
}

/* ------------------------------------------------------------------ *
 * Write everything.
 * ------------------------------------------------------------------ */

const ASSETS = [
  ['matrix-banner.svg', heroBanner],
  ['matrix-divider.svg', divider],
  ['name-scramble.svg', nameScramble],
  ['terminal-slides.svg', terminalSlides],
  ['spacer.svg', spacer],
];

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const [file, build] of ASSETS) {
    const target = path.join(OUT_DIR, file);
    const svg = build();

    // Inline style attributes are stripped by GitHub's SVG sanitiser, which
    // would silently freeze any animation driven by one. Fail loudly instead.
    if (/\sstyle="/.test(svg)) {
      throw new Error(
        `${file}: inline style attribute found — move timing into a CSS class ` +
          `(GitHub strips inline styles and the animation would not run).`
      );
    }

    fs.writeFileSync(target, svg, 'utf8');
    const kb = (Buffer.byteLength(svg, 'utf8') / 1024).toFixed(1);
    console.log(`  wrote assets/${file.padEnd(22)} ${kb.padStart(6)} KB`);
  }

  console.log(`\n${ASSETS.length} assets generated into assets/.`);
}

main();
