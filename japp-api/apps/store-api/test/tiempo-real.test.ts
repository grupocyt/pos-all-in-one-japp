import { setup, PIN, ensurePeriod, freeTable, type T } from "./helpers.js";

/** GET /api/v2/ws: avisos después del COMMIT para que los equipos se repinten sin preguntar. */
let t: T;
beforeAll(async () => {
  t = await setup();
});
afterAll(async () => {
  await t.close();
});

type Msg = { event: string; [k: string]: unknown };

/** Abre el WebSocket con el token y va guardando lo que llega. */
async function connect(token: string) {
  const f: any = t.app.getHttpAdapter().getInstance();
  const ws = await f.injectWS(`/api/v2/ws?token=${encodeURIComponent(token)}`);
  const got: Msg[] = [];
  let closed: number | null = null;
  ws.on("message", (d: Buffer) => got.push(JSON.parse(d.toString())));
  ws.on("close", (code: number) => {
    closed = code;
  });
  const until = async (pred: (m: Msg[]) => boolean, ms = 2000) => {
    const end = Date.now() + ms;
    while (!pred(got) && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 20));
    }
    return got;
  };
  return { ws, got, until, closedCode: () => closed };
}

describe("tiempo real (WebSocket)", () => {
  it("con sesión vigente: al abrir una mesa, order.updated (con versión) y table.updated", async () => {
    const mesero = await t.login(PIN.mesero);
    await ensurePeriod(t, await t.login(PIN.sistemas));
    const tok = await t.login(PIN.mesero);
    const c = await connect(tok);
    // el «hello» puede llegar antes de que la prueba escuche (injectWS resuelve tarde): se espera a que el socket esté dado de alta
    await new Promise((r) => setTimeout(r, 150));
    expect(c.closedCode()).toBeNull();
    const tableId = await freeTable(t, "BARRA");
    const open = await t.call("POST", "/orders", { token: tok, body: { tableId, guests: 2 } });
    expect(open.status).toBe(201);
    await c.until((m) => m.some((x) => x.event === "table.updated"));
    const ev = c.got.find((x) => x.event === "order.updated");
    expect(ev).toMatchObject({ orderId: open.body._id, version: open.body.version });
    expect(c.got.some((x) => x.event === "table.updated")).toBe(true);
    // un GET no avisa
    const before = c.got.length;
    await t.call("GET", `/orders/${open.body._id}`, { token: tok });
    await new Promise((r) => setTimeout(r, 100));
    expect(c.got.length).toBe(before);
    expect(mesero).not.toBe(tok);
    c.ws.terminate();
  });

  it("token sustituido o falso → se cierra con 4001", async () => {
    const old = await t.login(PIN.barra);
    await t.login(PIN.barra);
    const c = await connect(old);
    await c.until(() => c.closedCode() !== null);
    expect(c.closedCode()).toBe(4001);
    const bad = await connect("xx.yy");
    await bad.until(() => bad.closedCode() !== null);
    expect(bad.closedCode()).toBe(4001);
  });

  it("entrar otra vez con la clave: el socket de la sesión anterior recibe session.replaced y se cierra", async () => {
    const first = await t.login(PIN.jeison);
    const c = await connect(first);
    await new Promise((r) => setTimeout(r, 150));
    await t.login(PIN.jeison);
    await c.until(() => c.closedCode() !== null);
    expect(c.got.some((x) => x.event === "session.replaced")).toBe(true);
    expect(c.closedCode()).toBe(4001);
  });
});
