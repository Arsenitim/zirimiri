import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DateTime } from 'luxon';
import { ZONE } from '../shared/time';
import { STEP, type Station, type Observation, type Status } from '../shared/types';
export class Store {
  db:DatabaseSync;
  constructor(path:string){
    if(path!==':memory:') mkdirSync(dirname(path),{recursive:true});
    this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS stations(id TEXT PRIMARY KEY, json TEXT NOT NULL, eligible INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS observations(stationId TEXT NOT NULL, start INTEGER NOT NULL, mm REAL, quality TEXT NOT NULL, ingestedAt INTEGER NOT NULL, PRIMARY KEY(stationId,start));
      CREATE INDEX IF NOT EXISTS observation_time ON observations(start,stationId);
      CREATE TABLE IF NOT EXISTS fetched(stationId TEXT NOT NULL, day TEXT NOT NULL, fetchedAt INTEGER NOT NULL, status INTEGER NOT NULL, PRIMARY KEY(stationId,day));
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  }
  stations(eligibleOnly=false):Station[]{return this.db.prepare(`SELECT json,eligible FROM stations ${eligibleOnly?'WHERE eligible=1':''} ORDER BY id`).all().map(r=>({...JSON.parse(r.json as string),eligible:!!r.eligible}));}
  saveStation(s:Station){
    const old=this.db.prepare('SELECT json,eligible FROM stations WHERE id=?').get(s.id);
    const prior=old?JSON.parse(old.json as string):null;
    const merged={...s,sensorHeight:s.sensorHeight??prior?.sensorHeight??null,sensorId:s.sensorId??prior?.sensorId??null,eligible:s.eligible||!!old?.eligible};
    this.db.prepare('INSERT INTO stations VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json,eligible=excluded.eligible').run(s.id,JSON.stringify(merged),Number(merged.eligible));
  }
  fetchedAt(id:string,day:string){return this.db.prepare('SELECT fetchedAt,status FROM fetched WHERE stationId=? AND day=?').get(id,day) as {fetchedAt:number;status:number}|undefined;}
  replaceDay(id:string,day:string,rows:Observation[],now=Date.now()){
    const start=DateTime.fromISO(day,{zone:ZONE}).startOf('day'),end=start.plus({days:1});
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare('DELETE FROM observations WHERE stationId=? AND start>=? AND start<?').run(id,start.toMillis(),end.toMillis());
      const upsert=this.db.prepare('INSERT INTO observations VALUES(?,?,?,?,?) ON CONFLICT(stationId,start) DO UPDATE SET mm=excluded.mm,quality=excluded.quality,ingestedAt=excluded.ingestedAt');
      for(const r of rows) upsert.run(r.stationId,r.start,r.mm,r.quality,now);
      this.markFetched(id,day,200,now);
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  markFetched(id:string,day:string,status:number,now=Date.now()){this.db.prepare('INSERT INTO fetched VALUES(?,?,?,?) ON CONFLICT(stationId,day) DO UPDATE SET fetchedAt=excluded.fetchedAt,status=excluded.status').run(id,day,now,status);}
  range(start:number,end:number,id?:string):Observation[]{return this.db.prepare(`SELECT stationId,start,mm,quality FROM observations WHERE start>=? AND start<? ${id?'AND stationId=?':''} ORDER BY start`).all(...(id?[start,end,id]:[start,end])) as unknown as Observation[];}
  latest():Map<string,number>{return new Map(this.db.prepare('SELECT stationId,MAX(start)+? AS latest FROM observations WHERE mm IS NOT NULL GROUP BY stationId').all(STEP).map(r=>[r.stationId as string,r.latest as number]));}
  set(key:string,value:unknown){this.db.prepare('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
  get<T>(key:string,fallback:T):T{const row=this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key);return row?JSON.parse(row.value as string):fallback;}
  prune(days:number){const cutoff=Date.now()-Math.max(18,days)*86400000;this.db.prepare('DELETE FROM observations WHERE start<?').run(cutoff);this.db.prepare('DELETE FROM fetched WHERE day<?').run(DateTime.fromMillis(cutoff,{zone:ZONE}).toISODate()!);}
  status(running=false):Status {
    const bounds=this.db.prepare('SELECT MIN(start) AS oldest,MAX(start)+? AS newest FROM observations WHERE mm IS NOT NULL').get(STEP)!;
    return {source:'Euskalmet public station viewer',running,lastAttempt:this.get('lastAttempt',null),lastSuccess:this.get('lastSuccess',null),lastError:this.get('lastError',null),errors:this.get('errors',0),newestMeasurement:bounds.newest as number|null,oldestMeasurement:bounds.oldest as number|null,eligible:this.stations(true).length,inventory:this.stations().length,fetchedDays:Number(this.db.prepare('SELECT COUNT(*) AS n FROM fetched WHERE status=200').get()!.n),serverTime:Date.now()};
  }
}
