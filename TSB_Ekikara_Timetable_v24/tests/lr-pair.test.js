'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCatalog, circularSignature, discoverCircularPair } = require('../routeCatalog');
const { directionFromResponse, buildCircularBoards } = require('../timetableLogic');
const { server } = require('../server');

const html = `<select>
<option value="4-25L(147L)" data-start="วงเวียน A" data-destination="วงเวียน B">147L</option>
<option value="4-25R(147R)" data-start="วงเวียน C" data-destination="วงเวียน D">147R</option>
<option value="4-25X(147X)" data-start="วงเวียน A" data-destination="ปลายทาง X">147X</option>
<option value="2-2(8L)" data-start="X" data-destination="Y">8L</option>
<option value="2-2(8R)" data-start="Y" data-destination="X">8R</option>
<option value="55L" data-start="X" data-destination="Y">55L</option>
<option value="44R" data-start="X" data-destination="Y">44R</option>
<option value="34" data-start="รังสิต" data-destination="หัวลำโพง">34</option>
<option value="34X" data-start="รังสิต" data-destination="คปอ">34X</option>
</select>`;
const catalog = parseCatalog(html);

test('matches a verified L/R pair by both suffixes, either request or public number', () => {
  assert.deepEqual(circularSignature('4-25L(147L)'),{side:'L',stem:'4-25(147)'});
  assert.deepEqual(circularSignature('4-25R(147R)'),{side:'R',stem:'4-25(147)'});
  assert.deepEqual(circularSignature('2-2(8L)'),{side:'L',stem:'2-2(8)'});
  assert.deepEqual(circularSignature('55L'),{side:'L',stem:'55'});
  assert.equal(circularSignature('4-25X(147X)'),null);
  assert.equal(circularSignature('4-25L(147R)'),null);
  for (const requested of ['4-25L(147L)','4-25R(147R)','147L','147R']) {
    assert.deepEqual(discoverCircularPair(requested,catalog),{
      left:'4-25L(147L)',right:'4-25R(147R)',publicLeft:'147L',publicRight:'147R'
    });
  }
  assert.equal(discoverCircularPair('4-25X(147X)',catalog),null);
  assert.equal(discoverCircularPair('55L',catalog),null); // no 55R
  assert.equal(discoverCircularPair('44R',catalog),null); // no 44L
  assert.equal(discoverCircularPair('34',catalog),null);
  assert.deepEqual(discoverCircularPair('2-2(8L)',catalog),{
    left:'2-2(8L)',right:'2-2(8R)',publicLeft:'8L',publicRight:'8R'
  });
});

test('places the L route on left and R route on right using each API first stop', () => {
  const l = directionFromResponse({
    go: {info:{first_station:'ป้าย L ขาไป'},timetable:[{time:'05:10'}]},
    back: {info:{first_station:'ป้าย L ขากลับ'},timetable:[{time:'06:20'}]}
  },{start:'วงเวียน A',destination:'วงเวียน B'},'4-25L(147L)',false);
  const r = directionFromResponse({
    go: {info:{first_station:'ป้าย R ขาไป'},timetable:[{time:'05:15'}]},
    back: {info:{first_station:'ป้าย R ขากลับ'},timetable:[{time:'06:25'}]}
  },{start:'วงเวียน C',destination:'วงเวียน D'},'4-25R(147R)',false);
  const boards = buildCircularBoards('4-25L(147L)',l,'4-25R(147R)',r);
  assert.equal(boards.go.firstStop,'ป้าย L ขาไป');
  assert.equal(boards.back.firstStop,'ป้าย R ขาไป');
  assert.deepEqual(boards.go.departures.map(d=>[d.time,d.route,d.firstStop]),[['05:10','4-25L(147L)','ป้าย L ขาไป']]);
  assert.deepEqual(boards.back.departures.map(d=>[d.time,d.route,d.firstStop]),[['05:15','4-25R(147R)','ป้าย R ขาไป']]);
  assert.deepEqual(boards.extraPanels.map(d=>[d.circularSide,d.departures[0].firstStop]),[
    ['L','ป้าย L ขากลับ'],['R','ป้าย R ขากลับ']
  ]);
});

