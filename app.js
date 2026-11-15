'use strict';

const $ = (id) => document.getElementById(id);
let route = '1-4(39)';
let loading = false;
let requestToken = 0;
const isPreview = location.protocol === 'file:' || ['5500', '5501'].includes(location.port) || /\/public\/?(?:index\.html)?$/.test(location.pathname) || new URLSearchParams(location.search).has('demo');

// Static design-preview times: intentionally NOT a substitute for the API.
const PREVIEW_BACK = ['05:12', '05:33', '05:51', '06:00', '06:07', '06:15', '06:28', '06:39', '06:48', '06:56', '07:04', '07:14', '07:26', '07:36', '07:49', '07:58', '08:10', '08:21', '08:32', '08:41', '08:52', '09:04', '09:16', '09:26', '09:38', '09:50', '10:08', '10:22', '10:37', '10:49', '11:00', '11:12', '11:29', '11:44', '12:00', '12:18', '12:34', '12:50', '13:05', '13:21', '13:37', '13:52', '14:10', '14:30', '14:48', '15:02', '15:18', '15:34', '15:51', '16:09', '16:28', '16:46', '17:05', '17:22', '17:41', '18:00', '18:22', '18:44', '19:02', '19:24', '19:51', '20:12', '20:38', '21:04', '21:31', '22:00', '23:10', '00:08'];
const PREVIEW_GO = ['05:08', '05:29', '05:50', '06:03', '06:14', '06:25', '06:36', '06:47', '06:58', '07:05', '07:13', '07:23', '07:33', '07:43', '07:53', '08:00', '08:12', '08:24', '08:35', '08:46', '08:57', '09:06', '09:19', '09:33', '09:46', '10:00', '10:13', '10:27', '10:40', '10:54', '11:05', '11:19', '11:32', '11:45', '12:00', '12:14', '12:28', '12:42', '12:56', '13:09', '13:22', '13:35', '13:49', '14:04', '14:18', '14:32', '14:46', '15:01', '15:15', '15:29', '15:43', '15:57', '16:11', '16:25', '16:40', '16:54', '17:08', '17:22', '17:38', '17:54', '18:10', '18:26', '18:42', '18:58', '19:15', '19:32', '19:49', '20:12', '20:35', '20:58', '21:20', '21:43', '22:05', '23:15', '00:12'];

const ServiceDay = window.TSBServiceDay;

// Both main boards must have the same hour rows even when one side has no
// departures at that hour. Extra origin-specific boards remain independent.
function sharedHourWindow(left, right) {
  const sets = [left, right].map(direction => {
    const values = direction?.departures || direction?.times || [];
    const overnight = ServiceDay.overnightBounds(direction?.serviceBounds || [], values);
    const entries = ServiceDay.orderEntries(values, overnight);
    const hours = entries.map(entry => entry.serviceHour);
    if (overnight) hours.push(overnight.startHour);
    return { hours, overnight };
  });
  const all = sets.flatMap(x => x.hours);
  if (!all.length) return null;
  const first = Math.min(...all), last = Math.max(...all);
  return {
    hours: Array.from({ length: last - first + 1 }, (_, i) => first + i),
    // Use one display convention for the paired hour column.
    hourFormat: sets.find(x => x.overnight)?.overnight || null
  };
}

