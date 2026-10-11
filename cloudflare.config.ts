import { bindings, defineConfig, exports } from "cf/config";

export default defineConfig({
  accountId: "53db6c451efaf53c20f8c79027ca0dbd",
  worker: {
    name: "opentrivia",
    compatibilityDate: "2026-08-01",
    entrypoint: "dist/server/index.js",
    exports: {
      // Preserve the existing class and its SQLite storage.
      TriviaRoom: exports.durableObject({ storage: "sqlite" }),
    },
    env: {
      DB: bindings.d1({
        name: "opentrivia",
        id: "5951b3b3-d55d-4e4f-ad61-c62840ba4e3c",
      }),
      ROOMS: bindings.durableObject({
        worker: "opentrivia",
        exportName: "TriviaRoom",
      }),
    },
  },
});
