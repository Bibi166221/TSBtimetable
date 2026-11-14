'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../public/serviceDay.js');
const { directionFromResponse, mergeDirections } = require('../timetableLogic');

function trips(...times) { return times.map(time => ({ time, supplementary: false })); }
const overnightMeta = [{ route: 'overnight', firstBus: '03:40 น.', lastBus: '02:00 น.' }];

test('overnight route 03:40 to 02:00 shows 03…23 then 24,25,26 with small next-day labels', () => {
  const values = trips('23:10', '00:10', '01:10', '02:00', '03:40', '04:20', '12:15');
  const bounds = service.overnightBounds(overnightMeta, values);
  assert.equal(bounds.startHour,3);
  assert.equal(bounds.source,'first_bus-per-route');
  const display = service.orderEntries(values, bounds);
  assert.deepEqual(display.map(x => [x.time,x.serviceHour]), [
    ['03:40',3], ['04:20',4],['12:15',12],['23:10',23],
    ['00:10',24],['01:10',25],['02:00',26]
  ]);
  assert.deepEqual(display.map(x => service.hourLabel(x.serviceHour,bounds)), ['03','04','12','23','24','25','26']);
  assert.equal(service.hourLabel(26,bounds),'26');
  assert.equal(service.hourLabel(24,bounds),'24');
  assert.equal(service.hourLabel(25,bounds),'25');
  assert.equal(service.clockHourLabel(24), '00');
  assert.equal(service.clockHourLabel(25), '01');
  assert.equal(service.clockHourLabel(26), '02');
  assert.equal(service.isNextDayHour(24,bounds), true);
  assert.equal(service.isNextDayHour(25,bounds), true);
  assert.equal(service.isNextDayHour(26,bounds), true);
  assert.equal(service.isNextDayHour(23,bounds), false);
  assert.equal(service.isNextDayHour(24,null), false);
});

test('normal route ending at 00:10 remains 00 (not 24), even if metadata rolls over', () => {
  const values = trips('05:00','22:20','23:30','00:10');
  const bounds = service.overnightBounds([{ firstBus:'05:00',lastBus:'00:10' }],values);
  assert.equal(bounds,null);
  assert.deepEqual(service.orderEntries(values,bounds).map(x=>service.hourLabel(x.serviceHour,bounds)),['05','22','23','00']);
});

test('01/02 route without trustworthy source bounds is unchanged (no unsupported dating)', () => {
  const values = trips('03:40','23:00','01:10','02:00');
  assert.equal(service.overnightBounds([], values),null);
  assert.deepEqual(service.orderEntries(values,null).map(x=>x.time),['01:10','02:00','03:40','23:00']);
});

test('one panel may be overnight while opposite panel remains normal', () => {
  const raw = {
    go:{info:{first_bus:'03:40',last_bus:'02:00'},timetable:[{time:'03:40'},{time:'23:10'},{time:'02:00'}]},
    back:{info:{first_bus:'05:00',last_bus:'22:00'},timetable:[{time:'05:00'},{time:'22:00'}]}
  };
  const d = directionFromResponse(raw, {start:'A',destination:'B'},'route',false);
  assert.deepEqual(d.go.serviceBounds, [{route:'route',firstBus:'03:40',lastBus:'02:00'}]);
  assert.ok(service.overnightBounds(d.go.serviceBounds,d.go.departures));
  assert.equal(service.overnightBounds(d.back.serviceBounds,d.back.departures),null);
});

test('X route source metadata is retained after merging with its main line', () => {
  const main = directionFromResponse({go:{info:{first_bus:'05:00',last_bus:'22:00'},timetable:[{time:'05:00'}]},back:{timetable:[]}}, {start:'A',destination:'B'}, '4-8(35)',false);
  const sub = directionFromResponse({go:{info:{first_bus:'03:40',last_bus:'02:00'},timetable:[{time:'03:40'},{time:'23:10'},{time:'02:00'}]},back:{timetable:[]}}, {start:'A',destination:'C'}, '4-8X(35X)',true);
  const merged = mergeDirections(main,sub,'4-8X(35X)');
  assert.equal(merged.go.serviceBounds.length,2);
  assert.equal(merged.go.departures.filter(x=>x.supplementary).length,3);
  assert.ok(service.overnightBounds(merged.go.serviceBounds,merged.go.departures));
});

test('overnight X line on separate origin retains its own service bounds', () => {
  const main = directionFromResponse({go:{timetable:[{time:'06:00'}]},back:{timetable:[]}}, {start:'A',destination:'B'}, '4-8(35)',false);
  const sub = directionFromResponse({go:{info:{first_bus:'03:40',last_bus:'02:00'},timetable:[{time:'03:40'},{time:'23:10'},{time:'02:00'}]},back:{timetable:[]}}, {start:'C',destination:'B'}, '4-8X(35X)',true);
  const merged = mergeDirections(main,sub,'4-8X(35X)');
  assert.equal(merged.extraPanels.length,1);
  assert.ok(service.overnightBounds(merged.extraPanels[0].serviceBounds,merged.extraPanels[0].departures));
});


test('shared A/X panel honors each service first_bus independently', () => {
  const values = [
    {route:'113',time:'04:50'}, {route:'113',time:'23:10'},
    {route:'113',time:'03:00'}, {route:'113A',time:'05:40'},
    {route:'113A',time:'23:30'}, {route:'113A',time:'02:20'}
  ];
  const bounds = service.overnightBounds([
    {route:'113',firstBus:'04:50',lastBus:'03:00'},
    {route:'113A',firstBus:'05:40',lastBus:'02:20'}
  ],values);
  assert.equal(bounds.startHour,4);
  assert.deepEqual(service.orderEntries(values,bounds).map(x=>[x.route,x.time,x.serviceHour]), [
    ['113','04:50',4],['113A','05:40',5],['113','23:10',23],
    ['113A','23:30',23],['113A','02:20',26],['113','03:00',27]
  ]);
});

test('03:00 before the published 03:40 first bus moves to hour 27 for any line', () => {
  const values = [
    {route:'other',time:'03:40'}, {route:'other',time:'22:10'},
    {route:'other',time:'03:00'}
  ];
  const overnight = service.overnightBounds([
    {route:'other',firstBus:'03:40',lastBus:'03:00'}
  ],values);
  assert.equal(overnight.startHour,3);
  assert.deepEqual(service.orderEntries(values,overnight).map(x=>x.serviceHour),[3,22,27]);
});
