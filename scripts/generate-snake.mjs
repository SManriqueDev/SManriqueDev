import { writeFileSync, mkdirSync } from 'fs';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const USERNAME = process.env.GITHUB_USER || 'SManriqueDev';
const OUTPUT_DIR = process.argv[2] || 'dist';

const SIZE_CELL = 13;
const SIZE_DOT = 11;
const BORDER_RADIUS = 2;

const COLORS_LIGHT = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];
const COLORS_DARK = ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'];
const SNAKE_COLOR_LIGHT = '#6366f1';
const SNAKE_COLOR_DARK = '#818cf8';
const BORDER_COLOR_LIGHT = '#d0d7de';
const BORDER_COLOR_DARK = '#30363d';

async function fetchContributions(username, token, from, to) {
  const query = `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to, includePrivateContributions: true) {
          contributionCalendar {
            weeks {
              contributionDays {
                contributionCount
                contributionLevel
                weekday
                date
              }
            }
          }
        }
      }
    }
  `;

  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'snake-generator',
    },
    body: JSON.stringify({ query, variables: { login: username, from, to } }),
  });

  if (!res.ok) throw new Error(`GraphQL: ${res.statusText}`);

  const { data, errors } = await res.json();
  if (errors?.[0]) throw new Error(errors[0].message);

  return data.user.contributionsCollection.contributionCalendar.weeks.flatMap(
    ({ contributionDays }, x) =>
      contributionDays.map((d) => ({
        x,
        y: d.weekday,
        date: d.date,
        count: d.contributionCount,
        level: d.contributionLevel === 'FOURTH_QUARTILE' ? 4
          : d.contributionLevel === 'THIRD_QUARTILE' ? 3
          : d.contributionLevel === 'SECOND_QUARTILE' ? 2
          : d.contributionLevel === 'FIRST_QUARTILE' ? 1 : 0,
      })),
  );
}

function getYears() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  return m < 3 ? [y - 1, y - 2, y - 3, y - 4] : [y, y - 1, y - 2, y - 3];
}

async function getAllContributions(username, token) {
  const years = getYears();
  let allCells = [];
  let xOffset = 0;

  for (const year of years) {
    console.log(`Fetching ${year}...`);
    const cells = await fetchContributions(
      username, token,
      `${year}-01-01T00:00:00Z`,
      `${year}-12-31T23:59:59Z`,
    );
    const maxX = cells.length ? Math.max(...cells.map(c => c.x)) + 1 : 53;
    allCells.push(...cells.map(c => ({ ...c, x: c.x + xOffset })));
    xOffset += maxX + 2;
  }

  return allCells;
}

function buildGrid(cells) {
  const w = Math.max(0, ...cells.map(c => c.x)) + 1;
  const h = 7;
  const g = Array.from({ length: w }, () =>
    Array.from({ length: h }, () => ({ level: 0, count: 0, date: null })));

  for (const c of cells) {
    if (c.x >= 0 && c.x < w && c.y >= 0 && c.y < h) {
      g[c.x][c.y] = { level: c.level, count: c.count, date: c.date };
    }
  }
  return { grid: g, width: w, height: h };
}

function zigzagPath(grid, width, height) {
  const path = [];
  for (let y = 0; y < height; y++) {
    if (y % 2 === 0) {
      for (let x = 0; x < width; x++) path.push({ x, y });
    } else {
      for (let x = width - 1; x >= 0; x--) path.push({ x, y });
    }
  }
  return path;
}

function createAnimation(name, frames) {
  const pct = frames.map(f =>
    `${(f.t * 100).toFixed(4)}%{${f.style}}`
  ).join('');
  return `@keyframes ${name}{${pct}}`;
}

