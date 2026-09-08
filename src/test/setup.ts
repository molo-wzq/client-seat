import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import "@testing-library/jest-dom/vitest";

// 测试未开启 vitest globals,手动注册 testing-library 的 DOM 清理。
afterEach(() => cleanup());
