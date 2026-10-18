// Japp · prueba de impresoras ESC/POS por IP (proyecto aparte, sin dependencias).
// node server.mjs  →  http://localhost:3333
import http from "node:http";
import net from "node:net";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { invoiceTicket, preBillTicket, kitchenTicket, renderText, renderEscPos, issueInvoice, registerPayment } from "./lib/tickets.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3333);

// ---------- tickets de ejemplo (mismo formato que la API) ----------
const STORE = { legalName: "DAILY FOOD VENTURES S.L.", tradeName: "Cañas y Tapas", taxId: "B02891075", address: "C.C. Plaza Norte, 28700 Madrid", phone: "910 000 000", footer: "IVA incluido · Gracias por su visita", logo: true };
const actor = { user: "Prueba", role: "admin", at: new Date().toISOString() };
const ctx = (now = new Date()) => ({ now, newId: () => Math.random().toString(36).slice(2), actor: { ...actor, at: now.toISOString() } });
const line = (o) => ({ id: Math.random().toString(36).slice(2), comment: "", modifiers: [], status: "printed", createdBy: actor, ...o });
const account = (lines) => ({ id: "acc-1", name: "Cuenta 1", status: "open", lines, deletedLines: [], discounts: [], payments: [], customerData: null, invoice: null });
const LINES = () => [
  line({ productId: 1813, name: "Tosta de jamón ibérico y tumaca", quantity: 1, unitPrice: 8.5, taxRate: 10 }),
  line({ productId: 1884, name: "Croquetas de boletus (media)", quantity: 2, unitPrice: 5.95, taxRate: 10, comment: "una sin gluten" }),
  line({ productId: 2018, name: "Bacardi", quantity: 1, unitPrice: 10.5, taxRate: 10, modifiers: [{ name: "Kas limón", unitPrice: 0, quantity: 1 }] }),
  line({ productId: 2422, name: "Seven Up", quantity: 2, unitPrice: 3.4, taxRate: 10 }),
];

function build(kind, o = {}) {
  const now = new Date();
  const tctx = { store: { ...STORE, ...(o.store ?? {}) }, table: { name: String(o.table || "12"), area: o.area || "Terraza" }, waiter: o.waiter || "Prueba", guests: Number(o.guests || 2), at: now };
  if (kind === "kitchen") {
    return kitchenTicket(LINES().map(l => ({ quantity: l.quantity, name: l.name, comment: l.comment, modifiers: l.modifiers })), { channel: o.channel || "COCINA", waiter: tctx.waiter, guests: tctx.guests, table: tctx.table, at: now });
  }
  if (kind === "menu") { // comanda de menú del día por pases
    return kitchenTicket([
      { quantity: 1, name: "Menú del día ciclo 1", comment: "", modifiers: [{ name: "Crema de puerro", unitPrice: 0, quantity: 1 }], tag: "MARCHA 1.º", notes: ["2.º EN ESPERA: MERLUZA A LA ROMANA"] },
    ], { channel: o.channel || "COCINA", waiter: tctx.waiter, guests: tctx.guests, table: tctx.table, at: now });
  }
  if (kind === "prebill") return preBillTicket(account(LINES().map(l => ({ ...l, status: "preBill" }))), tctx);
  if (kind === "invoice") {
    const acc = account(LINES());
    const total = acc.lines.reduce((a, l) => a + l.unitPrice * l.quantity, 0);
    const paid = registerPayment(acc, { method: "cash", kind: "cash", amount: Math.round(total * 100) / 100, cashGiven: 50 }, ctx(now)).account;
    const inv = issueInvoice(paid, 1, { serieF: "PRUEBA-F", serieT: "PRUEBA-T", nif: STORE.taxId }, ctx(now));
    return invoiceTicket(inv, { ...tctx, paymentNames: { cash: "Efectivo", card: "Tarjeta" } });
  }
  // prueba de caracteres y tamaños
  const T = (text, x = {}) => ({ k: "text", text, ...x });
  return [
    T("PRUEBA DE IMPRESORA", { align: "center", size: "wh", bold: true }), { k: "rule", ch: "=" },
    T(`IP: ${o.ip || "?"}  ·  ${now.toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}`),
    T("Acentos: áéíóú ÁÉÍÓÚ ü ñ Ñ ç ¿? ¡!"), T("Euro: 12,50 €   1.234,56 €"),
    T("Doble ancho", { size: "w" }), T("Doble alto", { size: "h" }), T("Doble ancho y alto", { size: "wh" }), T("Negrita", { bold: true }),
    T("Centrado", { align: "center" }), T("Derecha", { align: "right" }), { k: "rule", ch: "-" },
    T("123456789012345678901234567890123456789012345678"), T("^ 48 columnas (papel de 80 mm)"),
    { k: "qr", data: "https://japp.grupocyt.com.es/" }, { k: "feed", n: 3 }, { k: "cut" },
  ];
}

