import { describe, expect, it } from "vitest";
import {
  SIR_EMPTY,
  sirDate,
  sirEnvelope,
  sirHex,
  sirSales,
  sirUnhex,
  sirXml,
  type SirInput,
} from "../src/index.js";

// HorasCajero real de MaxPoint (CT03, 13/05/2026): así llega al SIR
const MAXPOINT_HORAS =
  "0xFFFE3C0048006F00720061007300430061006A00650072006F003E003C0048006F0072006100730043006F006E00650063007400610064006F0020007500730075006100720069006F003D0022004200410052005200410022002000460065006300680061003D00220032003000320036002D00300035002D003100330022002000490044005500730065007200730050006F0073003D002200430030004300300030004600430046002D0033004400370032002D0045004500310031002D0042003000300034002D00360030003400350042004400380032003100340030003700220020007200730074005F00690064003D00220034003100220020007500720073005F00760061007200630068006100720031003D00220031003000310032002200200048006F007200610073005F0043006F006E00650063007400610064006F003D0022003100350032002E003000300022002F003E003C002F0048006F00720061007300430061006A00650072006F003E00";

const at = (s: string) => new Date(s);
const base: SirInput = {
  storeCode: 41,
  businessDate: "2026-10-25",
  guests: 5,
  invoices: [
    {
      id: "f1",
      type: "F2",
      total: 22,
      taxBase: 20,
      taxTotal: 2,
      zeroBase: 0,
      discount: 0,
      issuedAt: at("2026-10-25T13:10:00+01:00"),
      issuedBy: "BARRA",
    },
    {
      id: "f2",
      type: "F2",
      total: 11,
      taxBase: 10,
      taxTotal: 1,
      zeroBase: 0,
      discount: 1,
      issuedAt: at("2026-10-25T13:40:00+01:00"),
      issuedBy: "Pedro",
    },
    {
      id: "r1",
      type: "R5",
      total: -5.5,
      taxBase: -5,
      taxTotal: -0.5,
      zeroBase: 0,
      discount: 0,
      issuedAt: at("2026-10-25T14:05:00+01:00"),
      issuedBy: "BARRA",
    },
  ],
  payments: [
    { user: "BARRA", method: "18", amount: 22 },
    { user: "Pedro", method: "18", amount: 5 },
    { user: "Pedro", method: "1", amount: 6 },
  ],
  items: [
    { plu: 614, quantity: 2, gross: 4.6, grossAfterDiscount: 4.6, taxRate: 10 },
    { plu: 614, quantity: 1, gross: 2.3, grossAfterDiscount: 2.3, taxRate: 10 },
    { plu: 900, quantity: 1, gross: 0, grossAfterDiscount: 0, taxRate: 10 },
    { plu: 777, quantity: 1, gross: 11, grossAfterDiscount: 10, taxRate: 0 },
  ],
  sessions: [
    {
      userId: "c0c00fcf-3d72-ee11-b004-6045bd821407",
      user: "BARRA",
      start: at("2026-10-25T12:00:00+01:00"),
      end: at("2026-10-25T16:20:00+01:00"),
    },
    {
      userId: "c0c00fcf-3d72-ee11-b004-6045bd821407",
      user: "BARRA",
      start: at("2026-10-25T19:00:00+01:00"),
      end: at("2026-10-25T20:00:00+01:00"),
    },
  ],
};

