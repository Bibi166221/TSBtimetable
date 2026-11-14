/*
 * Time presentation only. This module never infers which *calendar date* a
 * departure belongs to. A TSB timetable can be manually refreshed, and an
 * HH:mm value by itself is not a trustworthy departure timestamp.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TSBServiceDay = api;
})(typeof window === 'object' ? window : null, function () {
  'use strict';
  function parseTime(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const text = String(value).trim();
    const match = text.match(/(?:^|\s)(\d{1,2})[:.](\d{2})(?::\d{2})?(?=\s|$|[^\d])/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 29 || minute > 59) return null;
    return { hour, minute };
  }

  function asMinutes(t) { return t.hour * 60 + t.minute; }

  // Each published route/direction has its OWN operating-day starting point.
  // A time earlier than first_bus is displayed in the next-day block, even
  // when it is 03:00. Do not use the opposite direction's first departure.
  function serviceStart(item, departures) {
    const first = parseTime(item?.firstBus);
    if (!first || first.hour >= 24) return null;
    const matches = departures.some(t => t.route === item.route && t.parsed &&
      asMinutes(t.parsed) === asMinutes(first));
    // Some TSB responses publish first_bus with a different formatting or
    // don't include that trip in the current timetable snapshot. Treat such
    // metadata as useful when it is within the actual displayed service span.
    const sameRoute = departures.filter(t => t.route === item.route && t.parsed);
    if (!matches && !sameRoute.length) return null;
    return asMinutes(first);
  }

  function overnightBounds(bounds, departures) {
    const values = (Array.isArray(departures) ? departures : [])
      .map(x => typeof x === 'string' ? ({time:x, route:null}) : x)
      .filter(Boolean)
      .map(x => ({ ...x, parsed: parseTime(x.time) }))
      .filter(x => x.parsed);
    if (!values.length) return null;
    const starts = new Map();
    const boundList = Array.isArray(bounds) ? bounds : [];
    for (const item of boundList) {
      if (!item?.route) continue;
      const first = serviceStart(item, values);
      if (first !== null) starts.set(item.route, first);
    }
    // A single unnamed timetable is allowed when its bounds name a route.
    if (!starts.size && boundList.length === 1) {
      const first = parseTime(boundList[0].firstBus);
      if (first) starts.set(boundList[0].route ?? '', asMinutes(first));
    }
    const startCandidates = [...starts.values()];
    if (!startCandidates.length) return null;
    const nextDayTrips = values.filter(entry => {
      const first = starts.get(entry.route) ?? (starts.size === 1 ? startCandidates[0] : null);
      return first !== null && asMinutes(entry.parsed) < first;
    });
    // The old convention for 00-only services is preserved. Other early
    // departures need a published first_bus before we move them past 24.
    if (!nextDayTrips.some(entry => entry.parsed.hour >= 1) ||
        !values.some(entry => entry.parsed.hour >= 12 && entry.parsed.hour <= 23)) return null;
    const startHour = Math.min(...startCandidates.map(m => Math.floor(m / 60)));
    return { startHour, source: 'first_bus-per-route', starts };
  }

  function displayHour(hour, overnight, item = null) {
    if (overnight) {
      const ownStart = item && overnight.starts?.get(item.route);
      const first = ownStart ?? (overnight.starts?.size === 1
        ? [...overnight.starts.values()][0]
        : overnight.startHour * 60);
      const minute = item?.parsed?.minute || 0;
      return (hour * 60 + minute < first) ? hour + 24 : hour;
    }
    // Default ordinary display keeps 00 at the bottom.
    return hour === 0 ? 24 : hour;
  }

  function orderEntries(values, overnight) {
    return (Array.isArray(values) ? values : [])
      .map(item => typeof item === 'string' ? ({ time: item, supplementary: false }) : item)
      .filter(item => item && typeof item.time === 'string')
      .map(item => ({ ...item, parsed: parseTime(item.time) }))
      .filter(item => item.parsed)
      .map(item => ({ ...item, serviceHour: displayHour(item.parsed.hour, overnight, item) }))
      .sort((a, b) => a.serviceHour - b.serviceHour || a.parsed.minute - b.parsed.minute || Number(a.supplementary) - Number(b.supplementary));
  }

  function hourLabel(serviceHour, overnight) {
    // On confirmed overnight service days, retain 24/25/26 as the primary
    // hour. The corresponding civil-clock hour is added underneath in the UI.
    return String(overnight ? serviceHour : serviceHour % 24).padStart(2, '0');
  }

  function clockHourLabel(serviceHour) {
    return String(serviceHour % 24).padStart(2, '0');
  }

  function isNextDayHour(serviceHour, overnight) {
    return Boolean(overnight && serviceHour >= 24);
  }

  return { parseTime, overnightBounds, displayHour, orderEntries, hourLabel, clockHourLabel, isNextDayHour };
});
