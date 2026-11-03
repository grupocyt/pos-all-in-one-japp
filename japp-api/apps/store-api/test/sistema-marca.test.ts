import { setup, PIN, type T } from "./helpers.js";

let t: T;
let admin: string;
beforeAll(async () => {
  t = await setup();
  admin = await t.login(PIN.sistemas);
});
afterAll(async () => {
  await t.close();
});

const base = {
  name: "Cañas y Tapas",
  subtitle: "Plataforma Japp",
  loginGroup: "Grupo Cañas y Tapas",
  logo: "data:image/png;base64,iVBORw0KGgo=",
  noImage: null,
  palette: [
    { hex: "#15616d", name: "Verde", default: true },
    { hex: "#7A3E6A", name: "Morado", default: false },
  ],
  colors: { secondary: "#b88a4c", err: "#B3261E" },
};

describe("Ajustes › Administración › Sistema (TPV 1.2.206)", () => {
  it("sin fila y sin sesión: los originales con version 0", async () => {
    const r = await t.call("GET", "/config/sistema");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      name: "Japp",
      version: 0,
      palette: [{ hex: "#15616D", name: "Verde", default: true }],
      colors: {},
      noImage: null,
    });
  });

  it("guardar con version 0 crea la fila; el GET sin sesión la enseña; queda en el historial y en la cola", async () => {
    const r = await t.call("PUT", "/config/sistema", { token: admin, body: { ...base, version: 0 } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: "Cañas y Tapas", version: 1, updatedBy: "Sistemas" });
    expect(r.body.palette[0].hex).toBe("#15616D");
    expect(r.body.colors).toEqual({ secondary: "#B88A4C", err: "#B3261E" });
    const g = await t.call("GET", "/config/sistema");
    expect(g.body).toMatchObject({ name: "Cañas y Tapas", loginGroup: "Grupo Cañas y Tapas", version: 1 });
    const h = await t.sql.query(
      "SELECT module, action, diff FROM config_change_log WHERE module = 'sistema'",
    );
    expect(h.rows[0]).toMatchObject({ module: "sistema", action: "create" });
    expect(h.rows[0].diff).toContain("Nombre");
    const q = await t.sql.query(
      "SELECT payload FROM sync_outbox WHERE entity = 'config' AND payload->>'module' = 'sistema'",
    );
    expect(q.rows).toHaveLength(1);
  });

  it("versión vieja → 409 VERSION_CONFLICT con lo guardado", async () => {
    const r = await t.call("PUT", "/config/sistema", {
      token: admin,
      body: { ...base, name: "Otro", version: 0 },
    });
    expect([r.status, r.error.code]).toEqual([409, "VERSION_CONFLICT"]);
    expect(r.error.details.current.version).toBe(1);
  });

  it("reglas: nombre vacío, paleta vacía, más de 12, color mal escrito, dos «Por defecto» → 422", async () => {
    const bad = async (over: Record<string, unknown>, field: string) => {
      const r = await t.call("PUT", "/config/sistema", {
        token: admin,
        body: { ...base, ...over, version: 1 },
      });
      expect([r.status, r.error.code, r.error.details.field ?? r.error.field]).toEqual([
        422,
        "VALIDATION",
        field,
      ]);
    };
    await bad({ name: "  " }, "name");
    await bad({ palette: [] }, "palette");
    await bad(
      { palette: Array.from({ length: 13 }, (_, i) => ({ hex: "#000000", name: `c${i}` })) },
      "palette",
    );
    await bad({ palette: [{ hex: "verde", name: "Verde" }] }, "palette");
    await bad(
      {
        palette: [
          { hex: "#111111", default: true },
          { hex: "#222222", default: true },
        ],
      },
      "palette",
    );
    await bad({ colors: { fondo: "#FFFFFF" } }, "colors");
  });

  it("un logo de más de 190 000 caracteres → 413 TOO_LARGE", async () => {
    const r = await t.call("PUT", "/config/sistema", {
      token: admin,
      body: { ...base, logo: "data:image/png;base64," + "A".repeat(190_000), version: 1 },
    });
    expect([r.status, r.error.code]).toEqual([413, "TOO_LARGE"]);
  });

  it("sin «Por defecto» marca el primero; textos vacíos quedan vacíos", async () => {
    const r = await t.call("PUT", "/config/sistema", {
      token: admin,
      body: {
        ...base,
        subtitle: "",
        logo: null,
        palette: [{ hex: "#123456" }, { hex: "#654321" }],
        version: 1,
      },
    });
    expect(r.status).toBe(200);
    expect(r.body.palette.map((c: any) => c.default)).toEqual([true, false]);
    expect(r.body).toMatchObject({ subtitle: "", logo: "", version: 2 });
  });

  it("sin el permiso ajustes.restaurante → 403 PERMISSION_REQUIRED", async () => {
    const mesero = await t.login(PIN.mesero);
    const r = await t.call("PUT", "/config/sistema", { token: mesero, body: { ...base, version: 2 } });
    expect([r.status, r.error.code, r.error.details.permission]).toEqual([
      403,
      "PERMISSION_REQUIRED",
      "ajustes.restaurante",
    ]);
  });
});
