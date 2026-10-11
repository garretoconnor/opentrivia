import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig({
  build: {
    command: "node scripts/build.mjs",
  },
  types: {
    generate: false,
  },
});
