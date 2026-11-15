'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { getRouteData, getRouteMeta, getRouteCatalog } = require('./getSchedulePlan');
const { directionFromResponse, mergeDirections, markBangkhen, markAVariant, correctPublishedTerminus, buildCircularBoards } = require('./timetableLogic');
const { discoverFamily, discoverCircularPair, circularSignature, baseOfX, publicRouteCode, resolvePublishedRoute, find34Bangkhen, is34Family } = require('./routeCatalog');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const CACHE_MS = 30_000;
const CATALOG_MS = 15 * 60_000;
const cache = new Map();
let catalogCache = null;
let catalogAt = 0;
let catalogPromise = null;
const FILES = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/styles.css': 'styles.css',
  '/app.js': 'app.js',
  '/serviceDay.js': 'serviceDay.js',
  '/exportImage.js': 'exportImage.js'
};
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8'
};

function sendJson(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(value));
}

function validateRoute(route) {
  return !!route && route.length <= 60 && /^[\p{L}\p{M}\p{N}\s()._\-/]+$/u.test(route);
}

async function loadCatalog() {
  if (catalogCache && Date.now() - catalogAt < CATALOG_MS) return catalogCache;
  if (catalogPromise) return catalogPromise;
  catalogPromise = getRouteCatalog().then(catalog => {
    catalogCache = catalog;
    catalogAt = Date.now();
    return catalog;
  }).catch(err => {
    console.warn('TSB route list unavailable:', err.message);
    // A previously fetched catalog is better than guessing nonexistent X lines.
    return catalogCache;
  }).finally(() => { catalogPromise = null; });
  return catalogPromise;
}

async function fetchLine(routeName, meta, supplementary = false) {
  // The route picker exposes the same data-start/data-destination values used
  // by getRouteMeta. Read them from the cached catalog when available.
  const [result, resolvedMeta] = await Promise.all([
    getRouteData(routeName),
    meta?.start && meta?.destination
      ? Promise.resolve(meta)
      : getRouteMeta(routeName).catch(err => {
          console.warn('Route name metadata unavailable for', routeName, err.message);
          return { start: '-', destination: '-' };
        })
  ]);
  return {
    fetchedAt: new Date().toISOString(),
    sourceUpdatedDate: result.updated_date ?? null,
    ...correctPublishedTerminus(routeName, directionFromResponse(result.data, resolvedMeta, routeName, supplementary))
  };
}

async function handleRoutes(res) {
  const catalog = await loadCatalog();
  if (!catalog) {
    sendJson(res, 503, { error: 'TSB route list is temporarily unavailable' });
    return;
  }
  const routes = [...catalog.values()].map(entry => {
    const pair = discoverCircularPair(entry.route, catalog);
    return {
      ...entry,
      publicNumber: publicRouteCode(entry.route),
      supplementary: !!baseOfX(entry.route),
      baseRoute: baseOfX(entry.route),
      circularSide: pair ? circularSignature(entry.route)?.side : null,
      pairedRoute: pair ? (circularSignature(entry.route)?.side === 'L' ? pair.right : pair.left) : null
    };
  });
  sendJson(res, 200, { routes, count: routes.length });
}

