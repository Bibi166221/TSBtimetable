'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { find34Bangkhen, is34Family, parseCatalog } = require('../routeCatalog');
const { sameStation } = require('../timetableLogic');
const { server } = require('../server');

test('34-related route variants discovered from the real IDs in the route picker', () => {
  const html = `<select><option value="34" data-start="รังสิต" data-destination="หัวลำโพง"></option>
    <option value="34X" data-start="รังสิต" data-destination="แยก คปอ."></option>
    <option value="1-3 (34เสริม)" data-start="บางเขน" data-destination="หัวลำโพง"></option>
    <option value="1-2E(34E)" data-start="รังสิต" data-destination="หัวลำโพง"></option></select>`;
  const catalog = parseCatalog(html);
  assert.equal(find34Bangkhen(catalog),'1-3 (34เสริม)');
  assert.equal(is34Family('34'),true);
  assert.equal(is34Family('34X'),true);
  assert.equal(is34Family('1-3(34)'),true);
  assert.equal(is34Family('1-3 (34เสริม)'),true);
  assert.equal(is34Family('1-2E(34E)'),false);
  assert.equal(sameStation('สถานีกรุงเทพ (หัวลำโพง)', 'หัวลำโพง'),true);
  assert.equal(sameStation('รังสิต','มหาวิทยาลัยธรรมศาสตร์ (ศูนย์รังสิต)'),false);
});

test('34 family: blue Bangkhen joins Hua Lamphong; red X joins Rangsit, distinct origins get separate boxes; 34E independent', async t => {
  const nativeFetch = global.fetch;
  const names = [
    ['34','รังสิต','หัวลำโพง'],
    ['34X','รังสิต','แยก คปอ.'],
    ['1-3 (34เสริม)','บางเขน','หัวลำโพง'],
    ['1-2E(34E)','รังสิต','หัวลำโพง']
  ];
  const catalogHtml = '<select>' + names.map(([route,start,dest]) =>
    `<option value="${route}" data-start="${start}" data-destination="${dest}">${route}</option>`).join('') + '</select>';
  const samples = {
    '34':['05:00','05:40'],
    '34X':['05:10','05:50'],
    '1-3 (34เสริม)':['05:20','05:55'],
    '1-2E(34E)':['05:30','06:00']
  };
  global.fetch = async (url, opts={}) => {
    if (!String(url).startsWith('https://information.thaismilebus.com/SchedulePlan')) return nativeFetch(url, opts);
    if (opts.method === 'POST') {
      const route = new URLSearchParams(opts.body).get('routeName');
      const times = samples[route];
      if (!times) return new Response(JSON.stringify({ status: 'fail' }), {status: 200});
      return new Response(JSON.stringify({
        status:'success', updated_date:'2026-11-14',
        data:{ go: {info:{first_bus:'05:00',last_bus:'22:00'},timetable:[{time:times[0]}]},
               back:{info:{first_bus:'05:00',last_bus:'22:00'},timetable:[{time:times[1]}]} }
      }), {status:200,headers:{'Content-Type':'application/json'}});
    }
    return new Response(catalogHtml,{status:200,headers:{'Content-Type':'text/html'}});
  };
  t.after(() => {global.fetch = nativeFetch;});
  server.listen(0);
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async r => {
    const response = await nativeFetch(base + '/api/schedule?route=' + encodeURIComponent(r));
    assert.equal(response.status,200);
    return response.json();
  };
  const board = await get('34');
  assert.equal(board.route,'34');
  assert.deepEqual(board.supplementaryRoutes,['34X']);
  assert.deepEqual(board.relatedRoutes,['1-3 (34เสริม)']);
  assert.deepEqual(board.go.departures.map(d=>[d.route,d.time,d.supplementary,d.serviceType||null]),
    [['34','05:00',false,null],['34X','05:10',true,null]]);
  assert.deepEqual(board.back.departures.map(d=>[d.route,d.time,d.supplementary,d.serviceType||null]),
    [['34','05:40',false,null],['1-3 (34เสริม)','05:55',false,'bangkhen']]);
  assert.equal(board.extraPanels.length,2);
  const byOrigin = Object.fromEntries(board.extraPanels.map(p=>[p.origin,p]));
  assert.equal(byOrigin['แยก คปอ.'].departures[0].supplementary,true);
  assert.equal(byOrigin['บางเขน'].departures[0].serviceType,'bangkhen');
  assert.equal(byOrigin['บางเขน'].departures[0].displayLabel,'บางเขน');
  const x = await get('34X');
  assert.equal(x.route,'34');
  const sub = await get('1-3 (34เสริม)');
  assert.equal(sub.route,'34');
  const express = await get('1-2E(34E)');
  assert.equal(express.route,'1-2E(34E)');
  assert.deepEqual(express.supplementaryRoutes,[]);
  assert.deepEqual(express.relatedRoutes,[]);
  assert.equal(express.go.departures.length,1);
});
