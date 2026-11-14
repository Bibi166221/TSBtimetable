'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { server } = require('../server');

test('live route discovery keeps 517X separate and unpaired 147X standalone', async (t) => {
  const nativeFetch = global.fetch;
  const routes = [
    ['1-56(517)', 'A', 'B'],
    ['1-56(517X)', 'A', 'C'],
    ['34', 'D', 'E'],
    ['34X', 'D', 'F'],
    ['4-25L(147L)', 'G', 'H'],
    ['4-25R(147R)', 'H', 'G'],
    ['4-25X(147X)', 'G', 'J']
  ];
  const routeHtml = '<select>' + routes.map(([name,start,destination]) =>
    `<option value="${name}" data-start="${start}" data-destination="${destination}">${name}</option>`
  ).join('') + '</select>';
  const departures = {
    '1-56(517)': { go: '06:00', back: '06:30' },
    '1-56(517X)': { go: '06:05', back: '06:35' },
    '34': { go: '07:00', back: '07:30' },
    '34X': { go: '07:05', back: '07:35' },
    '4-25X(147X)': { go: '08:00', back: '08:30' }
  };
  global.fetch = async (url, init = {}) => {
    if (!String(url).startsWith('https://information.thaismilebus.com/SchedulePlan')) return nativeFetch(url, init);
    if (init.method === 'POST') {
      const route = new URLSearchParams(init.body).get('routeName');
      const item = departures[route];
      if (!item) return new Response(JSON.stringify({ status: 'fail' }), {status: 200});
      return new Response(JSON.stringify({
        status: 'success', updated_date: '2026-11-13',
        data: { go: { timetable: [{time: item.go}] }, back: {timetable: [{time: item.back}]} }
      }), {status: 200, headers: {'Content-Type':'application/json'}});
    }
    return new Response(routeHtml, {status: 200, headers: {'Content-Type':'text/html'}});
  };
  t.after(() => { global.fetch = nativeFetch; });
  server.listen(0);
  await new Promise(r => server.once('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async p => {
    const response = await nativeFetch(base+p);
    assert.equal(response.status,200);
    return response.json();
  };
  const list = await get('/api/routes');
  assert.equal(list.count, 7);
  assert.ok(list.routes.some(r => r.route === '34X' && r.baseRoute === '34'));

  const x = await get('/api/schedule?route=1-56(517X)');
  assert.equal(x.route, '1-56(517X)');
  assert.deepEqual(x.supplementaryRoutes, []);
  assert.deepEqual(x.go.departures.map(d => [d.time,d.supplementary]), [['06:05', true]]);
  assert.equal(x.extraPanels.length, 0);
  const main517 = await get('/api/schedule?route=1-56(517)');
  assert.equal(main517.route, '1-56(517)');
  assert.deepEqual(main517.go.departures.map(d => d.time),['06:00']);

  const noParen = await get('/api/schedule?route=34');
  assert.deepEqual(noParen.supplementaryRoutes,['34X']);
  assert.equal(noParen.go.departures.length,2);
  assert.equal(noParen.go.departures[1].supplementary,true);

  const standalone = await get('/api/schedule?route=4-25X(147X)');
  assert.equal(standalone.route,'4-25X(147X)');
  assert.equal(standalone.standaloneX,true);
  assert.equal(standalone.go.departures[0].supplementary,true);
  assert.deepEqual(standalone.supplementaryRoutes,[]);
});
