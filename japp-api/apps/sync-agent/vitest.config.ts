import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 120_000,
    // Un solo agente por base (advisory lock global): los ficheros no corren a la vez.
    fileParallelism: false,
  },
});
