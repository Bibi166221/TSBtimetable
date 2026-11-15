'use strict';

// TSB's route <select> is the source of truth for route identifiers. In particular,
// the X suffix is not always duplicated inside parentheses (e.g. 1-56(517X)).
function decodeEntities(input) {
  return String(input || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    const lower = entity.toLowerCase();
    if (lower in named) return named[lower];
    const num = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    return Number.isSafeInteger(num) && num >= 0 && num <= 0x10ffff
      ? String.fromCodePoint(num)
      : match;
  });
}

function attribute(tag, name) {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = tag.match(re);
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3] ?? '') : '';
}

function parseCatalog(html) {
  const routes = new Map();
  for (const match of String(html || '').matchAll(/<option\b[^>]*>/gi)) {
    const tag = match[0];
    const value = attribute(tag, 'value').trim();
    if (!value || value.length > 60 || !/^[\p{L}\p{M}\p{N}\s()._\-/]+$/u.test(value)) continue;
    routes.set(value.toUpperCase(), {
      route: value,
      start: attribute(tag, 'data-start').trim(),
      destination: attribute(tag, 'data-destination').trim()
    });
  }
  return routes;
}

// Only a trailing X (before the parentheses or at the end of their code) is a
// supplementary suffix. This supports 34X, 4-8X(35X), 1-56(517X), and 4-29EX(529EX).
function baseOfX(value) {
  const match = String(value || '').trim().match(/^([^()]+?)(?:\(([^()]+)\))?$/);
  if (!match) return null;
  let [, prefix, number] = match;
  const xPrefix = /X$/i.test(prefix);
  const xNumber = number != null && /X$/i.test(number);
  if (!xPrefix && !xNumber) return null;
  if (xPrefix) prefix = prefix.slice(0, -1);
  if (xNumber) number = number.slice(0, -1);
  if (!prefix || (number != null && !number)) return null;
  return number == null ? prefix : `${prefix}(${number})`;
}

// Official public-facing numbers can differ from API route identifiers:
// 113 = 1-44(113), 113A = 1-44A(113A), 555 = S6(555), 555A = S6A(555A).
// Resolve aliases from the ACTUAL published route catalog, not fabricated IDs.
function publicRouteCode(value) {
  const route = String(value || '').trim();
  const match = route.match(/\(([^()]*)\)\s*$/);
  return (match ? match[1] : route).replace(/\s+/g, '').toUpperCase();
}
function findPublishedByNumber(catalog, number) {
  if (!(catalog instanceof Map)) return null;
  const exact = catalog.get(number.toUpperCase());
  if (exact) return exact;
  const matches = [...catalog.values()].filter(entry => publicRouteCode(entry.route) === number.toUpperCase());
  return matches.length === 1 ? matches[0] : null;
}

function discoverFamily(route, catalog) {
  const value = String(route || '').trim();
  const byName = catalog instanceof Map ? catalog : new Map();
  const chosen = byName.get(value.toUpperCase()) ||
    (/^(?:113A?|555A?|517X?)$/i.test(value) ? findPublishedByNumber(byName, value.toUpperCase()) : null);
  const selected = chosen?.route || value;
  const code = publicRouteCode(selected);

  // 517 and 517X have different service patterns and MUST show independently.
  // This intentionally overrides the generic X suffix rule for 1-56(517X).
  if (code === '517' || code === '517X') {
    return {
      primary: selected, supplementaryRoutes: [], variantRoutes: [],
      standaloneX: code === '517X', catalogMatched: !!chosen
    };
  }

  // The two A-service groups are distinct from each other. Their departures
  // share a board only at a verified common departure station.
  const groupBase = ({ '113': '113', '113A': '113', '555': '555', '555A': '555' })[code];
  if (groupBase) {
    const base = findPublishedByNumber(byName, groupBase);
    const variant = findPublishedByNumber(byName, `${groupBase}A`);
    const main = base?.route || selected;
    return {
      primary: main,
      supplementaryRoutes: [],
      variantRoutes: base && variant && base.route !== variant.route ? [variant.route] : [],
      standaloneX: false,
      catalogMatched: !!chosen
    };
  }

  const possibleBase = baseOfX(selected);
  const knownBase = possibleBase && byName.get(possibleBase.toUpperCase());
  const main = knownBase?.route || selected;
  const supplementaryRoutes = [];

  // The catalog is authoritative; routes that look like X lines but have no
  // published base (e.g. 4-25X) remain standalone.
  if (knownBase || !possibleBase) {
    for (const entry of byName.values()) {
      if (baseOfX(entry.route)?.toUpperCase() === main.toUpperCase() &&
        publicRouteCode(entry.route) !== '517X') {
        supplementaryRoutes.push(entry.route);
      }
    }
  }
  return {
    primary: main,
    supplementaryRoutes: supplementaryRoutes.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    variantRoutes: [],
    standaloneX: !!possibleBase && !knownBase,
    catalogMatched: byName.has(selected.toUpperCase())
  };
}