// ---------- envío por TCP (puerto RAW 9100) ----------
function send(ip, port, bytes, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host: ip, port }, () => s.end(Buffer.from(bytes)));
    const t0 = Date.now();
    s.setTimeout(timeoutMs, () => { s.destroy(); reject(new Error(`Sin respuesta en ${timeoutMs / 1000} s (¿IP o puerto correctos? ¿misma red?)`)); });
    s.on("error", e => reject(new Error(e.code === "ECONNREFUSED" ? "La impresora rechaza la conexión en ese puerto (¿es el 9100?)" : e.code === "EHOSTUNREACH" || e.code === "ENETUNREACH" ? "No hay ruta hasta esa IP (¿está en la misma red?)" : e.message)));
    s.on("close", hadErr => { if (!hadErr) resolve({ ms: Date.now() - t0, bytes: bytes.length }); });
  });
}
function ping(ip, port, timeoutMs = 2500) {
  return new Promise(resolve => {
    const t0 = Date.now(), s = net.createConnection({ host: ip, port });
    const done = (ok, msg) => { s.destroy(); resolve({ ok, ms: Date.now() - t0, msg }); };
    s.setTimeout(timeoutMs, () => done(false, `Sin respuesta en ${timeoutMs / 1000} s`));
    s.on("connect", () => done(true, "Conecta"));
    s.on("error", e => done(false, e.code === "ECONNREFUSED" ? "Rechaza la conexión en ese puerto" : e.code || e.message));
  });
}
const validIp = ip => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split(".").every(n => +n <= 255) || /^[a-z0-9.-]+$/i.test(ip);

// ---------- servidor ----------
const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); };
const body = req => new Promise(r => { let d = ""; req.on("data", c => (d += c)); req.on("end", () => { try { r(JSON.parse(d || "{}")); } catch { r({}); } }); });

http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
      return res.end(await readFile(join(HERE, "public/index.html")));
    }
    if (req.method === "POST" && req.url === "/api/preview") {
      const b = await body(req); return json(res, 200, { text: renderText(build(b.kind, b)) });
    }
    if (req.method === "POST" && req.url === "/api/ping") {
      const b = await body(req); if (!validIp(b.ip)) return json(res, 422, { ok: false, msg: "IP no válida" });
      return json(res, 200, await ping(b.ip, Number(b.port || 9100)));
    }
    if (req.method === "POST" && req.url === "/api/print") {
      const b = await body(req); if (!validIp(b.ip)) return json(res, 422, { ok: false, msg: "IP no válida" });
      const lines = build(b.kind, b), copies = Math.min(5, Math.max(1, Number(b.copies || 1)));
      const one = renderEscPos(lines, { openDrawer: !!b.drawer, logoFromPrinter: !!b.logo });
      const bytes = new Uint8Array(one.length * copies); for (let i = 0; i < copies; i++) bytes.set(one, i * one.length);
      try { const r = await send(b.ip, Number(b.port || 9100), bytes); console.log(`✓ ${b.kind} → ${b.ip}:${b.port || 9100} (${r.bytes} bytes, ${r.ms} ms)`); return json(res, 200, { ok: true, ...r, text: renderText(lines) }); }
      catch (e) { console.log(`✗ ${b.kind} → ${b.ip}: ${e.message}`); return json(res, 502, { ok: false, msg: e.message }); }
    }
    json(res, 404, { ok: false, msg: "No existe" });
  } catch (e) { json(res, 500, { ok: false, msg: String(e?.message || e) }); }
}).listen(PORT, () => console.log(`Japp · prueba de impresoras → http://localhost:${PORT}`));
