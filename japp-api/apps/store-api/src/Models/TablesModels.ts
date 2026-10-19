import { z } from "zod";

/** GET /tables?areaId: el área, si viene, como UUID. */
export const AreaId = z.string().uuid();
