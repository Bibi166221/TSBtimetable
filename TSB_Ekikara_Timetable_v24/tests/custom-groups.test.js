'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { discoverFamily, parseCatalog } = require('../routeCatalog');
const { server } = require('../server');

const routeInfo = [
  ['1-44(113)', 'มีนบุรี', 'หัวลำโพง'],
  ['1-44A(113A)', 'มีนบุรี', 'อนุสาวรีย์ชัยสมรภูมิ'],
  ['S6(555)', 'ท่าอากาศยานสุวรรณภูมิ', 'หมอชิต 2'],
  ['S6A(555A)', 'ท่าอากาศยานสุวรรณภูมิ', 'ท่าอากาศยานดอนเมือง'],
  ['1-56(517)', 'ลาดกระบัง', 'อนุสาวรีย์ชัยสมรภูมิ'],
  ['1-56(517X)', 'ลาดกระบัง', 'หมอชิต 2']
];
const html = '<select>' + routeInfo.map(([route,start,destination]) =>
  `<option value="${route}" data-start="${start}" data-destination="${destination}">${route}</option>`
).join('') + '</select>';

const catalog = parseCatalog(html);
test('113 and 555 each form an independent family, even when A variant requested by public number', () => {
  for (const [value,main,variant] of [
    ['113','1-44(113)','1-44A(113A)'],
    ['113A','1-44(113)','1-44A(113A)'],
    ['1-44A(113A)','1-44(113)','1-44A(113A)'],
    ['555','S6(555)','S6A(555A)'],
    ['555A','S6(555)','S6A(555A)'],
    ['S6A(555A)','S6(555)','S6A(555A)']
  ]) {
    const family=discoverFamily(value,catalog);
    assert.equal(family.primary,main,value);
    assert.deepEqual(family.variantRoutes,[variant],value);
    assert.deepEqual(family.supplementaryRoutes,[],value);
  }
  assert.deepEqual(discoverFamily('517',catalog).variantRoutes,[]);
  assert.equal(discoverFamily('517X',catalog).primary,'1-56(517X)');
});

test('schedule API merges A variants by origin with blue labels; 517 remains separate', async t => {
  const originalFetch=global.fetch;
  const times={
    '1-44(113)': ['06:00','06:40'],
    '1-44A(113A)': ['06:15','06:55'],
    'S6(555)': ['07:00','07:35'],
    'S6A(555A)': ['07:12','07:47'],
    '1-56(517)': ['08:00','08:30'],
    '1-56(517X)': ['08:15','08:45']
  };
  global.fetch=async (url, options={}) => {
    if (!String(url).startsWith('https://information.thaismilebus.com/SchedulePlan'))
      return originalFetch(url,options);
    if (options.method==='POST') {
      const requested = new URLSearchParams(options.body).get('routeName');
      const trip=times[requested];
      if (!trip) return new Response(JSON.stringify({status:'error'}),{status:200});
      return new Response(JSON.stringify({status:'success',updated_date:'2026-11-14',data:{
        go:{timetable:[{time:trip[0]}], info:{first_bus:trip[0],last_bus:trip[0]}},
        back:{timetable:[{time:trip[1]}], info:{first_bus:trip[1],last_bus:trip[1]}}
      }}),{status:200,headers:{'content-type':'application/json'}});
    }
    return new Response(html,{status:200,headers:{'content-type':'text/html'}});
  };
  t.after(() => {global.fetch=originalFetch;});
  server.listen(0);
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(() => server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  async function get(r) {
    const response=await originalFetch(base+'/api/schedule?route='+encodeURIComponent(r));
    assert.equal(response.status,200,r);
    return response.json();
  }
  for (const [alias,baseId,variantId,baseGo,variantGo] of [
    ['113A','1-44(113)','1-44A(113A)','06:00','06:15'],
    ['555','S6(555)','S6A(555A)','07:00','07:12']
  ]) {
    const result=await get(alias);
    assert.equal(result.route,baseId);
    assert.deepEqual(result.variantRoutes,[variantId]);
    assert.deepEqual(result.supplementaryRoutes,[]);
    assert.deepEqual(result.go.departures.map(x=>[x.time,x.serviceType,x.displayLabel||null]),[
      [baseGo,undefined,null], [variantGo,'a-variant',alias==='113A'?'113A':'555A']
    ]);
    assert.equal(result.back.departures.length,1);
    assert.equal(result.extraPanels.length,1);
    assert.equal(result.extraPanels[0].departures[0].serviceType,'a-variant');
    assert.equal(result.extraPanels[0].departures[0].displayLabel,alias==='113A'?'113A':'555A');
  }
  const main517=await get('517');
  const x517=await get('517X');
  assert.equal(main517.route,'1-56(517)');
  assert.deepEqual(main517.go.departures.map(x=>x.time),['08:00']);
  assert.equal(x517.route,'1-56(517X)');
  assert.deepEqual(x517.go.departures.map(x=>x.time),['08:15']);
  assert.deepEqual(x517.supplementaryRoutes,[]);
  assert.deepEqual(x517.variantRoutes,[]);
});
