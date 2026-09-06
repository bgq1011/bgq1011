#!/usr/bin/env node
/**
 * generate-metrics.js
 *
 * Builds dist/metrics.svg — a terminal-themed profile dashboard rendered from
 * live GitHub API data. No runtime dependencies: uses Node 18+ global fetch.
 *
 * Environment:
 *   GITHUB_TOKEN              required — any token with public read scope
 *   GITHUB_REPOSITORY_OWNER   required — the login to report on
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TOKEN = process.env.GITHUB_TOKEN;
const OWNER = process.env.GITHUB_REPOSITORY_OWNER;

const OUT_DIR = path.join(__dirname, '..', 'dist');
const OUT_FILE = path.join(OUT_DIR, 'metrics.svg');

const GRAPHQL = 'https://api.github.com/graphql';

// Terminal palette — kept in sync with assets/header.svg.
const C = {
  bgFrom: '#070a0f',
  bgTo: '#0a1017',
  panel: '#0d141c',
  cyan: '#1de9b6',
  blue: '#58a6ff',
  green: '#3fb950',
  amber: '#d29922',
  white: '#e6edf3',
  text: '#a9c2d1',
  dim: '#4a5a68',
};

// Language bar colours, cycled in order. Deliberately theme-consistent rather
// than using GitHub's per-language colours, which clash with the dark palette.
const LANG_COLORS = ['#1de9b6', '#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#f778ba'];

/** Escape the five XML characters that break SVG text nodes. */
function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Truncate to a monospace-safe length so text cannot overflow its panel. */
function clamp(value, max) {
  const s = String(value);
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

function compact(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

/** Relative age in whole days, for the "updated" column. */
function daysAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

async function graphql(query, variables) {
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'profile-metrics-generator',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`GitHub API responded ${res.status} ${res.statusText}`);
  }

  const body = await res.json();
  if (body.errors?.length) {
    throw new Error(`GraphQL error: ${body.errors.map((e) => e.message).join('; ')}`);
  }
  return body.data;
}

/**
 * One paginated pass over the user's public repositories plus the profile
 * totals. Contribution counts come from contributionsCollection, which is
 * available for the authenticated user and for any public profile.
 */
const QUERY = `
query Profile($login: String!, $cursor: String) {
  user(login: $login) {
    login
    name
    createdAt
    followers { totalCount }
    following { totalCount }
    repositories(
      first: 100
      after: $cursor
      privacy: PUBLIC
      isFork: false
      ownerAffiliations: OWNER
      orderBy: { field: PUSHED_AT, direction: DESC }
    ) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        stargazerCount
        forkCount
        pushedAt
        primaryLanguage { name }
        languages(first: 12, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name } }
        }
      }
    }
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      totalPullRequestReviewContributions
      contributionCalendar { totalContributions }
    }
  }
}`;

