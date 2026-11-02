import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import * as topojson from 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm';

const width = 960;
const height = 480;

const [rows, world] = await Promise.all([
  d3.csv('data/grid_decadal.csv', d3.autoType),
  d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json'),
]);

const lookup = d3.group(rows, (d) => d.scenario, (d) => d.decade);

let scenario = 'ssp585';
let decade = 2090;

const projection = d3.geoEquirectangular().fitSize([width, height], { type: 'Sphere' });
const path = d3.geoPath(projection);

const color = d3.scaleDiverging([-4, 0, 12], (t) => d3.interpolateRdBu(1 - t)).clamp(true);

const svg = d3.select('#map').append('svg').attr('viewBox', [0, 0, width, height]);

function cellShape(d) {
  const lon = d.lon > 180 ? d.lon - 360 : d.lon;
  const w = lon - 2.5;
  const e = lon + 2.5;
  const s = Math.max(d.lat - 2.5, -90);
  const n = Math.min(d.lat + 2.5, 90);
  return {
    type: 'Polygon',
    coordinates: [[[w, s], [w, n], [e, n], [e, s], [w, s]]],
  };
}

const tooltip = d3.select('#tooltip');

function formatLat(lat) {
  return `${Math.abs(lat)}°${lat >= 0 ? 'N' : 'S'}`;
}

function formatLon(lon) {
  const l = lon > 180 ? lon - 360 : lon;
  return `${Math.abs(l)}°${l >= 0 ? 'E' : 'W'}`;
}

const cells = svg
  .append('g')
  .selectAll('path')
  .data(lookup.get(scenario).get(decade), (d) => `${d.lat},${d.lon}`)
  .join('path')
  .attr('class', 'cell')
  .attr('d', (d) => path(cellShape(d)))
  .on('mousemove', (event, d) => {
    const current = lookup.get(scenario).get(decade).find((c) => c.lat === d.lat && c.lon === d.lon);
    tooltip
      .attr('hidden', null)
      .style('left', `${event.clientX + 14}px`)
      .style('top', `${event.clientY + 14}px`)
      .html(`<strong>${current.anomaly > 0 ? '+' : ''}${current.anomaly.toFixed(1)}°C</strong><br>${formatLat(d.lat)}, ${formatLon(d.lon)}<br>${decade}s`);
  })
  .on('mouseleave', () => tooltip.attr('hidden', true));

svg
  .append('path')
  .datum(topojson.feature(world, world.objects.land))
  .attr('class', 'land')
  .attr('d', path);

function update() {
  const byCell = new Map(lookup.get(scenario).get(decade).map((d) => [`${d.lat},${d.lon}`, d.anomaly]));
  cells.transition().duration(300).attr('fill', (d) => color(byCell.get(`${d.lat},${d.lon}`)));
  d3.select('#decade-label').text(`${decade}s`);
  d3.selectAll('.toggle button').classed('active', function () {
    return this.dataset.scenario === scenario;
  });
}

d3.selectAll('.toggle button').on('click', function () {
  scenario = this.dataset.scenario;
  update();
});

d3.select('#decade').on('input', function () {
  decade = +this.value;
  update();
});

function drawLegend() {
  const w = 360;
  const legend = d3.select('#legend').append('svg').attr('width', w + 40).attr('height', 50);
  const defs = legend.append('defs').append('linearGradient').attr('id', 'grad');
  d3.range(0, 1.01, 0.05).forEach((t) => {
    defs.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', color(-4 + t * 16));
  });
  legend.append('rect').attr('x', 20).attr('y', 8).attr('width', w).attr('height', 12).attr('fill', 'url(#grad)');
  const x = d3.scaleLinear([-4, 12], [20, w + 20]);
  legend
    .append('g')
    .attr('transform', 'translate(0,20)')
    .call(d3.axisBottom(x).tickValues([-4, 0, 4, 8, 12]).tickFormat((d) => `${d > 0 ? '+' : ''}${d}°C`).tickSize(4))
    .call((g) => g.select('.domain').remove());
}

drawLegend();
update();
