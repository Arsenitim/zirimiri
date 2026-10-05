import 'dotenv/config';
import express from 'express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { Store } from './store';
import { Ingestion } from './ingestion';
import { accumulate, validateWindow } from '../shared/accumulation';
import { STEP } from '../shared/types';
import { timelineEnd } from '../shared/time';
const app=express(),store=new Store(process.env.DATABASE_PATH||'data/zirimiri.sqlite'),ingestion=new Ingestion(store);
app.disable('x-powered-by');
app.get('/api/status',(_req,res)=>res.json(store.status(ingestion.running)));
app.get('/api/stations',(req,res)=>{
  const end=Number(req.query.end||timelineEnd()),minutes=Number(req.query.minutes||60);
  try{validateWindow(end,minutes);}catch(e){return res.status(400).json({error:(e as Error).message});}
  if(end>timelineEnd()||end<timelineEnd()-14*86400000)return res.status(400).json({error:'Time must be within the last 14 days.'});
  const start=end-minutes*60000,records=store.range(start,end),byStation=new Map<string,typeof records>();
  for(const r of records){const rows=byStation.get(r.stationId)||[];rows.push(r);byStation.set(r.stationId,rows);}
  const latest=store.latest();
  res.json({end,start,status:store.status(ingestion.running),stations:store.stations(true).map(s=>({...s,...accumulate(byStation.get(s.id)||[],end,minutes),latest:latest.get(s.id)||null,stale:!latest.has(s.id)||Date.now()-latest.get(s.id)!>60*60000}))});
});
app.get('/api/stations/:id/observations',(req,res)=>{
  if(!store.stations(true).some(s=>s.id===req.params.id))return res.status(404).json({error:'Unknown precipitation station'});
  const end=timelineEnd();res.json({observations:store.range(end-14*86400000,end,req.params.id),start:end-14*86400000,end,intervalMs:STEP});
});
if(existsSync('dist/index.html')){app.use(express.static(resolve('dist')));app.get('/{*path}',(_req,res)=>res.sendFile(resolve('dist/index.html')));}
app.listen(Number(process.env.PORT)||3001,process.env.HOST||'127.0.0.1',()=>console.log('zirimiri server listening on port '+(process.env.PORT||3001)));
ingestion.start();
