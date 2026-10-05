export const STEP = 600_000;
export const MAX_WINDOW = 48 * 60;
export interface Station { id:string; name:string; municipality:string; province:string; lat:number; lon:number; elevation:number|null; sensorHeight:number|null; sensorId:string|null; eligible:boolean; }
export interface Observation { stationId:string; start:number; mm:number|null; quality:string; }
export interface Total { mm:number|null; available:number; expected:number; complete:boolean; qualityIssues:number; state:'zero'|'rain'|'partial'|'none'; }
export interface StationTotal extends Station, Total { latest:number|null; stale:boolean; }
export interface Status { source:string; running:boolean; lastAttempt:number|null; lastSuccess:number|null; newestMeasurement:number|null; oldestMeasurement:number|null; errors:number; lastError:string|null; fetchedDays:number; eligible:number; inventory:number; serverTime:number; }
export interface Snapshot { stations:StationTotal[]; status:Status; end:number; start:number; }
