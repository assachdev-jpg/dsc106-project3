import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import * as topojson from 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm';

const [rows, world] = await Promise.all([
  d3.csv('data/grid_decadal.csv', d3.autoType),
  d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json'),
]);

const scenarios = ['ssp126', 'ssp585'];
const scenarioNames = { ssp126: 'low emissions', ssp585: 'high emissions' };
const scenarioColors = { ssp126: '#2a78d6', ssp585: '#eb6834' };

const decades = Array.from(new Set(rows.map((d) => d.decade))).sort(d3.ascending);
const decadeIndex = new Map(decades.map((d, i) => [d, i]));

const cells = [];
const cellIndex = new Map();
for (const r of rows) {
  const key = `${r.lat},${r.lon}`;
  if (!cellIndex.has(key)) {
    cellIndex.set(key, cells.length);
    cells.push({
      lat: r.lat,
      lon: r.lon > 180 ? r.lon - 360 : r.lon,
      weight: Math.cos((r.lat * Math.PI) / 180),
    });
  }
}

const values = {};
for (const s of scenarios) {
  values[s] = cells.map(() => new Float32Array(decades.length));
}
for (const r of rows) {
  values[r.scenario][cellIndex.get(`${r.lat},${r.lon}`)][decadeIndex.get(r.decade)] = r.anomaly;
}

const allCells = d3.range(cells.length);

function regionSeries(scenario, ids) {
  return decades.map((decade, j) => {
    let sum = 0;
    let total = 0;
    for (const i of ids) {
      sum += values[scenario][i][j] * cells[i].weight;
      total += cells[i].weight;
    }
    return { year: decade + 5, value: sum / total };
  });
}

const globalSeries = Object.fromEntries(scenarios.map((s) => [s, regionSeries(s, allCells)]));

const presets = [
  { name: 'The Arctic', label: 'Arctic', bounds: [-180, 65, 180, 90] },
  { name: 'The United States', label: 'United States', bounds: [-125, 25, -67, 50] },
  { name: 'Europe', label: 'Europe', bounds: [-10, 35, 40, 70] },
  { name: 'The tropics', label: 'Tropics', bounds: [-180, -23.5, 180, 23.5] },
  { name: 'Antarctica', label: 'Antarctica', bounds: [-180, -90, 180, -65] },
];

let scenario = 'ssp585';
let decade = 2090;
let selected = [];
let regionName = presets[0].name;
let lastSelection = null;

const shortName = (n) => {
  const s = n.replace(/^The /, '');
  return s[0].toUpperCase() + s.slice(1);
};

