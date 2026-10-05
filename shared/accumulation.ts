import { STEP, MAX_WINDOW, type Observation, type Total } from './types';
export function validateWindow(end:number,minutes:number) {
  if(!Number.isSafeInteger(end)||end%STEP!==0||!Number.isInteger(minutes)||minutes<10||minutes>MAX_WINDOW||minutes%10!==0) throw new Error('End must align to 10 minutes; duration must be a multiple of 10, from 10 to 2880 minutes.');
}
// Interval amounts use [start, start+10min). Sum exactly the slots contained in [T-W,T).
export function accumulate(records:Observation[],end:number,minutes:number):Total {
  validateWindow(end,minutes);
  const start=end-minutes*60_000, slots=new Map<number,Observation>();
  for(const o of records) if(o.start>=start&&o.start<end&&o.start%STEP===0) slots.set(o.start,o);
  let available=0, sum=0, qualityIssues=0;
  for(let at=start;at<end;at+=STEP){
    const o=slots.get(at);
    if(o && o.mm!==null && Number.isFinite(o.mm) && o.mm>=0 && o.quality==='provisional'){available++;sum+=o.mm;}
    else if(o && o.quality!=='missing') qualityIssues++;
  }
  const expected=minutes/10, complete=available===expected;
  return {mm:available?Math.round(sum*1000)/1000:null,available,expected,complete,qualityIssues,state:!available?'none':!complete?'partial':sum===0?'zero':'rain'};
}
