'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { routePair, directionFromResponse, mergeDirections } = require('../timetableLogic');
const { server } = require('../server');

const main = directionFromResponse({
  go: { timetable: [{ time: '06:00' }, { time: '07:30' }] },
  back: { timetable: [{ time: '06:12' }] }
}, { start: 'ต้นทาง A', destination: 'ปลายทาง B' }, '4-8(35)', false);
const supplement = directionFromResponse({
  go: { timetable: [{ time: '06:05' }, { time: '07:35' }] },
  back: { timetable: [{ time: '06:20' }] }
}, { start: 'ต้นทาง A', destination: 'ปลายทาง C' }, '4-8X(35X)', true);

test('4-8(35) pairs with 4-8X(35X)', () => {
  assert.deepEqual(routePair('4-8(35)'), { primary: '4-8(35)', supplementary: '4-8X(35X)' });
  assert.deepEqual(routePair('4-8X(35X)'), { primary: '4-8(35)', supplementary: '4-8X(35X)' });
});

test('X departure is merged only at same origin, with other origin separate', () => {
  for (const dir of [supplement.go, supplement.back]) dir.departures.forEach(d => d.supplementary = true);
  const out = mergeDirections(main, supplement, '4-8X(35X)');
  assert.equal(out.go.departures.length, 4);
  assert.equal(out.go.departures.filter(d => d.supplementary).length, 2);
  assert.equal(out.back.departures.length, 1);
  assert.equal(out.extraPanels.length, 1);
  assert.equal(out.extraPanels[0].origin, 'ปลายทาง C');
  assert.equal(out.extraPanels[0].departures[0].time, '06:20');
});

test('X service is merged into opposite board when its start matches opposite origin', () => {
  const alternative = directionFromResponse({
    go: { timetable: [{time:'06:25'}] }, back: { timetable: [{time:'06:48'}] }
  }, {start:'ปลายทาง B', destination:'ปลายทาง C'}, '4-8X(35X)', true);
  for (const dir of [alternative.go, alternative.back]) dir.departures.forEach(d => d.supplementary = true);
  const out = mergeDirections(main, alternative, '4-8X(35X)');
  assert.equal(out.back.departures.length, 2);
  assert.equal(out.extraPanels.length, 1);
  assert.equal(out.extraPanels[0].origin, 'ปลายทาง C');
});

test('unavailable X route leaves main schedule unchanged', () => {
  const out = mergeDirections(main, null, '4-8X(35X)');
  assert.equal(out.supplementaryName, null);
  assert.equal(out.go.departures.length, 2);
  assert.equal(out.extraPanels.length, 0);
});

test('API response includes merged times and extra panels', async (t) => {
  const origFetch = global.fetch;
  const html = `<select><option value="4-8(35)" data-start="ต้นทาง A" data-destination="ปลายทาง B">4-8</option><option value="4-8X(35X)" data-start="ต้นทาง A" data-destination="ปลายทาง C">4-8X</option></select>`;
  global.fetch = async (url, opts = {}) => {
    if (String(url).startsWith('https://information.thaismilebus.com/')) {
      if (opts.method === 'POST') {
        const params = new URLSearchParams(opts.body);
        const target = params.get('routeName');
        const data = target === '4-8(35)' ? {
          go:{timetable:[{time:'06:00'}]}, back:{timetable:[{time:'06:10'}]}
        } : {
          go:{timetable:[{time:'06:05'}]}, back:{timetable:[{time:'06:20'}]}
        };
        return new Response(JSON.stringify({status:'success',data,updated_date:'2026-11-13'}),{status:200,headers:{'Content-Type':'application/json'}});
      }
      return new Response(html, {status:200,headers:{'Content-Type':'text/html'}});
    }
    return origFetch(url, opts);
  };
  t.after(() => { global.fetch = origFetch; });
  server.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const response = await origFetch(`http://127.0.0.1:${port}/api/schedule?route=4-8%2835%29`);
  assert.equal(response.status,200);
  const payload = await response.json();
  assert.equal(payload.route,'4-8(35)');
  assert.equal(payload.supplementaryRoute,'4-8X(35X)');
  assert.equal(payload.go.origin,'ต้นทาง A');
  assert.equal(payload.go.destination,'ปลายทาง B');
  assert.deepEqual(payload.go.departures.map(d=>[d.time,d.supplementary]), [['06:00',false],['06:05',true]]);
  assert.equal(payload.back.departures.length,1);
  assert.equal(payload.extraPanels.length,1);
  assert.equal(payload.extraPanels[0].origin,'ปลายทาง C');
  assert.equal(payload.extraPanels[0].departures[0].time,'06:20');
  const htmlRes = await origFetch(`http://127.0.0.1:${port}/`);
  assert.equal(htmlRes.status,200);
  const htmlText = await htmlRes.text();
  assert.match(htmlText, /Data source: Thai Smile Bus SchedulePlan/);
  assert.match(htmlText, /https:\/\/information\.thaismilebus\.com\/SchedulePlan\/index\.php\?route/);
  assert.match(htmlText, /24 = 00 วันถัดไป/);
});