const fmt = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}°C`;

const width = 960;
const height = 480;
const projection = d3.geoEquirectangular().fitSize([width, height], { type: 'Sphere' });
const path = d3.geoPath(projection);

const thresholds = [0, 1, 2, 3, 4, 6, 8];
const color = d3.scaleThreshold(thresholds, ['#6baed6', ...d3.schemeYlOrRd[7]]);

const svg = d3.select('#map').append('svg').attr('viewBox', [0, 0, width, height]);

const cellRects = svg
  .append('g')
  .selectAll('rect')
  .data(allCells)
  .join('rect')
  .attr('class', 'cell')
  .each(function (i) {
    const c = cells[i];
    const [x0, y0] = projection([c.lon - 2.5, Math.min(c.lat + 2.5, 90)]);
    const [x1, y1] = projection([c.lon + 2.5, Math.max(c.lat - 2.5, -90)]);
    d3.select(this).attr('x', x0).attr('y', y0).attr('width', x1 - x0).attr('height', y1 - y0);
  });

svg
  .append('path')
  .datum(topojson.feature(world, world.objects.land))
  .attr('class', 'land')
  .attr('d', path);

const hoverBox = svg.append('rect').attr('class', 'hover-box').attr('visibility', 'hidden');

const brush = d3
  .brush()
  .extent([
    [0, 0],
    [width, height],
  ])
  .on('brush end', brushed);

const brushG = svg.append('g').attr('class', 'brush').call(brush);

function brushed(event) {
  if (!event.selection) {
    if (event.sourceEvent && lastSelection) brushG.call(brush.move, lastSelection);
    return;
  }
  const [[x0, y0], [x1, y1]] = event.selection;
  const [west, north] = projection.invert([x0, y0]);
  const [east, south] = projection.invert([x1, y1]);
  const ids = allCells.filter((i) => {
    const c = cells[i];
    return c.lon >= west && c.lon <= east && c.lat >= south && c.lat <= north;
  });
  if (ids.length === 0) return;
  lastSelection = event.selection;
  selected = ids;
  if (event.sourceEvent && event.type === 'brush') {
    regionName = 'Your selection';
    d3.selectAll('.preset').classed('active', false);
  }
  updateLine();
  updateReadout();
}

function selectPreset(p) {
  const [w, s, e, n] = p.bounds;
  regionName = p.name;
  d3.selectAll('.preset').classed('active', (d) => d === p);
  brushG.call(brush.move, [projection([w, n]), projection([e, s])]);
}

d3.select('#preset-buttons')
  .selectAll('button')
  .data(presets)
  .join('button')
  .attr('class', 'preset')
  .text((d) => d.label)
  .on('click', (event, d) => selectPreset(d));

const tooltip = d3.select('#tooltip');

svg
  .on('pointermove', (event) => {
    const [mx, my] = d3.pointer(event, svg.node());
    const [lon, lat] = projection.invert([mx, my]);
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return hideTooltip();
    const clat = Math.min(87.5, Math.floor(lat / 5) * 5 + 2.5);
    const clon = Math.min(177.5, Math.floor(lon / 5) * 5 + 2.5);
    const i = cellIndex.get(`${clat},${clon < 0 ? clon + 360 : clon}`);
    if (i === undefined) return hideTooltip();
    const j = decadeIndex.get(decade);
    const [x0, y0] = projection([clon - 2.5, clat + 2.5]);
    const [x1, y1] = projection([clon + 2.5, clat - 2.5]);
    hoverBox
      .attr('visibility', 'visible')
      .attr('x', x0)
      .attr('y', y0)
      .attr('width', x1 - x0)
      .attr('height', y1 - y0);
    tooltip
      .attr('hidden', null)
      .style('left', `${event.clientX + 14}px`)
      .style('top', `${event.clientY + 14}px`)
      .html(
        `<strong>${Math.abs(clat)}°${clat >= 0 ? 'N' : 'S'}, ${Math.abs(clon)}°${clon >= 0 ? 'E' : 'W'}</strong>
        <br>${decade}s
        <br><span class="dot low"></span>Low: ${fmt(values.ssp126[i][j])}
        <br><span class="dot high"></span>High: ${fmt(values.ssp585[i][j])}`,
      );
  })
  .on('pointerleave', hideTooltip);

function hideTooltip() {
  tooltip.attr('hidden', true);
  hoverBox.attr('visibility', 'hidden');
}

const legendLabels = ['below 0', '0–1', '1–2', '2–3', '3–4', '4–6', '6–8', '8+'];
const legend = d3.select('#legend');
legend
  .selectAll('span.item')
  .data(color.range())
  .join('span')
  .attr('class', 'item')
  .html((c, i) => `<span class="swatch" style="background:${c}"></span>${legendLabels[i]}`);
legend.append('span').attr('class', 'unit').text('°C warmer than 1850–1900');

function updateMap() {
  const j = decadeIndex.get(decade);
  cellRects
    .transition()
    .duration(250)
    .attr('fill', (i) => color(values[scenario][i][j]));
}

const lw = 960;
const lh = 340;
const lm = { top: 20, right: 170, bottom: 35, left: 55 };

const lsvg = d3.select('#line').append('svg').attr('viewBox', [0, 0, lw, lh]);
const x = d3.scaleLinear([1850, 2100], [lm.left, lw - lm.right]);
const y = d3.scaleLinear().range([lh - lm.bottom, lm.top]);

const gridG = lsvg.append('g').attr('class', 'gridlines').attr('transform', `translate(${lm.left},0)`);
lsvg
  .append('g')
  .attr('class', 'axis')
  .attr('transform', `translate(0,${lh - lm.bottom})`)
  .call(d3.axisBottom(x).tickFormat(d3.format('d')));
const yAxisG = lsvg.append('g').attr('class', 'axis').attr('transform', `translate(${lm.left},0)`);
lsvg
  .append('text')
  .attr('class', 'axis-title')
  .attr('transform', `translate(14,${(lh - lm.bottom + lm.top) / 2}) rotate(-90)`)
  .attr('text-anchor', 'middle')
  .text('Warming vs 1850–1900 (°C)');

const refG = lsvg.append('g');
const refs = [
  { value: 1.5, label: '1.5°C Paris Agreement target' },
  { value: 2, label: '2°C Paris Agreement limit' },
];
const marker = lsvg.append('line').attr('class', 'marker');
const markerLabel = lsvg.append('text').attr('class', 'marker-label').attr('text-anchor', 'middle');
const seriesG = lsvg.append('g');
const labelsG = lsvg.append('g');
const line = d3
  .line()
  .x((d) => x(d.year))
  .y((d) => y(d.value));

function updateLine() {
  const series = [
    ...scenarios.map((s) => ({ id: `global-${s}`, scenario: s, kind: 'global', points: globalSeries[s] })),
    ...scenarios.map((s) => ({ id: `region-${s}`, scenario: s, kind: 'region', points: regionSeries(s, selected) })),
  ];
  const all = series.flatMap((d) => d.points.map((p) => p.value));
  y.domain([Math.min(-0.5, d3.min(all)), Math.max(2.5, d3.max(all))]).nice();

  refG
    .selectAll('g.ref')
    .data(refs)
    .join((enter) => {
      const g = enter.append('g').attr('class', 'ref');
      g.append('line');
      g.append('text');
      return g;
    })
    .call((g) =>
      g
        .select('line')
        .attr('x1', lm.left)
        .attr('x2', lw - lm.right)
        .transition()
        .duration(400)
        .attr('y1', (d) => y(d.value))
        .attr('y2', (d) => y(d.value)),
    )
    .call((g) =>
      g
        .select('text')
        .attr('x', lm.left + 6)
        .attr('dy', '-0.35em')
        .text((d) => d.label)
        .transition()
        .duration(400)
        .attr('y', (d) => y(d.value)),
    );

  yAxisG
    .transition()
    .duration(400)
    .call(
      d3
        .axisLeft(y)
        .ticks(6)
        .tickFormat((d) => `${d > 0 ? '+' : ''}${d}°`),
    );
  gridG
    .transition()
    .duration(400)
    .call(
      d3
        .axisLeft(y)
        .ticks(6)
        .tickFormat('')
        .tickSize(-(lw - lm.left - lm.right)),
    );

  seriesG
    .selectAll('path')
    .data(series, (d) => d.id)
    .join('path')
    .attr('class', (d) => `series ${d.kind}`)
    .attr('stroke', (d) => scenarioColors[d.scenario])
    .classed('faded', (d) => d.scenario !== scenario)
    .transition()
    .duration(400)
    .attr('d', (d) => line(d.points));

  const labels = series.map((d) => {
    const last = d.points[d.points.length - 1];
    return {
      id: d.id,
      scenario: d.scenario,
      kind: d.kind,
      y: y(last.value),
      text: `${d.kind === 'region' ? shortName(regionName) : 'World'}, ${fmt(last.value)}`,
    };
  });
  labels.sort((a, b) => a.y - b.y);
  for (let k = 1; k < labels.length; k++) {
    labels[k].y = Math.max(labels[k].y, labels[k - 1].y + 15);
  }

  labelsG
    .selectAll('text')
    .data(labels, (d) => d.id)
    .join('text')
    .attr('class', (d) => `end-label ${d.kind}`)
    .classed('faded', (d) => d.scenario !== scenario)
    .attr('x', x(2095) + 8)
    .attr('dy', '0.35em')
    .text((d) => d.text)
    .transition()
    .duration(400)
    .attr('y', (d) => d.y);

  d3.select('#line-title').text(`${regionName} vs the world average, 1850–2100`);
  updateMarker();
}

function updateMarker() {
  const mx = x(decade + 5);
  marker
    .attr('x1', mx)
    .attr('x2', mx)
    .attr('y1', lm.top)
    .attr('y2', lh - lm.bottom);
  markerLabel
    .attr('x', mx)
    .attr('y', lm.top - 6)
    .text(`${decade}s`);
}

function updateReadout() {
  const j = decadeIndex.get(decade);
  const region = regionSeries(scenario, selected)[j].value;
  const globe = globalSeries[scenario][j].value;
  const ratio =
    globe > 0.5 ? `, about <strong>${(region / globe).toFixed(1)}×</strong> the world average` : '';
  d3.select('#readout').html(
    `<strong>${regionName}</strong> in the ${decade}s under ${scenarioNames[scenario]}: <strong>${fmt(region)}</strong>, compared to ${fmt(globe)} for the whole world${ratio}.`,
  );
}

function updateAll() {
  d3.select('#decade-label').text(`${decade}s`);
  d3.selectAll('.toggle button').classed('active', function () {
    return this.dataset.scenario === scenario;
  });
  updateMap();
  updateLine();
  updateReadout();
}

d3.selectAll('.toggle button').on('click', function () {
  scenario = this.dataset.scenario;
  updateAll();
});

d3.select('#decade').on('input', function () {
  decade = +this.value;
  d3.select('#decade-label').text(`${decade}s`);
  updateMap();
  updateMarker();
  updateReadout();
});

selectPreset(presets[0]);
updateAll();