test('if a circular route has only back direction timetable, use it without losing its stop', () => {
  const l = directionFromResponse({go:{},back:{info:{first_station:'L only back'},timetable:[{time:'04:40'}]}},{start:'A',destination:'B'},'33L',false);
  const r = directionFromResponse({go:{info:{first_station:'R only go'},timetable:[{time:'05:50'}]},back:{}},{start:'B',destination:'A'},'33R',false);
  const boards = buildCircularBoards('33L',l,'33R',r);
  assert.equal(boards.go.departures[0].time,'04:40');
  assert.equal(boards.go.departures[0].firstStop,'L only back');
  assert.equal(boards.extraPanels.length,0);
});

test('live server pairs both route IDs, includes own first stop and preserves secondary direction', async t => {
  const nativeFetch = global.fetch;
  global.fetch = async (url, opts={}) => {
    if (!String(url).startsWith('https://information.thaismilebus.com/SchedulePlan')) return nativeFetch(url,opts);
    if (opts.method === 'POST') {
      const routeName = new URLSearchParams(opts.body).get('routeName');
      if (routeName === '4-25X(147X)') return new Response(JSON.stringify({status:'success', data:{
        go:{info:{first_station:'ป้าย X'},timetable:[{time:'06:40'}]}, back:{}
      }}),{status:200,headers:{'content-type':'application/json'}});
      const l = routeName==='4-25L(147L)', r = routeName==='4-25R(147R)';
      if (!l && !r) return new Response(JSON.stringify({status:'error'}),{status:200});
      return new Response(JSON.stringify({status:'success',updated_date:'2026-11-14',data:{
        go:{info:{first_station:l?'ป้าย L ต้นทาง':'ป้าย R ต้นทาง',first_bus:'05:00',last_bus:'23:00'},timetable:[{time:l?'05:00':'05:05'}]},
        back:{info:{first_station:l?'ป้าย L กลับ':'ป้าย R กลับ'},timetable:[{time:l?'06:00':'06:05'}]}
      }}),{status:200,headers:{'content-type':'application/json'}});
    }
    return new Response(html,{status:200,headers:{'content-type':'text/html'}});
  };
  t.after(() => {global.fetch=nativeFetch;});
  server.listen(0);
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>server.close());
  const address=`http://127.0.0.1:${server.address().port}`;
  for (const chosen of ['4-25L(147L)','4-25R(147R)','147L','147R']) {
    const response=await nativeFetch(`${address}/api/schedule?route=${encodeURIComponent(chosen)}`);
    assert.equal(response.status,200,chosen);
    const data=await response.json();
    assert.deepEqual(data.circularPair,{left:'4-25L(147L)',right:'4-25R(147R)',publicLeft:'147L',publicRight:'147R'});
    assert.equal(data.go.departures[0].firstStop,'ป้าย L ต้นทาง');
    assert.equal(data.back.departures[0].firstStop,'ป้าย R ต้นทาง');
    assert.deepEqual(data.extraPanels.map(panel=>panel.departures[0].firstStop),['ป้าย L กลับ','ป้าย R กลับ']);
    assert.equal(data.extraPanels.length,2);
    assert.deepEqual(data.supplementaryRoutes,[]);
  }
  const xResponse=await nativeFetch(`${address}/api/schedule?route=${encodeURIComponent('4-25X(147X)')}`);
  assert.equal(xResponse.status,200);
  assert.equal((await xResponse.json()).circularPair,undefined);
  const root=await (await nativeFetch(address+'/')).text();
  assert.match(root,/goFirstStopNote/);
  assert.match(root,/backFirstStopNote/);
  assert.match(root,/goHeading/);
  assert.match(root,/backHeading/);
});
