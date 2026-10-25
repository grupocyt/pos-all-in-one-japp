/**
 * Envío del SOAP interfaceVentasAgregadores al SIR. Un POST text/xml con el sobre; nunca lanza: devuelve lo que pasó
 * (código HTTP, tiempo y la respuesta, recortada) para enseñarlo en Developer. SOAPAction: SIR_SOAP_ACTION (vacío por defecto).
 */
export interface SirSendResult {
  ok: boolean;
  /** Lo que contesta el SIR dentro de <return>: {"Respuesta":"0","Mensaje":"…"}. */
  sir: { respuesta: string | null; mensaje: string | null; raw: string } | null;
  /** Respuesta "1" = asentado; "0" = no (con su Mensaje); null = no se pudo leer. */
  accepted: boolean | null;
  status: number | null;
  ms: number;
  response: string;
  error: string | null;
}

const unxml = (t: string) =>
  t
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** <return xsi:type="xsd:string">{"Respuesta":"0","Mensaje":"El Menu Mix ya se encuetra Asentado"}</return> → {respuesta, mensaje}. */
export function parseSirReturn(xml: string): SirSendResult["sir"] {
  const m = /<(?:\w+:)?return\b[^>]*>([\s\S]*?)<\/(?:\w+:)?return>/.exec(xml);
  if (!m) {
    return null;
  }
  const raw = unxml(m[1]!.trim());
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const v = (k: string) => (j[k] == null ? null : String(j[k]));
    return { respuesta: v("Respuesta") ?? v("respuesta"), mensaje: v("Mensaje") ?? v("mensaje"), raw };
  } catch {
    return { respuesta: null, mensaje: raw, raw };
  }
}

export async function postSirSoap(url: string, envelope: string, timeoutMs = 20000): Promise<SirSendResult> {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "text/xml; charset=utf-8",
        soapaction: `"${process.env.SIR_SOAP_ACTION ?? ""}"`,
      },
      body: envelope,
      signal: ctl.signal,
    });
    const text = await r.text();
    // un SOAP Fault también es un error aunque venga con 200
    const fault = /<(\w+:)?Fault[\s>]/.test(text);
    const sir = parseSirReturn(text);
    let accepted: boolean | null = null;
    if (sir?.respuesta === "1") {
      accepted = true;
    } else if (sir?.respuesta === "0") {
      accepted = false;
    }
    return {
      ok: r.ok && !fault,
      sir,
      accepted,
      status: r.status,
      ms: Date.now() - t0,
      response: text.slice(0, 20000),
      error: fault ? "El SIR respondió con un SOAP Fault" : r.ok ? null : `HTTP ${r.status}`,
    };
  } catch (e: any) {
    const msg =
      e?.name === "AbortError"
        ? `Sin respuesta del SIR en ${Math.round(timeoutMs / 1000)} s`
        : `No se pudo conectar con el SIR: ${e?.cause?.code ?? e?.message ?? e}`;
    return {
      ok: false,
      sir: null,
      accepted: null,
      status: null,
      ms: Date.now() - t0,
      response: "",
      error: msg,
    };
  } finally {
    clearTimeout(timer);
  }
}