// Pair genuinely published clockwise/counterclockwise L and R services.
// Both sides must exist in the official route catalog; a same-number X route
// is NEVER used as a stand-in for a missing side.
function circularSignature(name) {
  const parts = String(name || '').trim().match(/^([^()]+?)(?:\(([^()]*)\))?$/u);
  if (!parts) return null;
  let [, prefix, number] = parts;
  prefix = prefix.trim();
  if (number != null) number = number.trim();
  const prefixSide = prefix.match(/([LR])$/i)?.[1]?.toUpperCase() || null;
  const numberSide = number?.match(/([LR])$/i)?.[1]?.toUpperCase() || null;
  if (!prefixSide && !numberSide) return null;
  if (prefixSide && numberSide && prefixSide !== numberSide) return null;
  const side = prefixSide || numberSide;
  if (prefixSide) prefix = prefix.slice(0, -1);
  if (numberSide) number = number.slice(0, -1);
  prefix = prefix.trim();
  if (!prefix || (number != null && !number)) return null;
  const stem = number == null ? prefix : `${prefix}(${number})`;
  return { side, stem: stem.replace(/\s+/g, '').toUpperCase() };
}

function discoverCircularPair(requestedRoute, catalog) {
  if (!(catalog instanceof Map)) return null;
  const requested = String(requestedRoute || '').trim();
  const chosen = catalog.get(requested.toUpperCase()) ||
    (/[LR]$/i.test(requested) ? findPublishedByNumber(catalog, requested.toUpperCase()) : null);
  if (!chosen) return null;
  const signature = circularSignature(chosen.route);
  if (!signature) return null;
  const matches = [...catalog.values()].filter(entry => {
    const candidate = circularSignature(entry.route);
    return candidate?.stem === signature.stem;
  });
  const left = matches.filter(entry => circularSignature(entry.route)?.side === 'L');
  const right = matches.filter(entry => circularSignature(entry.route)?.side === 'R');
  // Ambiguous labels or missing side: do NOT fabricate paired schedules.
  if (left.length !== 1 || right.length !== 1) return null;
  return {
    left: left[0].route,
    right: right[0].route,
    publicLeft: publicRouteCode(left[0].route),
    publicRight: publicRouteCode(right[0].route)
  };
}

// Route 34 family has one non-X short working: 1-3 (34/34เสริม).
// Match only the 1-3 route in the published route picker; 1-2E(34E) is distinct.
function is34Bangkhen(value) {
  return /^1-3(?:\s*\(\s*34(?:เสริม)?\s*\))?$/iu.test(String(value || '').trim());
}

function find34Bangkhen(catalog) {
  if (!(catalog instanceof Map)) return null;
  const candidates = [...catalog.values()].filter(entry => is34Bangkhen(entry.route));
  // Prefer the user's exact 1-3(34) form when multiple options are published.
  const rank = name => {
    const compact = name.replace(/\s+/g, '');
    return /^1-3\(34\)$/i.test(compact) ? 0 : /34เสริม/.test(compact) ? 1 : 2;
  };
  return candidates.sort((a, b) => rank(a.route) - rank(b.route))[0]?.route || null;
}

function is34Family(route) {
  const value = String(route || '').trim();
  return /^34x?$/i.test(value) || is34Bangkhen(value);
}

function resolvePublishedRoute(input, catalog) {
  const requested = String(input || '').trim();
  const key = requested.toUpperCase();

  if (!(catalog instanceof Map)) {
    return { route: requested };
  }

  // Exact API route ID has first priority.
  const exact = catalog.get(key);
  if (exact) {
    return { route: exact.route };
  }

  // Search using familiar numbers: 84, 113, 555, etc.
  const matches = [...catalog.values()].filter(
    entry => publicRouteCode(entry.route) === key
  );

  if (matches.length === 1) {
    return { route: matches[0].route };
  }

  if (matches.length > 1) {
    return {
      route: requested,
      ambiguous: matches.map(entry => entry.route)
    };
  }

  return { route: requested };
}

// New function
function resolvePublishedRoute(input, catalog) {
  const requested = String(input || '').trim();
  const key = requested.toUpperCase();

  if (!(catalog instanceof Map)) {
    return { route: requested };
  }

  const exact = catalog.get(key);
  if (exact) {
    return { route: exact.route };
  }

  const matches = [...catalog.values()].filter(
    entry => publicRouteCode(entry.route) === key
  );

  if (matches.length === 1) {
    return { route: matches[0].route };
  }

  if (matches.length > 1) {
    return {
      route: requested,
      ambiguous: matches.map(entry => entry.route)
    };
  }

  return { route: requested };
}

module.exports = {
  decodeEntities,
  parseCatalog,
  baseOfX,
  publicRouteCode,
  findPublishedByNumber,
  resolvePublishedRoute,
  discoverFamily,
  circularSignature,
  discoverCircularPair,
  is34Bangkhen,
  find34Bangkhen,
  is34Family
};