async function collect(login) {
  let cursor = null;
  let user = null;
  const repos = [];

  // GraphQL caps page size at 100; loop until the connection is exhausted.
  do {
    const data = await graphql(QUERY, { login, cursor });
    if (!data.user) throw new Error(`No such GitHub user: ${login}`);
    user = data.user;
    repos.push(...user.repositories.nodes);
    cursor = user.repositories.pageInfo.hasNextPage
      ? user.repositories.pageInfo.endCursor
      : null;
  } while (cursor);

  const totalStars = repos.reduce((sum, r) => sum + r.stargazerCount, 0);
  const totalForks = repos.reduce((sum, r) => sum + r.forkCount, 0);

  // Aggregate language bytes across every non-fork public repo.
  const byteTotals = new Map();
  for (const repo of repos) {
    for (const edge of repo.languages.edges) {
      byteTotals.set(edge.node.name, (byteTotals.get(edge.node.name) ?? 0) + edge.size);
    }
  }
  const totalBytes = [...byteTotals.values()].reduce((a, b) => a + b, 0);
  const languages = [...byteTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, size], i) => ({
      name,
      percent: totalBytes ? (size / totalBytes) * 100 : 0,
      color: LANG_COLORS[i % LANG_COLORS.length],
    }));

  const recent = repos
    .filter((r) => r.pushedAt)
    .sort((a, b) => new Date(b.pushedAt) - new Date(a.pushedAt))
    .slice(0, 5)
    .map((r) => ({
      name: r.name,
      stars: r.stargazerCount,
      language: r.primaryLanguage?.name ?? '—',
      updated: daysAgo(r.pushedAt),
    }));

  const c = user.contributionsCollection;

  return {
    login: user.login,
    name: user.name || user.login,
    memberSince: new Date(user.createdAt).getUTCFullYear(),
    publicRepos: user.repositories.totalCount,
    followers: user.followers.totalCount,
    following: user.following.totalCount,
    totalStars,
    totalForks,
    commits: c.totalCommitContributions,
    pullRequests: c.totalPullRequestContributions,
    issues: c.totalIssueContributions,
    reviews: c.totalPullRequestReviewContributions,
    contributionsThisYear: c.contributionCalendar.totalContributions,
    languages,
    recent,
  };
}

/** A single KPI tile. */
function tile(x, y, label, value, accent) {
  return `
    <g>
      <rect x="${x}" y="${y}" width="168" height="76" rx="8" fill="${C.panel}" fill-opacity="0.8" stroke="${accent}" stroke-opacity="0.22"/>
      <rect x="${x}" y="${y}" width="3" height="76" rx="1.5" fill="${accent}" fill-opacity="0.75"/>
      <text class="mono kpiLabel" x="${x + 16}" y="${y + 26}">${esc(label)}</text>
      <text class="mono kpiValue" x="${x + 16}" y="${y + 60}" fill="${accent}">${esc(value)}</text>
    </g>`;
}

