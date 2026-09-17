import { defineConfig } from "vitest/config";

// טוען .env (DATABASE_URL) לבדיקות מול מסד נתונים מקומי; בלי .env הבדיקות האלה מדולגות
try {
  process.loadEnvFile(".env");
} catch {}

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
    environment: "node",
  },
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
});
