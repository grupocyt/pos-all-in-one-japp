import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import { fail } from "@japp/domain";
import { CONFIG } from "../Constants/Injection.js";
import type { Config } from "../Properties/AppSettings.js";

const sha256 = (x: string) => createHash("sha256").update(x).digest();

/**
 * Clave de integración de Order on Table: cabecera X-Integration-Key = OOT_INTEGRATION_KEY.
 * Va como guard (antes de validar el cuerpo) para que quien no tiene la clave no sepa nada más: siempre 403 NOT_ALLOWED.
 * Se comparan los SHA-256 con timingSafeEqual: el tiempo no depende de cuántos caracteres acierten ni de la longitud.
 * Sin la variable (o vacía), /oot/* queda cerrado.
 */
@Injectable()
export class IntegrationKeyGuard implements CanActivate {
  constructor(@Inject(CONFIG) private readonly cfg: Config) {}
  canActivate(ctx: ExecutionContext) {
    const raw = ctx.switchToHttp().getRequest().headers["x-integration-key"];
    const given = typeof raw === "string" ? raw : "";
    const want = this.cfg.ootIntegrationKey ?? "";
    const same = timingSafeEqual(sha256(given), sha256(want));
    if (!want || !given || !same) {
      fail("NOT_ALLOWED", "Clave de integración de Order on Table que falta o no es correcta");
    }
    return true;
  }
}
