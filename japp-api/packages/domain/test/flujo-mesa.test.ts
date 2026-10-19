import { addProduct, sendOrder, preBill, moveUnits, deleteLine } from "../src/lines.js";
import { registerPayment } from "../src/payments.js";
import { issueInvoice } from "../src/invoice.js";
import { accountTotals } from "../src/totals.js";
import type { Order } from "../src/types.js";
import { account, ctx, CANA, CROQUETAS, CAMISETA, TERRAZA, PROFILES, MARTA, LUCIA } from "./helpers.js";

/** Recorrido completo de una mesa de terraza, como en el TPV: pedir → enviar → precuenta → separar → borrar con encargado → cobrar → facturar. */
it("mesa de terraza de principio a fin", () => {
  const c = ctx();
  let a = account({ id: "a1" });
  a = addProduct(a, { product: CANA, area: TERRAZA, quantity: 4 }, c); // 4 × 2,90 = 11,60
  a = addProduct(a, { product: CROQUETAS, area: TERRAZA }, c); // 11,50
  a = addProduct(a, { product: CAMISETA, area: TERRAZA }, c); // 15,00 (21 %)
  expect(accountTotals(a).total).toBe(38.1);
  a = preBill(sendOrder(a).account);
  expect(a.lines.every((l) => l.status === "preBill")).toBe(true);

  let o: Order = { id: "o", tableId: "T4", guests: 2, version: 1, accounts: [a] };
  const cana = a.lines.find((l) => l.productId === CANA.plu)!;
  const mv = moveUnits(o, "a1", "new", { [cana.id]: 2 }, c);
  o = mv.order;
  const [c1, c2] = o.accounts;
  expect([accountTotals(c1!).total, accountTotals(c2!).total]).toEqual([32.3, 5.8]);

  const shirt = c1!.lines.find((l) => l.productId === CAMISETA.plu)!;
  const c1b = deleteLine(
    c1!,
    {
      lineId: shirt.id,
      reason: "No la quiere",
      actor: MARTA,
      authorizer: LUCIA,
      authorizerActor: { user: "Lucía", role: "manager", at: "" },
      profiles: PROFILES,
    },
    c,
  );
  expect(accountTotals(c1b).total).toBe(17.3);
  expect(c1b.deletedLines).toHaveLength(1);

  const p1 = registerPayment(c1b, { method: "cash", kind: "cash", amount: 17.3, cashGiven: 20 }, c);
  expect(p1.payment.change).toBe(2.7);
  const f1 = issueInvoice(p1.account, 1427, { serieF: "F2026", serieT: "T2026", nif: "B12345678" }, c);
  expect(f1.invoice!.invoiceNumber).toBe("T2026-001427");
  expect(f1.invoice!.taxes).toEqual([{ rate: 10, base: 15.73, tax: 1.57 }]);
});