function generateSVG(grid, width, height) {
  const svgW = (width + 2) * SIZE_CELL;
  const svgH = (height + 5) * SIZE_CELL;

  const flat = [];
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const cell = grid[x][y];
      if (cell.date !== null || cell.level > 0) {
        flat.push({ x, y, level: cell.level, date: cell.date });
      }
    }
  }

  const cellsToEat = flat.filter(c => c.level > 0);
  const eatOrder = zigzagPath(grid, width, height)
    .filter(p => cellsToEat.some(c => c.x === p.x && c.y === p.y));

  console.log(`Non-empty cells: ${cellsToEat.length}, visitable: ${eatOrder.length}`);

  const snakeLen = Math.min(6, Math.max(3, Math.floor(eatOrder.length / 20)));
  const stepMs = 60;
  const durationMs = Math.max(5000, eatOrder.length * stepMs);
  const mDot = (SIZE_CELL - SIZE_DOT) / 2;

  let cellIdx = 0;
  const cellEls = [];
  const cellRules = [];

  for (const cell of flat) {
    const eatIdx = eatOrder.findIndex(p => p.x === cell.x && p.y === cell.y);
    const level = cell.level;
    const eatTime = eatIdx >= 0 ? eatIdx / eatOrder.length : -1;

    if (eatIdx >= 0) {
      const id = `c${cellIdx++}`;
      const animName = `e${id}`;
      const colorVar = `var(--c${level})`;

      cellRules.push(
        createAnimation(animName, [
          { t: 0, style: `fill:${colorVar}` },
          { t: Math.max(0, eatTime - 0.001), style: `fill:${colorVar}` },
          { t: Math.min(1, eatTime + 0.001), style: `fill:var(--cs)` },
          { t: 1, style: `fill:var(--cs)` },
        ]),
        `.${id}{fill:${colorVar};animation-name:${animName}}`,
      );

      cellEls.push(
        `<rect class="c ${id}" x="${cell.x * SIZE_CELL + mDot}" y="${cell.y * SIZE_CELL + mDot}" rx="${BORDER_RADIUS}" ry="${BORDER_RADIUS}"/>`,
      );
    } else {
      cellEls.push(
        `<rect class="c" x="${cell.x * SIZE_CELL + mDot}" y="${cell.y * SIZE_CELL + mDot}" rx="${BORDER_RADIUS}" ry="${BORDER_RADIUS}" fill="var(--c${level})"/>`,
      );
    }
  }

  const snakeEls = [];
  const snakeRules = [];

  for (let si = 0; si < snakeLen && si < eatOrder.length; si++) {
    const sDot = SIZE_CELL * 0.9 - (SIZE_CELL * 0.9 - SIZE_DOT * 0.8) * (si / snakeLen);
    const sm = (SIZE_CELL - sDot) / 2;
    const sr = Math.min(4.5, (4 * sDot) / SIZE_DOT);
    const sid = `s${si}`;
    const sanim = `sn${sid}`;

    const positions = eatOrder.map((p, i) => ({
      t: i / eatOrder.length,
      style: `transform:translate(${p.x * SIZE_CELL + sm}px,${p.y * SIZE_CELL + sm}px)`,
    }));

    snakeRules.push(
      createAnimation(sanim, positions),
      `.${sid}{animation-name:${sanim}}`,
    );

    const delay = -(si / eatOrder.length) * durationMs;
    snakeEls.push(
      `<rect class="s ${sid}" x="${eatOrder[0].x * SIZE_CELL + sm}" y="${eatOrder[0].y * SIZE_CELL + sm}" width="${sDot}" height="${sDot}" rx="${sr}" ry="${sr}" style="animation-delay:${delay}ms"/>`,
    );
  }

  const css = `
    :root{${COLORS_LIGHT.map((c, i) => `--c${i}:${c}`).join(';')};--ce:${COLORS_LIGHT[0]};--cb:${BORDER_COLOR_LIGHT};--cs:${SNAKE_COLOR_LIGHT}}
    @media(prefers-color-scheme:dark){:root{${COLORS_DARK.map((c, i) => `--c${i}:${c}`).join(';')};--ce:${COLORS_DARK[0]};--cb:${BORDER_COLOR_DARK};--cs:${SNAKE_COLOR_DARK}}}
    .c{shape-rendering:geometricPrecision;fill:var(--ce);stroke-width:1;stroke:var(--cb);animation:${durationMs}ms linear infinite;width:${SIZE_DOT}px;height:${SIZE_DOT}px}
    .s{shape-rendering:geometricPrecision;fill:var(--cs);animation:${durationMs}ms linear infinite}
    ${cellRules.join('\n')}
    ${snakeRules.join('\n')}
  `;

  return `<svg viewBox="${-SIZE_CELL} ${-SIZE_CELL * 2} ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
    <desc>Contribution snake (multi-year)</desc>
    <style>${css}</style>
    ${cellEls.join('\n')}
    ${snakeEls.join('\n')}
  </svg>`;
}

async function main() {
  if (!GITHUB_TOKEN) {
    console.error('GITHUB_TOKEN env var required');
    process.exit(1);
  }

  const cells = await getAllContributions(USERNAME, GITHUB_TOKEN);
  console.log(`Total days: ${cells.length}`);
  console.log(`Non-zero days: ${cells.filter(c => c.level > 0).length}`);

  const { grid, width, height } = buildGrid(cells);
  const svg = generateSVG(grid, width, height);

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(`${OUTPUT_DIR}/github-contribution-grid-snake.svg`, svg);
  writeFileSync(`${OUTPUT_DIR}/github-contribution-grid-snake-dark.svg`, svg);
  console.log(`Written to ${OUTPUT_DIR}/`);
}

main().catch(console.error);
