import { Inject, Injectable } from "@nestjs/common";
import { fail } from "@japp/domain";
import type { Session } from "../Helpers/AuthGuard.js";
import { AuthorizationService } from "./AuthorizationService.js";
import { CustomersApplication } from "../Applications/CustomersApplication.js";

/** Lo mínimo que hay que escribir para buscar, y cuántos se devuelven como mucho. */
export const CUSTOMER_SEARCH_MIN = 2;
export const CUSTOMER_SEARCH_LIMIT = 20;

/** Buscar en el fichero de clientes (factura completa F1). */
@Injectable()
export class CustomersService {
  constructor(
    @Inject(CustomersApplication) private readonly customers: CustomersApplication,
    @Inject(AuthorizationService) private readonly auth: AuthorizationService,
  ) {}

  async search(session: Session, q: string | undefined) {
    await this.auth.require(session, "cobro.clientes");
    const text = (q ?? "").trim();
    if (text.length < CUSTOMER_SEARCH_MIN) {
      fail("VALIDATION", `Escribe al menos ${CUSTOMER_SEARCH_MIN} caracteres del NIF o del nombre`, {
        field: "q",
      });
    }
    const rows = await this.customers.search(session.storeId, text, CUSTOMER_SEARCH_LIMIT);
    return {
      items: rows.map((c) => ({
        id: c.id,
        type: c.type,
        taxId: c.taxId,
        name: c.name,
        email: c.email,
        phone: c.phone,
        address: {
          street: c.street,
          postalCode: c.postalCode,
          city: c.city,
          province: c.province,
          country: c.country,
        },
      })),
    };
  }
}
