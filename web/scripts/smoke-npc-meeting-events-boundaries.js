'use strict';
// Boundary regressions use shipped modules and canonical intervals. The
// controlled-role and exhausted-day setup is explicit low-level fixture data.
const assert = require('node:assert/strict');
const { dailyFixture } = require('./lib-npc-daily-fixture');
function advance(c, days) {
  c.P.time.daysPerTurn=days;
  const interval=c.TM.SimTime.prepare(c.GM);c.GM.turn++;
  assert.equal(c.TM.SimTime.commit(c.GM,interval).ok,true);
  c.GM.busy=true;c.GM._endTurnBusy=true;
  const r=c.TM.NPC.ActionLedger.advance(c.GM);
  c.GM.busy=false;c.GM._endTurnBusy=false;
  assert.equal(r.ok,true,r.reason);return interval;
}
function sourceFixture() {
  const c=dailyFixture(),D=c.TM.NPC.DailyActivities;
  c.GM.mapData.regions[0].geographicCenter=[116,40];c.GM.mapData.regions[0].neighbors=['place-b'];
  c.GM.mapData.regions[1].geographicCenter=[117,40];c.GM.mapData.regions[1].neighbors=['place-a'];
  c.TM.SimTime.ensure(c.GM);
  const a=c.add('boundary:a','甲'),b=c.add('boundary:b','乙');
  c.GM.affinityMap={ [['甲','乙'].sort().join('|')]:70 };
  const request=D.submitNPC(a,{actionId:'boundary:source',activityKind:'assistance',targetId:b.id,
    task:{kind:'material_summary',title:'整理本人已有资料',materialRefs:[{kind:'character_public',characterId:a.id}]}});
  assert.equal(request.outcome,'submitted',request.reason);let p=D.get(request.planId);
  advance(c,1);assert.equal(c.step(b,p,'respond','accept').outcome,'submitted');
  advance(c,1);assert.equal(c.step(b,p,'perform').outcome,'submitted');
  advance(c,1);assert.equal(c.step(a,p,'feedback','satisfied').outcome,'completed');advance(c,1);
  const opportunity=D.consultationOpportunities(a).find(x=>x.action.targetId===b.id);assert(opportunity);
  c.load('tm-npc-local-ai.js');
  return {c,D,a,b,opportunity};
}
function invite(f,human,terms) {
  const {c,D,a,b,opportunity}=f;
  const command={actionId:'boundary:meeting',activityKind:'meeting',targetId:b.id,
    meeting:{locationId:'place-a',requestedStartDay:D.day()+4,durationDays:2,windowDays:3,
      discussion:{topicId:opportunity.action.consultation.topicId,sourceOpportunity:opportunity.action.consultation.sourceOpportunity,preferredExchange:'question'}}};
  Object.assign(command.meeting,terms||{});
  const result=human?D.submitHuman(D.ticket(a,command),{}):D.submitNPC(a,command);
  assert.equal(result.outcome,'submitted',result.reason);return D.get(result.planId);
}
let passed=0,failed=0;
function test(name,fn){try{fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name, e.stack);}}
test('common player identity never implies automatic departure',()=>{
  const f=sourceFixture(),{c,D,a}=f;c.GM.playerInfo={characterId:a.id};
  assert(D.controlled(a));assert.equal(a.isPlayer,undefined);
  const p=invite(f,true);
  assert.equal(p.localActivity.meeting.actorDeparturePolicy,'manual');
});
test('a spent day postpones an event action rather than permanently poisoning its revision',()=>{
  const f=sourceFixture(),{c,D,b}=f,p=invite(f,false);
  while(D.budget(b).steps<D.config.dailySteps)assert(D.spend(b,false));
  advance(c,1);advance(c,1);
  const current=D.get(p.id);
  assert(current.localActivity.meeting.targetDecision,'the new simulation day restores the lawful response opportunity');
  assert.equal(current.localActivity.meeting.targetDecision.response,'accept');
  advance(c,12);
  assert.equal(D.get(p.id).status,'done','the accepted event continues to actual discussion');
});
test('budget waiting survives replay and reload without repeated submissions on the same day',()=>{
  const f=sourceFixture(),{c,D,b}=f,p=invite(f,false);
  while(D.budget(b).steps<D.config.dailySteps)assert(D.spend(b,false));
  assert.equal(c.TM.NPC.ActionLedger.advance(c.GM).ok,true);
  assert.equal(D.get(p.id).localActivity.meeting.eventRetryReason,'daily_activity_budget');
  assert.equal(D.get(p.id).localActivity.meeting.nextEventRetryDay,Math.floor(D.day())+1);
  const steps=D.get(p.id).steps.length;
  for(let i=0;i<3;i++)assert.equal(c.TM.NPC.ActionLedger.advance(c.GM).ok,true);
  assert.equal(D.get(p.id).steps.length,steps,'a replay does not manufacture a new attempt');
  c.GM=JSON.parse(JSON.stringify(c.GM)); // The formal disk roundtrip is covered by Electron.
  assert.equal(c.TM.NPC.ActionLedger.advance(c.GM).ok,true);
  assert.equal(D.get(p.id).steps.length,steps);
  advance(c,1);
  assert.equal(D.get(p.id).steps.filter(x=>x.phase==='respond').length,1,'the new day releases exactly one real response');
  assert.equal(D.get(p.id).localActivity.meeting.nextEventRetryDay,undefined);
});
test('a departed partner cannot leave a false mandatory player reply blocking time',()=>{
  const f=sourceFixture(),{c,D,a,b}=f;b.playerControlled=true;
  const p=invite(f,false);
  assert.equal(D.submitHuman(D.ticket(b,{planId:p.id,phase:'respond'}),{response:'accept'}).outcome,'submitted');
  advance(c,30);advance(c,30);
  assert.equal(c.TM.NPC.Meetings.pendingPlayerChoice().phase,'discuss_response');
  const journey=c.TM.NPC.Meetings.startExternalJourney(a,{id:'actual:outside',planId:'outside-duty',toRegionId:'place-b',mode:'walking'});
  assert.equal(journey.status,'in_transit');
  assert.equal(c.TM.NPC.Meetings.pendingPlayerChoice(),null,'no reply is physically available after the speaker leaves');
  assert.equal(D.view(D.get(p.id),b).nextPhase,'');
  advance(c,1);
  assert.notEqual(D.get(p.id).localActivity.meeting.discussion.status,'completed');
  assert.equal(D.get(p.id).localActivity.meeting.discussion.result,null);
  advance(c,5);
  assert.equal(D.get(p.id).status,'ended','the interrupted private meeting does not wait forever for a second competing return journey');
  assert.equal(D.person(a.id)._officeJourney.id,journey.id,'the actual new journey is preserved');
});
test('a player with a spent workday can reach the next real day and answer within the same appointment',()=>{
  const f=sourceFixture(),{c,D,a}=f;c.GM.playerInfo={characterId:a.id};const p=invite(f,true);
  for(let i=0;i<8&&!c.TM.NPC.Meetings.pendingPlayerChoice();i++){
    advance(c,30);const current=D.person(a.id),v=D.view(D.get(p.id),current);
    if(v.nextPhase==='depart')assert.equal(D.submitHuman(D.ticket(current,{planId:p.id,phase:'depart'}),{}).outcome,'started');
  }
  const before=D.day(),end=D.get(p.id).localActivity.meeting.endDay;
  while(D.budget(D.person(a.id)).steps<D.config.dailySteps)assert(D.spend(D.person(a.id),false));
  assert.equal(D.submitHuman(D.ticket(D.person(a.id),{planId:p.id,phase:'discuss'}),{exchangeChoice:'question'}).reason,'daily_activity_budget');
  assert.equal(c.TM.NPC.Meetings.pendingPlayerChoice(),null,'an impossible current action must not block time');
  const interval=advance(c,30);
  assert.equal(interval.toDay,Math.floor(before)+1);assert.equal(D.get(p.id).localActivity.meeting.endDay,end,'no extra appointment time is granted');
  assert.equal(c.TM.NPC.Meetings.pendingPlayerChoice().phase,'discuss');
  assert.equal(D.submitHuman(D.ticket(D.person(a.id),{planId:p.id,phase:'discuss'}),{exchangeChoice:'question'}).outcome,'submitted');
  for(let i=0;i<4&&D.get(p.id).status!=='done';i++)advance(c,30);
  assert.equal(D.get(p.id).status,'done');assert.equal(D.get(p.id).steps.filter(x=>x.phase==='discuss').length,1);
});
test('a budget reset beyond the agreed end cannot extend the meeting or invent an answer',()=>{
  const f=sourceFixture(),{c,D,a}=f;c.GM.playerInfo={characterId:a.id};const p=invite(f,true,{durationDays:0.5});
  for(let i=0;i<8&&!c.TM.NPC.Meetings.pendingPlayerChoice();i++){
    advance(c,30);const current=D.person(a.id),v=D.view(D.get(p.id),current);
    if(v.nextPhase==='depart')D.submitHuman(D.ticket(current,{planId:p.id,phase:'depart'}),{});
  }
  const end=D.get(p.id).localActivity.meeting.endDay;
  while(D.budget(D.person(a.id)).steps<D.config.dailySteps)assert(D.spend(D.person(a.id),false));
  assert.equal(c.TM.NPC.Meetings.pendingPlayerChoice(),null);
  const interval=advance(c,30);assert.equal(interval.toDay,end);
  const current=D.get(p.id);assert.equal(current.status,'ended');assert.equal(current.localActivity.meeting.discussion.outcome,'not_started');
  assert.equal(current.localActivity.meeting.discussion.result,null);assert.equal(current.steps.filter(x=>/^discuss/.test(x.phase)).length,0);
});
test('a bounded group does not lose valid discussions merely because one interval uses one CPU batch',()=>{
  function run(split){
    const c=dailyFixture(),D=c.TM.NPC.DailyActivities; c.TM.SimTime.ensure(c.GM);
    c.GM.mapData.regions[0].geographicCenter=[116,40];c.GM.affinityMap={};
    const pairs=[];
    for(let i=0;i<30;i++){
      const a=c.add('many:a:'+i,'甲'+i),b=c.add('many:b:'+i,'乙'+i);
      c.GM.affinityMap[[a.name,b.name].sort().join('|')]=70;
      const r=D.submitNPC(a,{actionId:'many:source:'+i,activityKind:'assistance',targetId:b.id,
        task:{kind:'material_summary',title:'各自资料',materialRefs:[{kind:'character_public',characterId:a.id}]}});
      assert.equal(r.outcome,'submitted',r.reason);pairs.push({a,b,sourceId:r.planId});
    }
    advance(c,1);pairs.forEach(x=>assert.equal(c.step(x.b,D.get(x.sourceId),'respond','accept').outcome,'submitted'));
    advance(c,1);pairs.forEach(x=>assert.equal(c.step(x.b,D.get(x.sourceId),'perform').outcome,'submitted'));
    advance(c,1);pairs.forEach(x=>assert.equal(c.step(x.a,D.get(x.sourceId),'feedback','satisfied').outcome,'completed'));
    advance(c,1);c.load('tm-npc-local-ai.js');
    pairs.forEach((x,i)=>{
      const opportunity=D.consultationOpportunities(x.a).find(v=>v.action.targetId===x.b.id);assert(opportunity);
      const r=D.submitNPC(x.a,{actionId:'many:meeting:'+i,activityKind:'meeting',targetId:x.b.id,
        meeting:{locationId:'place-a',requestedStartDay:D.day()+4,durationDays:1,windowDays:3,
          discussion:{topicId:opportunity.action.consultation.topicId,sourceOpportunity:opportunity.action.consultation.sourceOpportunity}}});
      assert.equal(r.outcome,'submitted',r.reason);x.id=r.planId;
    });
    const started=process.hrtime.bigint(),beforeBytes=Buffer.byteLength(JSON.stringify(c.GM));
    if(split)for(let i=0;i<30;i++)advance(c,1);else advance(c,30);
    const results=pairs.map(x=>{const p=D.get(x.id),d=p.localActivity.meeting.discussion;
      assert.equal(p.steps.filter(s=>s.phase==='discuss').length,1);assert.equal(p.steps.filter(s=>s.phase==='discuss_response').length,1);
      assert.equal(d.result.day,8.5);return{id:x.id,status:p.status,discussion:d.status,resultDay:d.result.day};});
    assert.equal(c.apiAttempts.length,0);
    console.log(JSON.stringify({fixture:'synthetic-60-people-30-days',segmented:split,days:30,meetings:30,
      complete:results.filter(x=>x.status==='done').length,modelAttempts:c.apiAttempts.length,
      elapsedMs:Number(process.hrtime.bigint()-started)/1e6,saveGrowthBytes:Buffer.byteLength(JSON.stringify(c.GM))-beforeBytes}));
    return results;
  }
  const long=run(false),split=run(true);
  assert.deepEqual(long,split,'same valid arrangements and simulation days must retain the same completed content');
  assert.equal(long.filter(x=>x.status==='done').length,30);
});
console.log(JSON.stringify({suite:'meeting-event-boundaries',passed,failed}));if(failed)process.exitCode=1;
