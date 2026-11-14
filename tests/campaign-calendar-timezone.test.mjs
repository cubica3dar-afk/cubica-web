import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {harness} from "./campaign-test-harness.mjs";

if(process.argv.includes("--snapshot")){
  const h=harness({campaigns:[
    {id:"one",name:"Única",state:"draft",priority:2,recurrence_mode:"none",starts_at:"2026-12-01T02:30:00Z",ends_at:"2026-12-01T03:30:00Z"},
    {id:"year",name:"Anual",state:"published",priority:1,recurrence_mode:"annual",annual_start_month:12,annual_start_day:20,annual_start_time:"00:00:00",annual_end_month:1,annual_end_day:10,annual_end_time:"00:00:00"},
    {id:"custom",name:"Fechas",state:"disabled",priority:0,recurrence_mode:"custom"}
  ],occurrences:[{campaign_id:"custom",starts_at:"2026-11-30T02:59:00Z",ends_at:"2026-11-30T03:01:00Z"}]});
  const snapshots=[];
  for(const month of ["2026-11","2026-12","2027-01","2028-02"]){h.i.state.calendarCursor=month;snapshots.push(h.i.monthCalendarV2(h.i.state.admin.campaigns));}
  snapshots.push(h.i.localToIso("2026-11-13T00:00"),h.i.localToIso("2008-01-15T00:00"));
  process.stdout.write(JSON.stringify(snapshots));
}else{
  let baseline;
  for(const zone of ["UTC","America/Los_Angeles","Asia/Tokyo","America/Argentina/Buenos_Aires"]){
    const result=execFileSync(process.execPath,[fileURLToPath(import.meta.url),"--snapshot"],{encoding:"utf8",env:{...process.env,TZ:zone}});
    if(baseline)assert.equal(result,baseline,"Calendar changed with browser/host time zone "+zone);else baseline=result;
    console.log("✓ Calendario y conversión Buenos Aires idénticos con TZ="+zone);
  }
  const snapshots=JSON.parse(baseline);
  assert.match(snapshots[0],/2026-11-30: Única/);assert.match(snapshots[1],/2026-12-01: Única/);
  assert.match(snapshots[0],/2026-11-29: Fechas/);assert.match(snapshots[0],/2026-11-30: [^"]*Fechas/);
  assert.equal(snapshots.at(-1),"2008-01-15T02:00:00.000Z","IANA historical DST, not fixed -03");
}
