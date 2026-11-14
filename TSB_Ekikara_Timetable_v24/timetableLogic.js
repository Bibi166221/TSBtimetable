'use strict';

// A full-route code such as 4-8(35) can have an X supplementary route,
// conventionally named 4-8X(35X). Never assume it exists before fetching it.
function routePair(route) {
  const value = String(route || '').trim();
  const { baseOfX } = require('./routeCatalog');
  const base = baseOfX(value);
  if (base) return { primary: base, supplementary: value };
  const match = value.match(/^([^()]+)\(([^()]+)\)$/);
  if (!match) return { primary: value, supplementary: `${value}X` };
  return { primary: value, supplementary: `${match[1]}X(${match[2]}X)` };
}

function cleanName(name) {
  return typeof name === 'string' && name.trim() && name.trim() !== '-'
    ? name.trim().replace(/\s+/g, ' ')
    : null;
}

function sameStation(a, b) {
  const normalize = (s) => {
    const value = (cleanName(s) || '').toLocaleLowerCase('th-TH').replace(/[\s\u200b\-–—()（）]+/g, '');
    // Official route-option captions may add a station qualifier to Hua Lamphong.
    // Normalize this unambiguous common station only; do not merge arbitrary stops.
    if (value.includes('หัวลำโพง')) return 'หัวลำโพง';
    return value;
  };
  return !!normalize(a) && normalize(a) === normalize(b);
}

function simplifyDirection(section, start, destination, routeName, supplementary) {
  const info = section?.info || {};
  const stops = Array.isArray(section?.stops) ? section.stops : [];
  const timetable = Array.isArray(section?.timetable) ? section.timetable : [];
  const origin = cleanName(start) ?? cleanName(info.first_station) ?? cleanName(stops[0]?.name);
  const end = cleanName(destination) ?? cleanName(info.last_station) ?? cleanName(stops.at(-1)?.name);
  // Timetable.time represents the published departure time at this line's first
  // station. Keep this source field separate from the route-picker endpoint:
  // an A/X/short service can have a distinct first stop or terminal.
  const firstStopFromInfo = cleanName(info.first_station);
  const firstStopFromStops = cleanName(stops[0]?.name);
  const firstStop = firstStopFromInfo || firstStopFromStops || null;
  const firstStopSource = firstStopFromInfo ? 'info.first_station' :
    firstStopFromStops ? 'stops[0].name' : null;
  return {
    route: routeName,
    origin,
    destination: end,
    firstStop,
    firstStopSource,
    // These are source-defined first/last departures, not calendar timestamps.
    serviceBounds: [{ route: routeName, firstBus: info.first_bus ?? null, lastBus: info.last_bus ?? null }],
    departures: timetable.map(t => ({
      time: typeof t.time === 'string' ? t.time.trim() : '',
      supplementary: !!supplementary,
      route: routeName,
      origin,
      destination: end,
      firstStop,
      firstStopSource
    })).filter(d => d.time)
  };
}

function directionFromResponse(rawData, meta, routeName, supplementary) {
  const start = cleanName(meta?.start);
  const destination = cleanName(meta?.destination);
  return {
    go: simplifyDirection(rawData?.go, start, destination, routeName, supplementary),
    back: simplifyDirection(rawData?.back, destination, start, routeName, supplementary),
    routeNameSource: start && destination ? 'route-html' : 'route-data-fallback'
  };
}

function mergeDirections(main, supplement, supplementaryName) {
  const result = {
    go: { ...main.go, serviceBounds: [...(main.go.serviceBounds || [])], departures: [...main.go.departures] },
    back: { ...main.back, serviceBounds: [...(main.back.serviceBounds || [])], departures: [...main.back.departures] },
    extraPanels: Array.isArray(main.extraPanels) ? [...main.extraPanels] : [],
    supplementaryName: supplement ? supplementaryName : null
  };
  if (!supplement) return result;

  // The timetable displays departures FROM a station. Supplementary services
  // are merged only when their actual departure origin matches the panel's
  // origin; a short-turn starting elsewhere needs its own timetable.
  for (const key of ['go', 'back']) {
    const dir = supplement[key];
    if (!dir || !dir.departures.length) continue;
    if (sameStation(dir.origin, result.go.origin)) {
      result.go.departures.push(...dir.departures);
      result.go.serviceBounds.push(...(dir.serviceBounds || []));
    } else if (sameStation(dir.origin, result.back.origin)) {
      result.back.departures.push(...dir.departures);
      result.back.serviceBounds.push(...(dir.serviceBounds || []));
    } else {
      // Unknown origin must not be misrepresented as the main line origin.
      result.extraPanels.push({
        id: `x-${key}`,
        direction: key,
        origin: dir.origin,
        destination: dir.destination,
        serviceBounds: [...(dir.serviceBounds || [])],
        departures: [...dir.departures]
      });
    }
  }
  return result;
}

