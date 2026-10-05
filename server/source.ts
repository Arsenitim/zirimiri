import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { localSlot } from "../shared/time";
import { STEP, type Station, type Observation } from "../shared/types";
export const BASE = "https://www.euskalmet.euskadi.eus";
export class SourceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
let nextRequest = 0;
export async function requestJson(
  url: string,
  auth?: string,
): Promise<unknown> {
  const delay = Math.max(250, Number(process.env.REQUEST_DELAY_MS) || 350);
  await new Promise((r) =>
    setTimeout(r, Math.max(0, nextRequest - Date.now())),
  );
  nextRequest = Date.now() + delay;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(20000),
        headers: {
          "User-Agent": "zirimiri/0.1 (+https://github.com/Arsenitim/zirimiri)",
          ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
        },
      });
      if (!r.ok)
        throw new SourceError(r.status, `Euskalmet returned HTTP ${r.status}`);
      const bytes = await r.arrayBuffer();
      let body = new TextDecoder("utf-8", { fatal: true });
      let text: string;
      try {
        text = body.decode(bytes);
      } catch {
        text = new TextDecoder("windows-1252").decode(bytes);
      }
      return JSON.parse(text);
    } catch (e) {
      if (e instanceof SourceError && e.status < 500 && e.status !== 429)
        throw e;
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
  throw new Error("Source unavailable");
}
export interface RainField {
  name: string;
  station: string;
  type: string;
  data: Record<string, Record<string, unknown>>;
}
export function rainFields(body: unknown): RainField[] {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("Invalid readings response");
  return Object.values(body).filter(
    (v): v is RainField =>
      !!v &&
      typeof v === "object" &&
      v.name === "precipitation" &&
      typeof v.data === "object",
  );
}
export function parseDay(
  stationId: string,
  day: string,
  body: unknown,
  now = Date.now(),
) {
  const fields = rainFields(body);
  if (
    fields.length > 1 ||
    (fields.length === 1 && Object.keys(fields[0].data).length !== 1)
  )
    throw new Error(
      "Multiple precipitation sensors: refusing to combine gauges",
    );
  const observations: Observation[] = [];
  const field = fields[0];
  if (field && field.station !== stationId)
    throw new Error("Station ID mismatch");
  for (const [clock, value] of Object.entries(
    field ? Object.values(field.data)[0] : {},
  )) {
    const start = localSlot(day, clock);
    if (start === null || start % STEP !== 0 || start + STEP > now) continue;
    const valid =
      typeof value === "number" && Number.isFinite(value) && value >= 0;
    observations.push({
      stationId,
      start,
      mm: valid ? value : null,
      quality: valid
        ? "provisional"
        : value === null || value === undefined || value === ""
          ? "missing"
          : "invalid",
    });
  }
  return {
    observations,
    eligible: !!field,
    sensorHeight: field ? Number(Object.keys(field.data)[0]) / 100 : null,
  };
}
export interface SourceAdapter {
  inventory(): Promise<Station[]>;
  day(station: string, day: string): Promise<unknown>;
  metadata?(
    station: string,
    day: string,
  ): Promise<{ sensorId: string | null; sensorHeight: number | null }>;
}
export class ViewerSource implements SourceAdapter {
  async inventory(): Promise<Station[]> {
    const body = await requestJson(
      `${BASE}/vamet/stations/stationList/webmet00-stationList.json`,
    );
    if (!Array.isArray(body)) throw new Error("Invalid station inventory");
    return body.map((s) => {
      if (
        !/^\w+$/.test(s.id) ||
        typeof s.name !== "string" ||
        !Number.isFinite(s.x) ||
        !Number.isFinite(s.y) ||
        Math.abs(s.y) > 90 ||
        Math.abs(s.x) > 180
      )
        throw new Error("Invalid station coordinates");
      return {
        id: s.id,
        name: s.name,
        municipality: s.municipality,
        province: s.province,
        lon: s.x,
        lat: s.y,
        elevation: Number.isFinite(s.altitude) ? s.altitude : null,
        sensorHeight: null,
        sensorId: null,
        eligible: false,
      };
    });
  }
  day(station: string, day: string) {
    return requestJson(
      `${BASE}/vamet/stations/readings/${station}/${day.replaceAll("-", "/")}/webmet00-readingsData.json`,
    );
  }
  async metadata(station: string, day: string) {
    const body = (await requestJson(
      `${BASE}/vamet/stations/readings/${station}/${day.replaceAll("-", "/")}/webmet00-summaryData.json`,
    )) as {
      _items?: Array<{
        _measureId?: { _id: string };
        _sensorId?: { _id: string };
        _sensorPositionValue?: { _unit: string; _at: number };
      }>;
    };
    const fields =
      body._items?.filter((i) => i._measureId?._id === "precipitation") || [];
    if (fields.length !== 1) return { sensorId: null, sensorHeight: null };
    const item = fields[0];
    return {
      sensorId: item._sensorId?._id || null,
      sensorHeight:
        item._sensorPositionValue?._unit === "CENTIMETERS"
          ? item._sensorPositionValue._at / 100
          : null,
    };
  }
}
// Credential transport for the documented API. No keys are read or returned to the client.
// API payload normalisation must be verified with credentials before replacing ViewerSource.
export function apiToken() {
  const key = process.env.EUSKALMET_PRIVATE_KEY_PATH;
  const email = process.env.EUSKALMET_EMAIL,
    loginId = process.env.EUSKALMET_LOGIN_ID;
  if (!key || (!email && !loginId))
    throw new Error("API requires private key path and email or loginId");
  const now = Math.floor(Date.now() / 1000);
  const encode = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ aud: "met01.apikey", iss: process.env.EUSKALMET_ISSUER || "zirimiri", version: "1.0.0", iat: now, exp: now + 900, ...(email ? { email } : { loginId }) })}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(readFileSync(key), "base64url")}`;
}
export function documentedApiDay(station: string, day: string) {
  if (!/^\w+$/.test(station) || !/^\d{4}-\d{2}-\d{2}$/.test(day))
    throw new Error("Invalid API path");
  return requestJson(
    `https://api.euskadi.eus/euskalmet/readings/aggregated/byDay/forStation/${station}/at/${day.replaceAll("-", "/")}`,
    apiToken(),
  );
}