async function handleSchedule(res, requestedRoute) {
  const route = requestedRoute.trim();
  if (!validateRoute(route)) {
    sendJson(res, 400, { error: 'Invalid route name' });
    return;
  }
  const cached = cache.get(route);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    sendJson(res, 200, { ...cached.payload, cached: true });
    return;
  }

  try {
    const catalog = await loadCatalog();
    const resolution = resolvePublishedRoute(route, catalog);
    if (resolution.ambiguous) {
      sendJson(res, 409, {
        error: `Route ${route} matches multiple TSB routes. Please choose the full route ID.`,
        candidates: resolution.ambiguous
      });
      return;
    }
    if (!catalog && /^[0-9]+[A-Z]*$/i.test(route)) {
      sendJson(res, 503, { error: 'The TSB route list is unavailable. Try again later or enter a full route ID.' });
      return;
    }
    const selectedRoute = resolution.route;
    const circular = discoverCircularPair(selectedRoute, catalog);
    if (circular) {
      // Selecting either L or R gives the exact same two-column page.
      // Data for both services comes from their own get_route.php responses.
      const [leftLine, rightLine] = await Promise.all([
        fetchLine(circular.left, catalog.get(circular.left.toUpperCase())),
        fetchLine(circular.right, catalog.get(circular.right.toUpperCase()))
      ]);
      const panels = buildCircularBoards(circular.left, leftLine, circular.right, rightLine);
      const payload = {
        route: circular.left,
        requestedRoute: route,
        displayTitle: `${circular.publicLeft} / ${circular.publicRight}`,
        circularPair: circular,
        supplementaryRoute: null,
        supplementaryRoutes: [],
        relatedRoutes: [],
        variantRoutes: [],
        standaloneX: false,
        routeCatalogAvailable: true,
        fetchedAt: new Date().toISOString(),
        sourceUpdatedDate: leftLine.sourceUpdatedDate,
        routeNameSource: 'route-html',
        ...panels
      };
      cache.set(route, { at: Date.now(), payload });
      sendJson(res, 200, { ...payload, cached: false });
      return;
    }
    let family;
    if (catalog) {
      // The 34 / 34X / 1-3(34) service group is a deliberate exception to
      // suffix-based X matching: 1-3 has a different route ID but shares the
      // Hua Lamphong departure terminal with route 34.
      family = discoverFamily(is34Family(selectedRoute) && catalog.has('34') ? '34' : selectedRoute, catalog);
    } else {
      // A failed catalog request never authorizes made-up extra services.
      // The requested route itself remains available through get_route.php.
      family = {
        primary: selectedRoute,
        supplementaryRoutes: [],
        variantRoutes: [],
        standaloneX: !!baseOfX(selectedRoute),
        catalogMatched: false
      };
    }

    const mainMeta = catalog?.get(family.primary.toUpperCase());
    const mainPromise = fetchLine(family.primary, mainMeta, family.standaloneX);
    const supplementsPromise = Promise.all(family.supplementaryRoutes.map(async name => {
      try {
        const line = await fetchLine(name, catalog?.get(name.toUpperCase()), true);
        return { name, line };
      } catch (err) {
        console.warn('Available X route failed to load:', name, err.message);
        return null;
      }
    }));

    const variantsPromise = Promise.all((family.variantRoutes || []).map(async name => {
      try {
        const line = await fetchLine(name, catalog?.get(name.toUpperCase()), false);
        return { name, line: markAVariant(line, publicRouteCode(name)) };
      } catch (err) {
        console.warn('Published A route failed to load:', name, err.message);
        return null;
      }
    }));

    const bangkhenRoute = catalog && family.primary.toUpperCase() === '34'
      ? find34Bangkhen(catalog) : null;
    const bangkhenPromise = bangkhenRoute
      ? fetchLine(bangkhenRoute, catalog.get(bangkhenRoute.toUpperCase()), false)
          .then(line => ({ name: bangkhenRoute, line: markBangkhen(line) }))
          .catch(err => {
            console.warn('34 Bangkhen service failed to load:', bangkhenRoute, err.message);
            return null;
          })
      : Promise.resolve(null);

    const [mainSource, supplementResults, bangkhen, variantResults] = await Promise.all([
      mainPromise, supplementsPromise, bangkhenPromise, variantsPromise
    ]);
    const main = mainSource;
    const supplements = supplementResults.filter(Boolean);
    let merged = {
      go: { ...main.go, departures: [...main.go.departures] },
      back: { ...main.back, departures: [...main.back.departures] },
      extraPanels: []
    };
    for (const { name, line } of supplements) {
      merged = mergeDirections(merged, line, name);
    }
    const variants = variantResults.filter(Boolean);
    for (const { name, line } of variants) {
      merged = mergeDirections(merged, line, name);
    }
    // Merge route 1-3's Hua Lamphong departures into the shared board;
    // Bangkhen-origin departures remain a separate blue panel.
    if (bangkhen) merged = mergeDirections(merged, bangkhen.line, bangkhen.name);
    const supplementaryRoutes = supplements.map(x => x.name);
    const payload = {
      route: family.primary,
      requestedRoute: route,
      supplementaryRoute: supplementaryRoutes[0] || null,  // legacy frontend compatibility
      supplementaryRoutes,
      relatedRoutes: bangkhen ? [bangkhen.name] : [],
      variantRoutes: variants.map(x => x.name),
      standaloneX: family.standaloneX,
      routeCatalogAvailable: !!catalog,
      fetchedAt: new Date().toISOString(),
      sourceUpdatedDate: main.sourceUpdatedDate,
      routeNameSource: main.routeNameSource,
      go: merged.go,
      back: merged.back,
      extraPanels: merged.extraPanels
    };
    cache.set(route, { at: Date.now(), payload });
    sendJson(res, 200, { ...payload, cached: false });
  } catch (err) {
    console.error('TSB timetable failed:', err.message);
    sendJson(res, 502, { error: 'Could not load timetable from Thai Smile Bus', detail: err.message });
  }
}

const server = http.createServer(async (req, res) => {
  // The static GitHub Pages frontend needs permission to read this JSON API.
  // Do not allow arbitrary origins.
  res.setHeader('Access-Control-Allow-Origin', 'https://bibi166221.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch { sendJson(res, 400, { error: 'Invalid URL' }); return; }
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (url.pathname === '/api/schedule') {
    return handleSchedule(res, url.searchParams.get('route') || '1-4(39)');
  }
  if (url.pathname === '/api/routes') {
    return handleRoutes(res);
  }
  const file = FILES[url.pathname];
  if (!file) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  try {
    const content = await fs.readFile(path.join(PUBLIC, file));
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)],
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(content);
  } catch { sendJson(res, 500, { error: 'Could not load website' }); }
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Timetable website (this computer): http://localhost:${PORT}`);
    const addresses = Object.values(os.networkInterfaces()).flat()
      .filter(item => item && item.family === 'IPv4' && !item.internal)
      .map(item => item.address);
    for (const address of [...new Set(addresses)]) {
      console.log(`Phone / iPad (same Wi-Fi): http://${address}:${PORT}`);
    }
    console.log('Use your computer’s Wi-Fi/LAN address. Allow Node.js through Windows Firewall on private networks only.');
  });
}
module.exports = { server, handleSchedule, handleRoutes };
