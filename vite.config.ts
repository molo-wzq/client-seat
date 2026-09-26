import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:5175",
    },
    watch: {
      // output/submission 是本地产物目录、data 是运行时 JSON 存储,应用源码不引用;
      // 它们常被外部进程写入,watcher 撞上文件占用(EBUSY)会直接拖垮 dev 服务。
      ignored: ["**/output/**", "**/submission/**", "**/data/**"],
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
