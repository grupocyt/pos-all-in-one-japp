import { setup, PIN, type T } from "./helpers.js";

let t: T; let f: any;
beforeAll(async () => { t = await setup(); f = t.app.getHttpAdapter().getInstance(); });
afterAll(async () => { await t.close(); });

describe("un solo servicio: TPV + API + Swagger", () => {
  it("/ sirve el TPV (sin caché para index.html)", async () => {
    const r = await f.inject({ method: "GET", url: "/" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/html");
    expect(r.headers["cache-control"]).toBe("no-cache");
    expect(r.body).toContain("APP_VER=");
    expect((await f.inject({ method: "GET", url: "/manifest.webmanifest" })).statusCode).toBe(200);
    expect((await f.inject({ method: "GET", url: "/icons/icon-192.png" })).headers["content-type"]).toBe("image/png");
  });
  it("rutas desconocidas del TPV devuelven el TPV; nada fuera de su carpeta", async () => {
    expect((await f.inject({ method: "GET", url: "/mesas/12" })).body).toContain("APP_VER=");
    const tr = await f.inject({ method: "GET", url: "/..%2F..%2Fpackage.json" });
    expect(tr.body).not.toContain('"name": "store-api"');
  });
  it("/api/v2/... que no existe → 404 en JSON", async () => {
    const r = await f.inject({ method: "GET", url: "/api/v2/nada" });
    expect(r.statusCode).toBe(404);
    expect(JSON.parse(r.body)).toMatchObject({ type: "error", status: 404, data: null, errors: [{ code: "NOT_FOUND" }], author: "Api Japp Grupo Cañas y Tapas" });
  });
  it("contrato solo con las rutas de tienda y servidor relativo", async () => {
    const d = JSON.parse((await f.inject({ method: "GET", url: "/api/v2/openapi.json" })).body);
    expect(d.servers).toEqual([{ url: "/", description: "Esta tienda" }]);
    expect(Object.keys(d.paths).every((p: string) => p.startsWith("/api/v2/"))).toBe(true);
    expect(d.paths["/api/v2/orders"].post).toBeTruthy();
  });
  it("Swagger UI con sus recursos y entrada por PIN", async () => {
    const page = await f.inject({ method: "GET", url: "/api/v2/docs/" });
    expect(page.body).toContain("SwaggerUIBundle");
    expect((await f.inject({ method: "GET", url: "/api/v2/docs/assets/swagger-ui-bundle.js" })).statusCode).toBe(200);
    expect((await f.inject({ method: "GET", url: "/api/v2/docs/assets/..%2Fpackage.json" })).statusCode).toBe(404);
    const s = await f.inject({ method: "POST", url: "/api/v2/docs/sessions", payload: { pin: PIN.sistemas } });
    expect(s.statusCode).toBe(201);
    expect(JSON.parse(s.body).data.token).toBeTruthy();
  });
});
