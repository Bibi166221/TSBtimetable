'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { directionFromResponse, mergeDirections, correctPublishedTerminus } = require('../timetableLogic');
const { server } = require('../server');

test('first stop uses go/back info.first_station, independent from picker endpoint', () => {
  const raw = {
    go: { info: { first_station: 'ป้ายแรกขาไป', last_station: 'ป้ายสุดท้ายขาไป' },
      stops: [{ name: 'ป้ายแรกจากลำดับ' }], timetable: [{time:'05:00'}] },
    back: { info: { first_station: 'ป้ายแรกขากลับ' }, timetable: [{time:'06:00'}] }
  };
  const result = directionFromResponse(raw, {start:'ชื่อสถานีต้นทางในตัวเลือก', destination:'ชื่อปลายทางในตัวเลือก'}, '1-44(113)', false);
  assert.equal(result.go.origin, 'ชื่อสถานีต้นทางในตัวเลือก');
  assert.equal(result.go.firstStop, 'ป้ายแรกขาไป');
  assert.equal(result.go.departures[0].firstStop, 'ป้ายแรกขาไป');
  assert.equal(result.go.departures[0].firstStopSource, 'info.first_station');
  assert.equal(result.back.firstStop, 'ป้ายแรกขากลับ');
  assert.equal(result.back.departures[0].firstStop, 'ป้ายแรกขากลับ');
});

test('falls back to first listed API stop when first_station absent; never invents one from route option', () => {
  const raw = { go: { stops: [{name:'ป้ายหมายเลขหนึ่ง'}, {name:'ป้ายที่สอง'}], timetable: [{time:'05:20'}] }, back: { timetable: [{time:'06:15'}] } };
  const result = directionFromResponse(raw, {start:'ต้นทางในตัวเลือก', destination:'ปลายทางในตัวเลือก'}, '4-8(35)', false);
  assert.equal(result.go.firstStop, 'ป้ายหมายเลขหนึ่ง');
  assert.equal(result.go.firstStopSource, 'stops[0].name');
  assert.equal(result.back.firstStop, null);
  assert.equal(result.back.departures[0].firstStop, null);
});

test('merged main / A / X route times retain each line-specific first stop', () => {
  const main = directionFromResponse({go:{info:{first_station:'ป้ายหลัก'},timetable:[{time:'06:00'}]},back:{}}, {start:'มีนบุรี',destination:'หัวลำโพง'}, '1-44(113)', false);
  const x = directionFromResponse({go:{info:{first_station:'ป้ายรถเสริม'},timetable:[{time:'06:15'}]},back:{}}, {start:'มีนบุรี',destination:'อนุสาวรีย์'}, '1-44A(113A)', false);
  const result = mergeDirections(main, x, '1-44A(113A)');
  assert.deepEqual(result.go.departures.map(d => [d.route,d.firstStop]), [
    ['1-44(113)', 'ป้ายหลัก'], ['1-44A(113A)', 'ป้ายรถเสริม']
  ]);
});

test('529EX manual terminus correction does not overwrite the first station as actually reported by API', () => {
  const line = directionFromResponse({go:{info:{first_station:'แสมดำ'},timetable:[{time:'06:00'}]},back:{info:{first_station:'หมอชิต 2'},timetable:[{time:'07:00'}]}}, {start:'แสมดำ',destination:'หมอชิต 2'}, '4-29EX(529EX)', true);
  const changed = correctPublishedTerminus('4-29EX(529EX)', line);
  assert.equal(changed.back.origin, 'สุทธิสาร');
  assert.equal(changed.back.departures[0].firstStop, 'หมอชิต 2');
});

test('server supplies firstStop for main and combined route separately', async (t) => {
  const nativeFetch = global.fetch;
  const html = '<select><option value="1-44(113)" data-start="มีนบุรี" data-destination="หัวลำโพง">113</option><option value="1-44A(113A)" data-start="มีนบุรี" data-destination="อนุสาวรีย์ชัยสมรภูมิ">113A</option></select>';
  global.fetch = async (url, opt = {}) => {
    if (!String(url).startsWith('https://information.thaismilebus.com/')) return nativeFetch(url, opt);
    if (opt.method === 'POST') {
      const routeName = new URLSearchParams(opt.body).get('routeName');
      const a = routeName.includes('113A');
      return new Response(JSON.stringify({status:'success',data:{
        go:{ info:{first_station:a?'ป้าย 113A ขาไป':'ป้าย 113 ขาไป'},timetable:[{time:a?'06:15':'06:00'}]},
        back:{info:{first_station:a?'ป้าย 113A ขากลับ':'ป้าย 113 ขากลับ'},timetable:[{time:'07:00'}]}
      } }), {status:200,headers:{'content-type':'application/json'}});
    }
    return new Response(html,{status:200,headers:{'content-type':'text/html'}});
  };
  t.after(() => { global.fetch = nativeFetch; });
  server.listen(0);
  await new Promise(resolve => server.once('listening',resolve));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await nativeFetch(`${origin}/api/schedule?route=1-44%28113%29`);
  assert.equal(response.status,200);
  const data = await response.json();
  assert.deepEqual(data.go.departures.map(x=>[x.route,x.firstStop]),[
    ['1-44(113)','ป้าย 113 ขาไป'],['1-44A(113A)','ป้าย 113A ขาไป']
  ]);
  const htmlResponse = await nativeFetch(`${origin}/`);
  const page = await htmlResponse.text();
  assert.match(page, /goFirstStopNote/);
  assert.match(page, /backFirstStopNote/);
});
