import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    // 本机 localhost 解析 ::1 优先,Vite 8 会只绑 [::1] 而不监听 127.0.0.1;
    // 先试 IPv4 的浏览器/工具会撞上一个 2 秒才失败的死端口。host: true 让 Node
    // 绑 '::' 双栈,::1 与 127.0.0.1 都能直连。
    host: true,
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
    // .scratch 下的 cloudrun-deploy 是部署副本,里面的同名测试不参与本仓库断言。
    exclude: ["**/node_modules/**", "**/dist/**", ".scratch/**"],
  },
});
