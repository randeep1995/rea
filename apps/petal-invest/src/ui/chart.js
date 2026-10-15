// Minimal responsive SVG line chart with a soft gradient fill.
let uid = 0;

export function lineChart(values, { height = 160, up = true } = {}) {
  if (values.length < 2) return "";
  const width = 320;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 8;
  const points = values.map((v, i) => [
    (i / (values.length - 1)) * width,
    pad + (1 - (v - min) / span) * (height - pad * 2),
  ]);
  const line = points
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join("");
  const area = `${line}L${width},${height}L0,${height}Z`;
  const id = `g${++uid}`;
  const color = up ? "var(--up)" : "var(--down)";
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Price chart">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity="0.28"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#${id})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
  </svg>`;
}

export function sparkline(values, up) {
  return lineChart(values, { height: 36, up }).replace(
    'class="chart"',
    'class="spark"',
  );
}