// Match the physical row heights as well as the hour labels. This handles
// wrapping from busy departures and small A/X destination labels on desktop.
function alignMainRowHeights() {
  const left = [...$('goBody').rows];
  const right = [...$('backBody').rows];
  const columnLeft = $('goPanel').querySelector('.column-head');
  const columnRight = $('backPanel').querySelector('.column-head');
  columnLeft.style.marginTop = '';
  columnRight.style.marginTop = '';
  for (const row of [...left, ...right]) row.style.height = '';
  // On phones and portrait tablets, panels stack and should size naturally.
  if (window.matchMedia('(max-width: 900px)').matches) return;
  // First align the top of the tables when different station names or
  // first-stop notes wrap onto a different number of lines.
  const aTop = columnLeft.getBoundingClientRect().top;
  const bTop = columnRight.getBoundingClientRect().top;
  if (aTop < bTop) columnLeft.style.marginTop = `${Math.ceil(bTop - aTop)}px`;
  else if (bTop < aTop) columnRight.style.marginTop = `${Math.ceil(aTop - bTop)}px`;
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i].dataset.serviceHour !== right[i].dataset.serviceHour) continue;
    const height = Math.ceil(Math.max(left[i].getBoundingClientRect().height, right[i].getBoundingClientRect().height));
    left[i].style.height = `${height}px`;
    right[i].style.height = `${height}px`;
  }
}
let alignScheduled = false;
function scheduleMainAlignment() {
  if (alignScheduled) return;
  alignScheduled = true;
  requestAnimationFrame(() => { alignScheduled = false; alignMainRowHeights(); });
}
window.addEventListener('resize', scheduleMainAlignment);

function renderTimes(tbody, values, serviceBounds = [], sharedHours = null, sharedOvernight = null) {
  tbody.replaceChildren();
  const overnight = ServiceDay.overnightBounds(serviceBounds, values);
  const entries = ServiceDay.orderEntries(values, overnight);
  if (!entries.length && !sharedHours) {
    const row = document.createElement('tr'), cell = document.createElement('td');
    cell.colSpan = 2;
    cell.className = 'empty';
    cell.textContent = 'ไม่มีข้อมูลเวลาเดินรถ';
    row.append(cell); tbody.append(row);
    return false;
  }
  const byHour = new Map();
  for (const entry of entries) {
    if (!byHour.has(entry.serviceHour)) byHour.set(entry.serviceHour, []);
    byHour.get(entry.serviceHour).push(entry);
  }
  const first = sharedHours ? sharedHours[0] : (overnight ? overnight.startHour : entries[0].serviceHour);
  const last = sharedHours ? sharedHours[sharedHours.length - 1] : entries.at(-1).serviceHour;
  for (let h = first; h <= last; h++) {
    const row = document.createElement('tr');
    const hour = document.createElement('td');
    hour.className = 'hour';
    const hourNumber = document.createElement('span');
    hourNumber.className = 'hour-number';
    const hourFormat = sharedHours ? sharedOvernight : overnight;
    hourNumber.textContent = ServiceDay.hourLabel(h, hourFormat);
    hour.append(hourNumber);
    if (ServiceDay.isNextDayHour(h, hourFormat)) {
      const suffix = document.createElement('small');
      suffix.className = 'next-day-suffix';
      suffix.textContent = `${ServiceDay.clockHourLabel(h)} วันถัดไป`;
      hour.append(suffix);
      hour.title = `${hourNumber.textContent} = ${ServiceDay.clockHourLabel(h)}:00 วันถัดไป`;
    }
    const minutes = document.createElement('td');
    minutes.className = 'minutes';
    const list = document.createElement('div');
    list.className = 'minute-list';
    const departures = byHour.get(h) || [];
    for (const entry of departures) {
      const item = document.createElement('span');
      item.className = entry.serviceType === 'bangkhen'
        ? 'minute bangkhen-minute'
        : entry.serviceType === 'a-variant'
          ? 'minute variant-minute'
          : entry.supplementary ? 'minute x-minute' : 'minute';
      const number = document.createElement('span');
      number.className = 'minute-number';
      number.textContent = String(entry.parsed.minute).padStart(2, '0');
      item.append(number);
      if (entry.supplementary || entry.serviceType === 'bangkhen' || entry.serviceType === 'a-variant') {
        const label = document.createElement('span');
        label.className = entry.serviceType === 'bangkhen' ? 'bangkhen-label'
          : entry.serviceType === 'a-variant' ? 'variant-label' : 'x-label';
        label.textContent = entry.serviceType === 'bangkhen' ? 'หมดระยะบางเขน'
          : entry.serviceType === 'a-variant' ? (entry.displayLabel || entry.route) : 'เสริม';
        item.append(label);
      }
      if (entry.route) item.title = `${entry.route} · เวลาออกจากป้ายแรก: ${entry.firstStop || 'ไม่มีข้อมูลใน API'} · ${entry.origin || '?'} → ${entry.destination || '?'}`;
      list.append(item);
    }
    minutes.append(list); row.append(hour, minutes); row.dataset.serviceHour = String(h); tbody.append(row);
  }
  return !!overnight;
}

