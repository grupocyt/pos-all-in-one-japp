import { defineConfig } from "vitest/config";
export default defineConfig({
  esbuild: { target: "es2022", tsconfigRaw: { compilerOptions: { experimentalDecorators: true } } },
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
