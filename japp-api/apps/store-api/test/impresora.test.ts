import { createServer } from "node:net";
import { kitchenTicket } from "@japp/domain";
import { EscPosNetPrinter, parseConnection } from "../src/ports/printer.js";

describe("impresora ESC/POS por red", () => {
  it("entiende tcp://host y tcp://host:puerto (9100 por defecto)", () => {
    expect(parseConnection("tcp://10.221.11.32")).toEqual({ host: "10.221.11.32", port: 9100 });
    expect(parseConnection("tcp://127.0.0.1:9101")).toEqual({ host: "127.0.0.1", port: 9101 });
    expect(parseConnection("usb://x")).toBeNull();
  });
  it("manda los bytes del ticket a la impresora", async () => {
    const got: Buffer[] = [];
    const srv = createServer(sock => sock.on("data", d => got.push(d)));
    await new Promise<void>(r => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as any).port;
    const ticket = kitchenTicket([{ quantity: 1, name: "Caña", comment: "", modifiers: [] }], { channel: "Barra", waiter: "Ana", guests: 2, table: { name: "4", area: "Sala" }, at: new Date() });
    const r = await new EscPosNetPrinter().print({ kind: "kitchen", channel: "BARRA", printer: "BARRA", connection: `tcp://127.0.0.1:${port}`, title: "Mesa 4", ticket });
    await new Promise(r2 => setTimeout(r2, 50));
    srv.close();
    expect(r.ok).toBe(true);
    const b = Buffer.concat(got);
    expect([...b.subarray(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
    expect(b.includes(Buffer.from([0x43, 0x41, 0xa5, 0x41]))).toBe(true); // «CAÑA» en CP858 (Ñ = 0xA5)
  });
  it("impresora apagada → ok: false con el motivo (no se queda colgado)", async () => {
    const r = await new EscPosNetPrinter(800).print({ kind: "kitchen", channel: "X", printer: "COCINA", connection: "tcp://127.0.0.1:1", title: "", ticket: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/COCINA/);
  });
});
