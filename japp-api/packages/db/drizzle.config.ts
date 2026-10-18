import { defineConfig } from "drizzle-kit";
// Solo se usa para LEER el esquema (pull). Los cambios de esquema se hacen en japp-db.
export default defineConfig({
  dialect: "postgresql",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL! },
  tablesFilter: ["!schema_migrations"],
});