function render(d) {
  const generated = new Date().toISOString().replace('T', ' ').slice(0, 16);

  const tiles = [
    ['PUBLIC REPOS', compact(d.publicRepos), C.cyan],
    ['TOTAL STARS', compact(d.totalStars), C.amber],
    ['FOLLOWERS', compact(d.followers), C.blue],
    ['FOLLOWING', compact(d.following), C.blue],
    ['FORKS', compact(d.totalForks), C.green],
    ['COMMITS / YR', compact(d.commits), C.cyan],
    ['PULL REQUESTS', compact(d.pullRequests), C.green],
    ['CONTRIB / YR', compact(d.contributionsThisYear), C.amber],
  ];

  const tilesSvg = tiles
    .map(([label, value, accent], i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      return tile(28 + col * 186, 108 + row * 92, label, value, accent);
    })
    .join('');

  // Language panel: stacked bar plus legend, or a placeholder when a profile
  // has no detectable language bytes yet.
  const langPanel = (() => {
    const x = 28;
    const y = 312;
    const width = 430;
    const barX = x + 18;
    const barW = width - 36;

    let bar = '';
    let legend = '';

    if (d.languages.length === 0) {
      bar = `<rect x="${barX}" y="${y + 46}" width="${barW}" height="12" rx="6" fill="${C.dim}" fill-opacity="0.25"/>`;
      legend = `<text class="mono dim" x="${barX}" y="${y + 88}" font-size="11">no language data in public repositories</text>`;
    } else {
      let offset = 0;
      bar = d.languages
        .map((lang) => {
          const w = Math.max((lang.percent / 100) * barW, 2);
          const seg = `<rect x="${(barX + offset).toFixed(1)}" y="${y + 46}" width="${w.toFixed(1)}" height="12" fill="${lang.color}" fill-opacity="0.85"/>`;
          offset += w;
          return seg;
        })
        .join('');
      bar = `<g><clipPath id="langClip"><rect x="${barX}" y="${y + 46}" width="${barW}" height="12" rx="6"/></clipPath><g clip-path="url(#langClip)"><rect x="${barX}" y="${y + 46}" width="${barW}" height="12" fill="${C.dim}" fill-opacity="0.2"/>${bar}</g></g>`;

      legend = d.languages
        .map((lang, i) => {
          const col = i % 2;
          const row = Math.floor(i / 2);
          const lx = barX + col * 200;
          const ly = y + 86 + row * 24;
          return `
      <g>
        <rect x="${lx}" y="${ly - 8}" width="9" height="9" rx="2" fill="${lang.color}"/>
        <text class="mono txt" x="${lx + 17}" y="${ly}" font-size="11.5">${esc(clamp(lang.name, 14))}</text>
        <text class="mono dim" x="${lx + 176}" y="${ly}" font-size="11" text-anchor="end">${lang.percent.toFixed(1)}%</text>
      </g>`;
        })
        .join('');
    }

    return `
  <g>
    <rect x="${x}" y="${y}" width="${width}" height="188" rx="10" fill="${C.panel}" fill-opacity="0.65" stroke="${C.cyan}" stroke-opacity="0.16"/>
    <text class="mono cap" x="${x + 18}" y="${y + 26}">LANGUAGE DISTRIBUTION</text>
    <line x1="${x + 18}" y1="${y + 36}" x2="${x + width - 18}" y2="${y + 36}" stroke="${C.cyan}" stroke-opacity="0.12"/>
    ${bar}
    ${legend}
  </g>`;
  })();

  // Recently pushed repositories.
  const repoPanel = (() => {
    const x = 476;
    const y = 312;
    const width = 496;

    const rows = d.recent.length
      ? d.recent
          .map((repo, i) => {
            const ry = y + 62 + i * 24;
            return `
      <g>
        <text class="mono cyan" x="${x + 18}" y="${ry}" font-size="11">▸</text>
        <text class="mono txt" x="${x + 36}" y="${ry}" font-size="11.5">${esc(clamp(repo.name, 26))}</text>
        <text class="mono blue" x="${x + 306}" y="${ry}" font-size="10.5">${esc(clamp(repo.language, 12))}</text>
        <text class="mono amber" x="${x + 402}" y="${ry}" font-size="10.5" text-anchor="end">★ ${esc(compact(repo.stars))}</text>
        <text class="mono dim" x="${x + width - 18}" y="${ry}" font-size="10.5" text-anchor="end">${esc(repo.updated)}</text>
      </g>`;
          })
          .join('')
      : `<text class="mono dim" x="${x + 18}" y="${y + 62}" font-size="11">no public repositories yet</text>`;

    return `
  <g>
    <rect x="${x}" y="${y}" width="${width}" height="188" rx="10" fill="${C.panel}" fill-opacity="0.65" stroke="${C.blue}" stroke-opacity="0.16"/>
    <text class="mono cap" x="${x + 18}" y="${y + 26}">RECENTLY UPDATED REPOSITORIES</text>
    <line x1="${x + 18}" y1="${y + 36}" x2="${x + width - 18}" y2="${y + 36}" stroke="${C.blue}" stroke-opacity="0.12"/>
    ${rows}
    <text class="mono dim" x="${x + 18}" y="${y + 172}" font-size="10">ISSUES ${esc(compact(d.issues))} · REVIEWS ${esc(compact(d.reviews))} · SINCE ${d.memberSince}</text>
  </g>`;
  })();

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="530" viewBox="0 0 1000 530" role="img" aria-label="GitHub telemetry for ${esc(d.login)}: ${d.publicRepos} public repositories, ${d.totalStars} stars, ${d.followers} followers.">
  <title>GITHUB TELEMETRY — ${esc(d.login)}</title>

  <defs>
    <linearGradient id="mBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.bgFrom}"/>
      <stop offset="1" stop-color="${C.bgTo}"/>
    </linearGradient>
    <linearGradient id="mEdge" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.cyan}" stop-opacity="0.6"/>
      <stop offset="1" stop-color="${C.blue}" stop-opacity="0.25"/>
    </linearGradient>
    <linearGradient id="mScan" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.cyan}" stop-opacity="0"/>
      <stop offset="0.5" stop-color="${C.cyan}" stop-opacity="0.12"/>
      <stop offset="1" stop-color="${C.cyan}" stop-opacity="0"/>
    </linearGradient>
    <pattern id="mGrid" width="26" height="26" patternUnits="userSpaceOnUse">
      <path d="M26 0H0V26" fill="none" stroke="${C.cyan}" stroke-opacity="0.05" stroke-width="1"/>
    </pattern>
    <clipPath id="mFrame">
      <rect x="1" y="1" width="998" height="528" rx="14"/>
    </clipPath>
  </defs>

  <style>
    .mono { font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace; }
    .dim  { fill: ${C.dim}; }
    .txt  { fill: ${C.text}; }
    .cyan { fill: ${C.cyan}; }
    .blue { fill: ${C.blue}; }
    .amber{ fill: ${C.amber}; }
    .cap      { fill: ${C.dim}; font-size: 10.5px; letter-spacing: 1.6px; }
    .kpiLabel { fill: ${C.dim}; font-size: 9.5px; letter-spacing: 1.3px; }
    .kpiValue { font-size: 27px; font-weight: bold; }
    .scan { animation: mscan 9s linear infinite; }
    .dot  { animation: mblink 2.2s ease-in-out infinite; }
    @keyframes mscan  { 0% { transform: translateY(-70px); } 100% { transform: translateY(560px); } }
    @keyframes mblink { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
  </style>

  <g clip-path="url(#mFrame)">
    <rect width="1000" height="530" fill="url(#mBg)"/>
    <rect width="1000" height="530" fill="url(#mGrid)"/>

    <rect x="1" y="1" width="998" height="34" fill="${C.panel}"/>
    <line x1="0" y1="35" x2="1000" y2="35" stroke="${C.cyan}" stroke-opacity="0.18"/>
    <circle class="dot" cx="24" cy="18" r="4" fill="${C.cyan}"/>
    <text class="mono dim" x="42" y="23" font-size="12">telemetry --user ${esc(clamp(d.login, 24))} --live</text>
    <text class="mono dim" x="976" y="23" font-size="11" text-anchor="end">SYNC ${esc(generated)} UTC</text>

    <text class="mono" x="28" y="72" font-size="15">
      <tspan class="cyan">&gt;</tspan>
      <tspan fill="${C.white}" dx="8" font-weight="bold" letter-spacing="1.2">GITHUB TELEMETRY</tspan>
      <tspan class="dim" dx="12" font-size="11">// ${esc(clamp(d.name, 30))}</tspan>
    </text>

    ${tilesSvg}
    ${langPanel}
    ${repoPanel}

    <rect class="scan" x="0" y="0" width="1000" height="64" fill="url(#mScan)"/>
  </g>

  <rect x="1" y="1" width="998" height="528" rx="14" fill="none" stroke="url(#mEdge)" stroke-width="1.5"/>
</svg>
`;
}

async function main() {
  const missing = [
    !TOKEN && 'GITHUB_TOKEN',
    !OWNER && 'GITHUB_REPOSITORY_OWNER',
  ].filter(Boolean);

  if (missing.length) {
    console.error(`Missing required environment variable(s): ${missing.join(', ')}`);
    process.exit(1);
  }

  const data = await collect(OWNER);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, render(data), 'utf8');

  console.log(`Wrote ${path.relative(process.cwd(), OUT_FILE)}`);
  console.log(
    `  repos=${data.publicRepos} stars=${data.totalStars} followers=${data.followers} ` +
      `languages=${data.languages.length} recent=${data.recent.length}`
  );
}

main().catch((err) => {
  console.error(`generate-metrics failed: ${err.message}`);
  process.exit(1);
});