async function loadRouteOptions() {
  if (isPreview) return;
  try {
    const response = await fetch('/api/routes', { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    const options = document.getElementById('routes');
    options.replaceChildren();
    for (const entry of data.routes || []) {
      const opt = document.createElement('option');
      opt.value = entry.route;
      opt.label = `${entry.start || ''} - ${entry.destination || ''}`;
      options.append(opt);
    }
  } catch (error) { console.debug('Route suggestions not available', error); }
}

function setStation(id, value) {
  $(id).textContent = typeof value === 'string' && value.trim() ? value.trim() : '—';
}
// The large heading shows ALL destinations served from this departure station.
// Colours correspond to the actual route ID of each departure, not to its
// live operating status. When different routes share an origin, passengers
// must still check the destination: sharing this table ≠ sharing the route.
function publicCode(routeId) {
  const routeName = String(routeId || '').trim();
  const code = routeName.match(/\(([^()]*)\)\s*$/)?.[1];
  return code || routeName || 'สายหลัก';
}
function styleOf(entry) {
  if (entry.serviceType === 'a-variant' || entry.serviceType === 'bangkhen') return 'blue';
  if (entry.supplementary) return 'red';
  return 'normal';
}
function stationKey(text) {
  return String(text || '').replace(/[\s\u200b–—\-]+/g, '').toLocaleLowerCase('th-TH');
}
function servicesAtOrigin(direction) {
  const lines = [];
  const seen = new Set();
  for (const item of direction?.departures || []) {
    if (!item.destination || item.destination === '-') continue;
    const routeId = item.route || '';
    const key = `${routeId}::${stationKey(item.destination)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({
      destination: item.destination,
      route: routeId,
      label: item.displayLabel || publicCode(routeId),
      color: styleOf(item)
    });
  }
  return lines;
}
function destinationOptions(direction) {
  const primary = typeof direction?.destination === 'string' && direction.destination.trim() && direction.destination !== '-'
    ? direction.destination.trim() : null;
  const all = servicesAtOrigin(direction);
  const options = primary ? [{ destination: primary, color: 'normal' }] : [];
  for (const service of all) {
    if (options.some(d => stationKey(d.destination) === stationKey(service.destination))) continue;
    options.push({ destination: service.destination, color: service.color });
  }
  return options;
}
function writeDestinations(target, direction) {
  target.replaceChildren();
  const destinations = destinationOptions(direction);
  if (!destinations.length) {
    target.textContent = '—';
    return;
  }
  destinations.forEach((item, index) => {
    if (index) {
      const sep = document.createElement('span');
      sep.className = 'destination-slash';
      sep.textContent = ' / ';
      target.append(sep);
    }
    const name = document.createElement('span');
    name.className = `destination-choice destination-${item.color}`;
    name.textContent = item.destination;
    target.append(name);
  });
}
function writeRouteKey(target, direction) {
  target.replaceChildren();
  const services = servicesAtOrigin(direction);
  const uniqueRoutes = new Set(services.map(d => d.route));
  target.hidden = services.length === 0 || uniqueRoutes.size < 2;
  if (target.hidden) return;
  const prefix = document.createElement('span');
  prefix.className = 'key-heading';
  prefix.textContent = 'สาย / ปลายทาง:';
  target.append(prefix);
  for (const item of services) {
    const chip = document.createElement('span');
    chip.className = `route-key-item key-${item.color}`;
    const routeLabel = item.color === 'red' ? `${item.label} เสริม` : item.label;
    chip.textContent = `${routeLabel} → ${item.destination}`;
    target.append(chip);
  }
}
// Every route shown in a combined board has its own published first stop.
// Do NOT substitute the route-picker origin for info.first_station: they may
// differ for short-turn services. A link opens that route's official schedule
// page, not a made-up stop-specific URL.
function firstStopsInDirection(direction) {
  const found = new Map();
  for (const entry of direction?.departures || []) {
    const routeId = String(entry.route || '').trim();
    const stopKey = `${routeId}::${stationKey(entry.firstStop)}`;
    if (!routeId || found.has(stopKey)) continue;
    found.set(stopKey, {
      route: routeId,
      label: entry.displayLabel || publicCode(routeId),
      firstStop: entry.firstStop || null,
      firstStopSource: entry.firstStopSource || null,
      color: styleOf(entry)
    });
  }
  // Show the line's API first stop even when it has no published departures
  // in this direction; never replace it with a route-picker endpoint.
  const routeId = String(direction?.route || '').trim();
  if (routeId && ![...found.values()].some(item => item.route === routeId)) {
    found.set(`fallback::${routeId}`, {
      route: routeId,
      label: publicCode(routeId),
      firstStop: direction?.firstStop || null,
      firstStopSource: direction?.firstStopSource || null,
      color: 'normal'
    });
  }
  return [...found.values()];
}
function writeFirstStopNote(target, direction) {
  target.replaceChildren();
  const intro = document.createElement('div');
  intro.className = 'first-stop-intro';
  intro.textContent = isPreview
    ? 'เวลาในตาราง = เวลาออกจากป้ายแรกของแต่ละสาย (ตัวอย่างเพื่อดูรูปแบบเท่านั้น)'
    : 'เวลาในตาราง = เวลาออกจากป้ายแรกของแต่ละสาย (อ้างอิงข้อมูลจาก API)';
  target.append(intro);

  const services = firstStopsInDirection(direction);
  if (!services.length) {
    const empty = document.createElement('div');
    empty.className = 'first-stop-unavailable';
    empty.textContent = 'ยังไม่มีข้อมูลป้ายแรก';
    target.append(empty);
    return;
  }
  const list = document.createElement('div');
  list.className = 'first-stop-list';
  for (const service of services) {
    const line = document.createElement('span');
    line.className = `first-stop-service first-stop-${service.color}`;
    const link = document.createElement('a');
    link.className = 'first-stop-source';
    link.href = `https://information.thaismilebus.com/SchedulePlan/index.php?route=${encodeURIComponent(service.route)}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = `เปิดตารางต้นฉบับของสาย ${service.route}`;
    link.textContent = `สาย ${service.label}`;
    const name = document.createElement('span');
    // Missing first_station must not be silently replaced by a route endpoint.
    name.textContent = ` · ป้ายแรก: ${service.firstStop || 'ไม่ระบุใน API'}`;
    line.append(link, name);
    list.append(line);
  }
  target.append(list);
}

function writeDirection(originId, destinationId, keyId, direction) {
  setStation(originId, direction?.origin);
  writeDestinations($(destinationId), direction);
  writeRouteKey($(keyId), direction);
}
function setNotice(message, type = '') {
  $('notice').className = `notice ${type}`.trim();
  $('notice').textContent = message;
}
function setSourceLink(activeRoute) {
  $('sourceLink').href = 'https://information.thaismilebus.com/SchedulePlan/index.php?route=' + encodeURIComponent(activeRoute);
}
function clearExtras() {
  $('extraPanels').replaceChildren();
  $('supplementSection').hidden = true;
  $('supplementJump').hidden = true;
}
function resetBoard() {
  $('goHeading').textContent = 'ขาไป';
  $('backHeading').textContent = 'ขากลับ';
  $('goJumpLabel').textContent = 'ขาไป';
  $('backJumpLabel').textContent = 'ขากลับ';
  $('circularNote').hidden = true;
  for (const id of ['goOrigin', 'goDestination', 'backOrigin', 'backDestination']) setStation(id, null);
  for (const id of ['goRouteKey', 'backRouteKey']) { $(id).hidden = true; $(id).replaceChildren(); }
  for (const id of ['goFirstStopNote', 'backFirstStopNote']) $(id).replaceChildren();
  $('serviceCaution').hidden = true;
  $('endpointCorrectionNote').hidden = true;
  renderTimes($('goBody'), []);
  renderTimes($('backBody'), []);
  clearExtras();
  $('overnightNote').hidden = true;
}
function renderExtraPanel(data, supplementRoute) {
  const panel = document.createElement('section');
  panel.className = 'timetable-panel';
  const bangkhen = data.departures?.some(d => d.serviceType === 'bangkhen');
  const aVariant = data.departures?.some(d => d.serviceType === 'a-variant');
  const circular = !!data.circularSide;
  panel.classList.add(circular ? 'lr-extra-panel' : bangkhen ? 'bangkhen-panel' : aVariant ? 'variant-panel' : 'x-panel');
  panel.setAttribute('aria-label', circular ? `เที่ยวรถเพิ่มเติมสาย ${data.circularSide}`
    : bangkhen ? 'เที่ยวรถออกจากบางเขน'
      : aVariant ? 'ตารางเวลาสาย A จากต้นทางอื่น' : 'เส้นทางตัดเสริม');
  const header = document.createElement('header');
  header.className = 'panel-header';
  const heading = document.createElement('div');
  heading.className = 'panel-heading-top';
  heading.textContent = circular ? (data.panelTitle || `สาย ${data.circularSide}`)
    : bangkhen ? `บางเขน · ${data.departures?.[0]?.route || '1-3(34)'}`
      : aVariant ? `สาย ${data.departures?.[0]?.displayLabel || data.departures?.[0]?.route || 'A'}`
        : `เส้นทางตัดเสริม (${data.departures?.[0]?.route || supplementRoute})`;
  const direction = document.createElement('div');
  direction.className = 'route-direction';
  const originName = document.createElement('strong');
  originName.textContent = data.origin || '—';
  const separator = document.createElement('span');
  separator.className = 'route-separator';
  separator.textContent = ' - ';
  const destinationName = document.createElement('strong');
  writeDestinations(destinationName, data);
  direction.append(originName, separator, destinationName);
  header.append(heading, direction);
  const firstStopNote = document.createElement('div');
  firstStopNote.className = 'first-stop-note';
  writeFirstStopNote(firstStopNote, data);
  const columnHead = document.createElement('div');
  columnHead.className = 'column-head';
  const hour = document.createElement('span'); hour.textContent = '時';
  const min = document.createElement('span'); min.textContent = '分';
  columnHead.append(hour, min);
  const table = document.createElement('table');
  table.className = 'timetable';
  const tbody = document.createElement('tbody');
  table.append(tbody); panel.append(header, firstStopNote, columnHead, table);
  panel.dataset.overnight = String(renderTimes(tbody, data.departures || [], data.serviceBounds || []));
  return panel;
}
function renderExtras(extraPanels, supplementaryRoute) {
  clearExtras();
  if (!Array.isArray(extraPanels) || !extraPanels.length) return false;
  $('supplementSection').hidden = false;
  $('supplementJump').hidden = false;
  const hasCircular = extraPanels.some(p => !!p.circularSide);
  $('supplementJump').textContent = hasCircular ? 'เที่ยวรถเพิ่มเติม' : 'เส้นทางเสริม';
  const hasBangkhen = extraPanels.some(p => p.departures?.some(d => d.serviceType === 'bangkhen'));
  const hasAVariant = extraPanels.some(p => p.departures?.some(d => d.serviceType === 'a-variant'));
  $('supplementHeading').textContent = hasCircular ? 'ตารางเวลาเที่ยวเพิ่มเติมของสาย L / R'
    : hasBangkhen || hasAVariant ? 'ตารางเวลาออกจากต้นทางอื่น' : 'เส้นทางตัดเสริม';
  // Show Bangkhen departures before the red X-route Kor Por Aor panel.
  const orderedPanels = [...extraPanels].sort((a, b) =>
    Number(!!b.departures?.some(d => d.serviceType === 'bangkhen')) -
    Number(!!a.departures?.some(d => d.serviceType === 'bangkhen')));
  let hasOvernight = false;
  for (const data of orderedPanels) {
    const panel = renderExtraPanel(data, supplementaryRoute || 'X');
    if (panel.dataset.overnight === 'true') hasOvernight = true;
    $('extraPanels').append(panel);
  }
  return hasOvernight;
}

function sampleTrips(times, routeName, supplementary, origin, destination, serviceType = '') {
  return times.map(time => ({
    time, route: routeName, supplementary, origin, destination, serviceType,
    firstStop: origin, firstStopSource: 'preview'
  }));
}
function previewData() {
  const routeCode = route.match(/\(([^()]+)\)\s*$/)?.[1]?.toUpperCase() || route.toUpperCase();
  if (/^147[LR]$/.test(routeCode)) {
    const l = '4-25L(147L)', r = '4-25R(147R)';
    const origin = 'ป้ายตัวอย่าง L', opposite = 'ป้ายตัวอย่าง R';
    return {
      route: l, displayTitle: '147L / 147R', requestedRoute: route,
      circularPair: { left: l, right: r, publicLeft: '147L', publicRight: '147R' },
      go: {
        route: l, origin, destination: opposite, firstStop: origin,
        departures: sampleTrips(PREVIEW_GO, l, false, origin, opposite)
      },
      back: {
        route: r, origin: opposite, destination: origin, firstStop: opposite,
        departures: sampleTrips(PREVIEW_BACK, r, false, opposite, origin)
      },
      extraPanels: []
    };
  }
  if (routeCode === '113' || routeCode === '113A' || routeCode === '555' || routeCode === '555A') {
    // DEMO ONLY: illustrate A-route grouping without inventing live departures.
    const airport = routeCode.startsWith('555');
    const main = airport ? 'S6(555)' : '1-44(113)';
    const variant = airport ? 'S6A(555A)' : '1-44A(113A)';
    const code = airport ? '555A' : '113A';
    const origin = airport ? 'ท่าอากาศยานสุวรรณภูมิ' : 'มีนบุรี';
    const destination = airport ? 'หมอชิต 2' : 'หัวลำโพง';
    const alternativeDestination = airport ? 'ท่าอากาศยานดอนเมือง' : 'อนุสาวรีย์ชัยสมรภูมิ';
    const blueTrip = (time, o, d) => ({
      ...sampleTrips([time], variant, false, o, d, 'a-variant')[0], displayLabel: code
    });
    return {
      route: main, variantRoutes: [variant],
      go: {
        origin, destination, departures: [
          ...sampleTrips(PREVIEW_GO, main, false, origin, destination),
          blueTrip('06:17', origin, alternativeDestination), blueTrip('07:37', origin, alternativeDestination)
        ]
      },
      back: {
        origin: destination, destination: origin,
        departures: sampleTrips(PREVIEW_BACK, main, false, destination, origin)
      },
      extraPanels: [{
        origin: alternativeDestination, destination: origin,
        departures: [blueTrip('06:32', alternativeDestination, origin), blueTrip('07:52', alternativeDestination, origin)]
      }]
    };
  }
  if (routeCode === '517' || routeCode === '517X') {
    // Each route is displayed independently, even in the design preview.
    const isX = routeCode === '517X';
    const name = isX ? '1-56(517X)' : '1-56(517)';
    const origin = 'สถาบันเทคโนโลยีพระจอมเกล้าเจ้าคุณทหารลาดกระบัง';
    const destination = isX ? 'หมอชิต 2' : 'อนุสาวรีย์ชัยสมรภูมิ';
    return {
      route: name, supplementaryRoutes: [], variantRoutes: [],
      go: { origin, destination, departures: sampleTrips(PREVIEW_GO, name, isX, origin, destination) },
      back: {
        origin: destination, destination: origin,
        departures: sampleTrips(PREVIEW_BACK, name, isX, destination, origin)
      },
      extraPanels: []
    };
  }
  if (/^(?:34x?|1-3\s*(?:\(34(?:เสริม)?\))?)$/i.test(route)) {
    // Example times only: illustrate the actual requested 4-origin structure.
    const rangsit = 'รังสิต', hua = 'หัวลำโพง', kor = 'แยก คปอ.', bangkhen = 'บางเขน';
    return {
      route: '34', supplementaryRoutes: ['34X'], relatedRoutes: ['1-3(34)'],
      go: {
        origin: rangsit, destination: hua,
        departures: [
          ...sampleTrips(PREVIEW_GO, '34', false, rangsit, hua),
          ...sampleTrips(['05:18', '06:20', '07:15', '08:40', '17:30'], '34X', true, rangsit, kor)
        ]
      },
      back: {
        origin: hua, destination: rangsit,
        departures: [
          ...sampleTrips(PREVIEW_BACK, '34', false, hua, rangsit),
          ...sampleTrips(['05:09', '06:22', '07:36', '08:10', '18:45'], '1-3(34)', false, hua, bangkhen, 'bangkhen')
        ]
      },
      extraPanels: [
        { origin: bangkhen, destination: hua, departures: sampleTrips(['05:05', '06:08', '07:24', '08:35', '18:05'], '1-3(34)', false, bangkhen, hua, 'bangkhen') },
        { origin: kor, destination: rangsit, departures: sampleTrips(['05:30', '06:41', '07:52', '08:45', '18:24'], '34X', true, kor, rangsit) }
      ]
    };
  }
  if (/^4-8x?\(35x?\)$/i.test(route)) {
    // These are fictitious labels and departures for testing X rendering ONLY.
    const a = 'ต้นทางตัวอย่าง A', b = 'ปลายทางตัวอย่าง B', c = 'ต้นทางเสริม C';
    return {
      route: '4-8(35)', supplementaryRoute: '4-8X(35X)',
      go: {
        origin: a, destination: b,
        departures: [...sampleTrips(PREVIEW_GO, '4-8(35)', false, a, b), ...sampleTrips(['06:10', '07:25', '08:45', '23:20'], '4-8X(35X)', true, a, c)]
      },
      back: { origin: b, destination: a, departures: sampleTrips(PREVIEW_BACK, '4-8(35)', false, b, a) },
      extraPanels: [{ origin: c, destination: a, departures: sampleTrips(['06:15', '07:40', '08:50'], '4-8X(35X)', true, c, a) }]
    };
  }
  const a = 'มหาวิทยาลัยธรรมศาสตร์ (ศูนย์รังสิต)', b = 'บางเขน';
  return {
    route, supplementaryRoute: null,
    go: { origin: a, destination: b, departures: sampleTrips(PREVIEW_GO, route, false, a, b) },
    back: { origin: b, destination: a, departures: sampleTrips(PREVIEW_BACK, route, false, b, a) },
    extraPanels: []
  };
}
function applyData(result) {
  const pair = result.circularPair;
  $('goHeading').textContent = pair ? `สาย L · ${pair.publicLeft}` : 'ขาไป';
  $('backHeading').textContent = pair ? `สาย R · ${pair.publicRight}` : 'ขากลับ';
  $('goJumpLabel').textContent = pair ? `สาย L (${pair.publicLeft})` : 'ขาไป';
  $('backJumpLabel').textContent = pair ? `สาย R (${pair.publicRight})` : 'ขากลับ';
  $('goPanel').setAttribute('aria-label', pair ? `สาย L ${pair.publicLeft}` : 'ขาไป');
  $('backPanel').setAttribute('aria-label', pair ? `สาย R ${pair.publicRight}` : 'ขากลับ');
  $('circularNote').hidden = !pair;
  writeDirection('goOrigin', 'goDestination', 'goRouteKey', result.go);
  writeDirection('backOrigin', 'backDestination', 'backRouteKey', result.back);
  writeFirstStopNote($('goFirstStopNote'), result.go);
  writeFirstStopNote($('backFirstStopNote'), result.back);
  const allRoutes = new Set([
    ...(result.go?.departures || []),
    ...(result.back?.departures || []),
    ...(result.extraPanels || []).flatMap(panel => panel.departures || [])
  ].map(item => item.route).filter(Boolean));
  $('serviceCaution').hidden = !!result.circularPair || allRoutes.size <= 1;
  // Show the 1-3(34) special blue note only if that route is actually present.
  $('route13BlueNote').hidden = ![...allRoutes].some(name =>
    /^(?:1-3(?:\s*\(34(?:เสริม)?\))?|1-3\s*\(34\))$/i.test(String(name).trim())
  );
  $('endpointCorrectionNote').hidden = ![...allRoutes].some(name => /\(529EX\)/i.test(name));
  const shared = sharedHourWindow(result.go, result.back);
  const goOvernight = renderTimes($('goBody'), result.go?.departures || result.go?.times || [], result.go?.serviceBounds || [], shared?.hours, shared?.hourFormat);
  const backOvernight = renderTimes($('backBody'), result.back?.departures || result.back?.times || [], result.back?.serviceBounds || [], shared?.hours, shared?.hourFormat);
  scheduleMainAlignment();
  const extraOvernight = renderExtras(result.extraPanels, result.supplementaryRoute);
  $('overnightNote').hidden = !(goOvernight || backOvernight || extraOvernight);
  $('routeTitle').textContent = result.displayTitle || result.route || route;
  setSourceLink(result.requestedRoute || result.route || route);
}

async function load() {
  const token = ++requestToken;
  loading = true;
  $('refreshBtn').disabled = true;
  $('routeTitle').textContent = route;
  setSourceLink(route);
  setNotice('กำลังโหลดเวลาเดินรถ…');

  if (isPreview) {
    applyData(previewData());
    setNotice('DEMO / ตัวอย่างเท่านั้น — เปิด http://localhost:3000 เพื่อใช้ข้อมูลจาก API', 'preview');
    loading = false;
    $('refreshBtn').disabled = false;
    return;
  }
  try {
    const API_BASE =
      window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1'
        ? ''
        : 'https://tsbtimetable.onrender.com';

    const response = await fetch(
      `${API_BASE}/api/schedule?route=${encodeURIComponent(route)}`,
      { cache: 'no-store' }
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || result.error || 'Request failed');
    if (token !== requestToken) return;
    applyData(result);
    const updated = new Intl.DateTimeFormat('th-TH', {
      timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date(result.fetchedAt));
    const pairText = result.circularPair ? ` · รวมสาย L ${result.circularPair.publicLeft} / R ${result.circularPair.publicRight}` : '';
    const extraText = (result.supplementaryRoutes?.length || result.supplementaryRoute)
      ? ` · รวมเสริม ${(result.supplementaryRoutes || [result.supplementaryRoute]).join(', ')}` : '';
    const bangkhenText = result.relatedRoutes?.length ? ` · รวม ${result.relatedRoutes.join(', ')}` : '';
    const variantText = result.variantRoutes?.length ? ` · รวมสาย ${result.variantRoutes.join(', ')}` : '';
    const fallbackText = result.routeNameSource === 'route-data-fallback' ? ' · ใช้ชื่อป้ายจากข้อมูลสาย' : '';
    const catalogText = result.routeCatalogAvailable === false ? ' · ไม่สามารถตรวจสอบสายเสริมทั้งหมดได้' : '';
    setNotice(`ข้อมูลเวลาเดินรถ: ${result.route} · อัปเดต ${updated}${pairText}${extraText}${bangkhenText}${variantText}${fallbackText}${catalogText}`);
  } catch (error) {
    if (token !== requestToken) return;
    resetBoard();
    setNotice('โหลดข้อมูลจาก API ไม่สำเร็จ: ' + error.message, 'error');
  } finally {
    if (token === requestToken) { loading = false; $('refreshBtn').disabled = false; }
  }
}

$('routeForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const next = $('route').value.trim();
  if (!next) return;
  route = next;
  const url = new URL(location.href);
  url.searchParams.set('route', route);
  history.replaceState(null, '', url);
  load();
});
$('refreshBtn').addEventListener('click', load);
$('fullBtn').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $('appRoot').requestFullscreen();
  } catch (error) { console.error(error); }
});
const incoming = new URLSearchParams(location.search).get('route');
if (incoming && incoming.length <= 60) { route = incoming; $('route').value = route; }
setInterval(() => { if (!document.hidden && !loading && !isPreview) load(); }, 60_000);
load();

loadRouteOptions();
