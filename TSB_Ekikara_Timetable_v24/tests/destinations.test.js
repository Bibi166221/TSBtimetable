'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { directionFromResponse, correctPublishedTerminus } = require('../timetableLogic');
const { server } = require('../server');

test('529EX route-specific correction changes BOTH direction endpoints and each departure, not 529E', () => {
  const raw = {
    go: { timetable: [{ time: '06:00' }] },
    back: { timetable: [{ time: '07:00' }] }
  };
  const meta = { start: 'แสมดำ', destination: 'สถานีขนส่งผู้โดยสารกรุงเทพฯ (จตุจักร)' };
  const x = correctPublishedTerminus('4-29EX(529EX)', directionFromResponse(raw, meta, '4-29EX(529EX)', true));
  assert.equal(x.go.origin, 'แสมดำ');
  assert.equal(x.go.destination, 'สุทธิสาร');
  assert.equal(x.go.departures[0].destination, 'สุทธิสาร');
  assert.equal(x.back.origin, 'สุทธิสาร');
  assert.equal(x.back.destination, 'แสมดำ');
  assert.equal(x.back.departures[0].origin, 'สุทธิสาร');
  assert.equal(x.back.departures[0].destination, 'แสมดำ');
  const main = correctPublishedTerminus('4-29E(529E)', directionFromResponse(raw, meta, '4-29E(529E)', false));
  assert.equal(main.go.destination, meta.destination);
  assert.equal(main.back.origin, meta.destination);
});

test('529E shares origin with corrected 529EX but its return X terminal is a separate panel', async (t) => {
  const nativeFetch = global.fetch;
  const catalog = '<select>' + [
    '<option value="4-29E(529E)" data-start="แสมดำ" data-destination="หมอชิต 2">529E</option>',
    '<option value="4-29EX(529EX)" data-start="แสมดำ" data-destination="หมอชิต 2">529EX</option>'
  ].join('') + '</select>';
  global.fetch = async (url, init = {}) => {
    if (!String(url).startsWith('https://information.thaismilebus.com/SchedulePlan')) return nativeFetch(url, init);
    if (init.method === 'POST') {
      const name = new URLSearchParams(init.body).get('routeName');
      const x = name.includes('529EX');
      return new Response(JSON.stringify({
        status: 'success', updated_date: '2026-11-14',
        data: { go: { timetable: [{time: x ? '06:10':'06:00'}] }, back: {timetable:[{time:x?'07:10':'07:00'}]} }
      }), { status: 200, headers: {'content-type':'application/json'} });
    }
    return new Response(catalog, { status: 200, headers: {'content-type':'text/html'} });
  };
  t.after(() => { global.fetch = nativeFetch; });
  server.listen(0);
  await new Promise(resolve => server.once('listening',resolve));
  t.after(() => server.close());
  const response = await nativeFetch(`http://127.0.0.1:${server.address().port}/api/schedule?route=${encodeURIComponent('4-29E(529E)')}`);
  assert.equal(response.status,200);
  const result = await response.json();
  assert.deepEqual(result.supplementaryRoutes, ['4-29EX(529EX)']);
  assert.equal(result.go.destination, 'หมอชิต 2');
  assert.deepEqual(result.go.departures.map(d=>[d.route,d.destination]), [
    ['4-29E(529E)','หมอชิต 2'], ['4-29EX(529EX)','สุทธิสาร']
  ]);
  assert.equal(result.extraPanels.length, 1);
  assert.equal(result.extraPanels[0].origin, 'สุทธิสาร');
  assert.equal(result.extraPanels[0].destination, 'แสมดำ');
});
