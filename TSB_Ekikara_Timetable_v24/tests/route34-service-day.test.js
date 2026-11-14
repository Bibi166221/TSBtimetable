'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { directionFromResponse, applyRoute34ServiceDay } = require('../timetableLogic');
const day = require('../public/serviceDay');

function line(goInfo, backInfo, goTimes, backTimes) {
  return directionFromResponse({
    go: { info: goInfo, timetable: goTimes.map(time => ({time})) },
    back: { info: backInfo, timetable: backTimes.map(time => ({time})) }
  }, { start: 'รังสิต', destination: 'หัวลำโพง' }, '34', false);
}

test('route 34: Hua Lamphong 04:50 first bus puts 03:00 after midnight', () => {
  const raw = line({first_bus:'03:40 น.',last_bus:'02:00 น.'},
    {first_bus:'04:50 น.', last_bus:'03:00 น.'},
    ['03:40','12:00','23:30','02:00'], ['01:10','02:10','03:00','04:50','12:30','23:20']);
  const bounds = day.overnightBounds(raw.back.serviceBounds,raw.back.departures);
  assert.equal(bounds.startHour,4);
  assert.deepEqual(day.orderEntries(raw.back.departures,bounds).map(x=>x.time),
    ['04:50','12:30','23:20','01:10','02:10','03:00']);
  assert.deepEqual(day.orderEntries(raw.back.departures,bounds).map(x=>x.serviceHour),
    [4,12,23,25,26,27]);
});

test('same firstBus logic works for any unrelated route', () => {
  const raw = line({first_bus:'05:30',last_bus:'01:00'},
    {first_bus:'06:00',last_bus:'03:00'},
    ['05:30','22:00','01:00'], ['06:00','23:00','01:10','03:00']);
  raw.back.serviceBounds[0].route = 'other';
  const bounds = day.overnightBounds(raw.back.serviceBounds,raw.back.departures.map(d=>({...d,route:'other'})));
  assert.equal(bounds.startHour,6);
  assert.deepEqual(day.orderEntries(raw.back.departures.map(d=>({...d,route:'other'})),bounds).map(x=>x.serviceHour),[6,23,25,27]);
});

test('API firstBus at 03:00 keeps 03:00 at the start (no invented chronology)', () => {
  const raw = line({first_bus:'03:40',last_bus:'20:00'},
    {first_bus:'03:00',last_bus:'02:10'},
    ['03:40','20:00'], ['01:10','02:10','03:00','04:50','23:20']);
  const bounds = day.overnightBounds(raw.back.serviceBounds,raw.back.departures);
  assert.equal(bounds.startHour,3);
  assert.equal(day.orderEntries(raw.back.departures,bounds)[0].time,'03:00');
});

test('route 34 labels correctly corrected in HTML and Javascript', async () => {
  const fs = require('node:fs/promises'); const path = require('node:path');
  const html = await fs.readFile(path.join(__dirname,'../public/index.html'),'utf8');
  const js = await fs.readFile(path.join(__dirname,'../public/app.js'),'utf8');
  assert.ok(html.includes('รถเส้นทางตัดเสริม X (เสริม)</b>') === false); // HTML has punctuation outside bold
  assert.ok(html.includes('รถเส้นทางตัดเสริม X (เสริม)'));
  assert.ok(!html.includes('อาจสิ้นสุดก่อนสายหลัก'));
  assert.ok(html.includes('สาย A หรือสายที่มีปลายทางต่างจากเส้นทางหลัก'));
  assert.ok(html.includes('สาย 1-3(34) หมดระยะบางเขน'));
  assert.ok(js.includes("'หมดระยะบางเขน'"));
});