describe("interfaz de ventas al SIR (USP_InterfaceSistemaGerente)", () => {
  it("hexadecimal como SQL Server: UTF-16LE con BOM FFFE; vacío = 0x00000000", () => {
    const xml = sirUnhex(MAXPOINT_HORAS);
    expect(xml.startsWith("<HorasCajero><HorasConectado")).toBe(true);
    expect(sirHex(xml)).toBe(MAXPOINT_HORAS);
    expect(sirHex(null)).toBe(SIR_EMPTY);
    expect(sirUnhex(SIR_EMPTY)).toBe("");
    expect(sirDate("2026-05-13")).toBe("13/05/2026");
  });

  it("CierreCajas: TOTAL con comensales y canal 1; facturas menos rectificativas; constantes de MaxPoint", () => {
    const x = sirXml(base).CierreCajas!;
    expect(x).toContain(
      '<CierreCajasDetalle Venta_Bruta="27.5000" Venta_Neta="25.0000" Iva="2.5000" VentaCero="0.0000" Descuento="1.0000" Servicios="0.0000" Transacciones="2" Compensacion="0.0000" TotalClientes="5" tipo_medio="TOTAL" neta_sin_terraza="1" iva_sin_terraza="2" anulaciones="1" anulacionGer="2" errores="3" facEmpezadas="4" facPagadas="5" cancelacion="6" descIvaInt_CierreCajasPiloto="7"/>',
    );
    expect(x).toContain('TotalClientes="0" tipo_medio="1"');
  });

  it("VentaHora por hora de Madrid", () => {
    expect(sirXml(base).VentaHora).toBe(
      '<VentasHora><VentasHoraDetalle Tiempo="13:00 - 13:59" Transacciones="2" Valor="33.0000"/><VentasHoraDetalle Tiempo="14:00 - 14:59" Transacciones="0" Valor="-5.5000"/></VentasHora>',
    );
  });

  it("DinTrans: cajero y forma de pago, y la fila -1 con lo facturado por cada cajero", () => {
    const x = sirXml(base).DinTrans!;
    expect(x).toContain(
      '<Cajero Cod_Cajero="BARRA" Cod_FormaPago="18" Merchant="" Valor="22.0000" Num_Trans="1" Recap="0" IDDocumento="-1"/>',
    );
    expect(x).toContain(
      '<Cajero Cod_Cajero="Pedro" Cod_FormaPago="1" Merchant="" Valor="6.0000" Num_Trans="1" Recap="0" IDDocumento="-1"/>',
    );
    expect(x).toContain(
      '<Cajero Cod_Cajero="BARRA" Cod_FormaPago="-1" Merchant="" Valor="16.5000" Num_Trans="1" Recap="0" IDDocumento="-1"/>',
    );
    expect(x).toContain(
      '<Cajero Cod_Cajero="Pedro" Cod_FormaPago="-1" Merchant="" Valor="11.0000" Num_Trans="1" Recap="0" IDDocumento="-1"/>',
    );
  });

  it("PlusTrans: se juntan por PLU; base con IVA y al 0 %; unitarios; descuento", () => {
    const x = sirXml(base).PlusTrans!;
    expect(x).toContain(
      '<Cod_Plu Cod_Plu="614" Cantidad="3.0000" BaseIvaTotal="6.270000" BaseCeroTotal="0.0000" NetaTotal="6.270000" IvaTotal="0.630000" BrutaTotal="6.900000" BaseIvaUnitaria="2.090000" BaseCeroUnitaria="0.000000" NetaUnitaria="2.090000" IvaUnitario="0.210000" BrutaUnitaria="2.300000" Descuento="0.000000" agregador="LOCAL"/>',
    );
    expect(x).toContain(
      '<Cod_Plu Cod_Plu="777" Cantidad="1.0000" BaseIvaTotal="0.000000" BaseCeroTotal="10.0000" NetaTotal="10.000000" IvaTotal="0.000000" BrutaTotal="10.000000"',
    );
    expect(x).toContain('Descuento="1.000000" agregador="LOCAL"');
    expect(x).toContain('Cod_Plu="900" Cantidad="1.0000"'); // respuesta de menú a 0 €: cuenta en cantidad
  });

  it("HorasCajero: por usuario y día, horas redondeadas", () => {
    expect(sirXml(base).HorasCajero).toBe(
      '<HorasCajero><HorasConectado usuario="BARRA" Fecha="2026-10-25" IDUsersPos="C0C00FCF-3D72-EE11-B004-6045BD821407" rst_id="41" urs_varchar1="" Horas_Conectado="5.00"/></HorasCajero>',
    );
  });

  it("respuesta completa: lo que no hay va a 0x00000000; sin ventas, todo vacío", () => {
    const r = sirSales(base);
    expect([r.cod_restaurante, r.lc_fecha]).toEqual(["41", "25/10/2026"]);
    expect(sirUnhex(r.CierreCajas)).toBe(r.xml.CierreCajas);
    for (const k of [
      "Depositos",
      "CajaChica",
      "CxCEmpleado",
      "ConsumoRecarga",
      "CreditoAutoconsumo",
      "Agregadores",
      "AnulacionBoletas",
      "Cortesias",
    ] as const) {
      expect(r[k]).toBe(SIR_EMPTY);
    }
    const none = sirSales({ ...base, invoices: [], payments: [], items: [], sessions: [] });
    expect([none.CierreCajas, none.DinTrans, none.VentaHora, none.PlusTrans, none.HorasCajero]).toEqual(
      new Array(5).fill(SIR_EMPTY),
    );
  });

  it("sobre SOAP interfaceVentasAgregadores: campos en el orden del SIR", () => {
    const env = sirEnvelope(sirSales(base));
    expect(env.startsWith('<Envelope xmlns="http://schemas.xmlsoap.org/soap/envelope/">')).toBe(true);
    expect(env).toContain('<interfaceVentasAgregadores xmlns="">');
    expect(env).toContain("<cod_restaurante>41</cod_restaurante>");
    expect(env).toContain("<lc_fecha>25/10/2026</lc_fecha>");
    expect(env).toContain("<Depositos>0x00000000</Depositos>");
    const order = [...env.matchAll(/<(\w+)>/g)].map((m) => m[1]).filter((k) => !["Body"].includes(k!));
    expect(order).toEqual([
      "cod_restaurante",
      "lc_fecha",
      "CierreCajas",
      "VentaHora",
      "DinTrans",
      "PlusTrans",
      "Depositos",
      "CajaChica",
      "CxCEmpleado",
      "CreditoAutoconsumo",
      "Agregadores",
      "AnulacionBoletas",
      "HorasCajero",
    ]);
  });
});
