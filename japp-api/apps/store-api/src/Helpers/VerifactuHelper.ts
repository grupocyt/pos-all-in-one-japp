import { createHash } from "node:crypto";

/** Lo que entra en la huella de un registro VeriFactu (alta), en este orden. */
export interface VerifactuHashInput {
  nif: string;
  invoiceNumber: string;
  /** Fecha y hora ISO de la factura: entra el día (AAAA-MM-DD). */
  issuedAt: string;
  type: string;
  /** Cuota total y total con dos decimales («1.82», «-19.30»). */
  taxTotal: string;
  total: string;
  /** Huella del registro anterior de la cadena ("" si es el primero). */
  previousHash: string;
  generatedAt: string;
}

/**
 * Huella del registro VeriFactu encadenado: SHA-256 en mayúsculas de los campos unidos por «&».
 * Una sola pieza para la factura (OrdersService.invoice) y el abono (InvoicesService.credit): la cadena es la misma.
 */
export function verifactuHash(v: VerifactuHashInput): string {
  return createHash("sha256")
    .update(
      [
        v.nif,
        v.invoiceNumber,
        v.issuedAt.slice(0, 10),
        v.type,
        v.taxTotal,
        v.total,
        v.previousHash,
        v.generatedAt,
      ].join("&"),
    )
    .digest("hex")
    .toUpperCase();
}