// Marks route 1-3(34 / 34เสริม) departures as a distinct blue short-service
// variant. It is *not* an X trip and must never get the red เสริม marker.
function markBangkhen(line) {
  return {
    go: { ...line.go, departures: line.go.departures.map(d => ({
      ...d, supplementary: false, serviceType: 'bangkhen', displayLabel: 'บางเขน'
    })) },
    back: { ...line.back, departures: line.back.departures.map(d => ({
      ...d, supplementary: false, serviceType: 'bangkhen', displayLabel: 'บางเขน'
    })) }
  };
}

// A-route services share their main route's origin but may terminate at a
// different station. A blue, explicit line label avoids passenger confusion.
function markAVariant(line, publicNumber) {
  const label = String(publicNumber || '').toUpperCase();
  const mark = direction => ({
    ...direction,
    departures: direction.departures.map(d => ({
      ...d, supplementary: false, serviceType: 'a-variant', displayLabel: label
    }))
  });
  return { ...line, go: mark(line.go), back: mark(line.back) };
}

// The official route picker currently advertises 529EX with the wrong terminal.
// Passenger-facing correction requested for 529EX ONLY. Do not change 529E.
function correctPublishedTerminus(routeName, line) {
  const code = String(routeName || '').match(/\(([^()]*)\)\s*$/)?.[1]?.toUpperCase();
  if (code !== '529EX') return line;
  const terminus = 'สุทธิสาร';
  const go = {
    ...line.go,
    destination: terminus,
    departures: line.go.departures.map(d => ({ ...d, destination: terminus }))
  };
  const back = {
    ...line.back,
    origin: terminus,
    departures: line.back.departures.map(d => ({ ...d, origin: terminus }))
  };
  return { ...line, go, back, endpointCorrection: '529EX → สุทธิสาร (manual override)' };
}

// L/R services are distinct published route IDs (e.g. 4-25L(147L) and
// 4-25R(147R)), not the go/back halves of one route.
// Put their main departure lists in the left and right columns respectively.
// When a route also has a second, different API direction, preserve its trips
// in an extra panel: never silently drop them or label them as leaving the
// main panel's first stop.
function circularDirectionForBoard(line, routeName, side) {
  const go = line.go || {};
  const back = line.back || {};
  const goHasTrips = (go.departures || []).length > 0;
  const backHasTrips = (back.departures || []).length > 0;
  const useGo = goHasTrips || !backHasTrips;
  const primary = useGo ? go : back;
  const alternate = useGo ? back : go;
  const alternateKey = useGo ? 'back' : 'go';
  const display = {
    ...primary,
    route: routeName,
    circularSide: side,
    departures: [...(primary.departures || [])],
    serviceBounds: [...(primary.serviceBounds || [])]
  };
  const extraPanels = [];
  if ((alternate.departures || []).length) {
    extraPanels.push({
      ...alternate,
      id: `lr-${side.toLowerCase()}-${alternateKey}`,
      route: routeName,
      circularSide: side,
      panelTitle: `สาย ${side} · ${alternateKey === 'back' ? 'ขากลับ' : 'ขาไป'} · ${routeName}`,
      departures: [...alternate.departures],
      serviceBounds: [...(alternate.serviceBounds || [])]
    });
  }
  return { display, extraPanels };
}

function buildCircularBoards(leftName, leftLine, rightName, rightLine) {
  const left = circularDirectionForBoard(leftLine, leftName, 'L');
  const right = circularDirectionForBoard(rightLine, rightName, 'R');
  return {
    go: left.display,
    back: right.display,
    extraPanels: [...left.extraPanels, ...right.extraPanels]
  };
}

module.exports = { routePair, cleanName, sameStation, simplifyDirection, directionFromResponse, mergeDirections, markBangkhen, markAVariant, correctPublishedTerminus, circularDirectionForBoard, buildCircularBoards };
