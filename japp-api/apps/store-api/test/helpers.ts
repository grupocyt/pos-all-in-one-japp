import { inject, expect } from "vitest";
import pg from "pg";
import { contractErrors } from "@japp/contracts";
import { buildApp } from "../src/Startup.js";
import type { Config } from "../src/Properties/AppSettings.js";
import { LogPrinter } from "../src/Clases/Printers.js";

export const PIN = { sistemas: "0186", jeison: "5845", barra: "1012", mesero: "1111" } as const;
export const PLU = { tosta: 1813, croquetas: 1884, kaspirinha: 1650, redbull: 5362 } as const;

export async function setup(over: Partial<Config> = {}) {
  const config: Config = {
    databaseUrl: inject("dbUrl"),
    port: 0,
    storeCode: "CT 03",
    sessionSecret: "pruebas-".padEnd(40, "x"),
    sessionHours: 12,
    version: "test",
    printerMode: "log",
    corsOrigins: [],
    apiMode: "developer",
    apiAuthor: "Api Japp Grupo Cañas y Tapas",
    ...over,
  };
  const clock = { now: new Date() };
  const printer = new LogPrinter();
  const { app, database } = await buildApp({ config, printer, clock: () => clock.now, logger: false });
  const fastify = app.getHttpAdapter().getInstance();
  const sql = new pg.Client({ connectionString: config.databaseUrl });
  await sql.connect();

  /** Llama a la API y comprueba SIEMPRE que la respuesta cumple docs/openapi.yaml. */
  async function call(
    method: string,
    url: string,
    opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
  ) {
    const res = await fastify.inject({
      method: method as any,
      url: `/api/v2${url}`,
      payload: opts.body as any,
      headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.headers ?? {}) },
    });
    const body = res.body ? JSON.parse(res.body) : null;
    const errs = contractErrors(method, `/api/v2${url}`, res.statusCode, body);
    expect(
      errs,
      `${method} ${url} → ${res.statusCode} no cumple el contrato: ${errs.join("; ")}\n${res.body.slice(0, 400)}`,
    ).toEqual([]);
    // Formato común: { title, type, status, data, errors, traceId, author, mode }. Las pruebas leen data (body) y el primer error (error).
    return {
      status: res.statusCode,
      body: body?.data ?? null,
      error: body?.errors?.[0] ?? null,
      env: body,
      headers: res.headers,
    };
  }
  const login = async (pin: string, station?: string) => {
    const r = await call("POST", "/sessions", {
      body: { pin },
      headers: station ? { "x-station-id": station } : {},
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.token as string;
  };
  const close = async () => {
    await app.close();
    await database.close();
    await sql.end();
  };
  return { app, call, login, sql, printer, clock, close };
}
export type T = Awaited<ReturnType<typeof setup>>;

/** Abre periodo si no hay, y devuelve el id de una mesa libre del área pedida. */
export async function ensurePeriod(t: T, token: string) {
  const cur = await t.call("GET", "/periods/current", { token });
  if (cur.status === 200) {
    return cur.body.id as string;
  }
  const r = await t.call("POST", "/periods", { token, body: {} });
  expect(r.status).toBe(201);
  return r.body.id as string;
}
export async function freeTable(t: T, area: "BARRA" | "TERRAZA") {
  const { rows } = await t.sql.query(
    `
    SELECT dt.id FROM dining_table dt JOIN area a ON a.id = dt.area_id
    WHERE a.name = $1 AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.table_id = dt.id AND o.status IN ('open','billing')) LIMIT 1`,
    [area],
  );
  if (rows[0]) {
    return rows[0].id as string;
  }
  // crea otra mesa en el área para que las pruebas no dependan de cuántas haya en los datos de arranque
  const {
    rows: [a],
  } = await t.sql.query("SELECT id, store_id FROM area WHERE name=$1", [area]);
  const id = crypto.randomUUID();
  await t.sql.query(
    "INSERT INTO dining_table (id, store_id, area_id, number, capacity, pos_x, pos_y) VALUES ($1,$2,$3,(SELECT (coalesce(max(number::int),0)+1)::text FROM dining_table WHERE number ~ '^[0-9]+$'),4,0,0)",
    [id, a.store_id, a.id],
  );
  return id;
}
