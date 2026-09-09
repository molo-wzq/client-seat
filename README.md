# bank-call-coach(电话对练)

银行理财经理电话对练智能体 MVP(L3 最小产品闭环)。用户粘贴优秀电话转写稿,
系统提炼策略卡;用户确认发布后,以生客身份输入「喂」与 AI 理财经理完成一通
模拟电话,并在结果页追溯本轮使用的策略卡与原始素材片段。

领域词汇见根目录 `CONTEXT.md`,产品口径见 `.scratch/phone-coaching-agent/spec.md`。

## 本地运行

```bash
npm install
npm run dev
```

`npm run dev` 会同时启动:

- API 服务(node,默认 `http://127.0.0.1:5175`),承载模型适配器与本地 JSON 存储;
- Web 前端(vite,默认 `http://localhost:5173`),`/api` 自动代理到 API 服务。

打开 `http://localhost:5173` 即可走完 素材 → 画像 → 对话 → 结果 四步。

## 语言模型配置

在仓库根目录创建 `.env.local`:

```
MIMO_API_KEY=...
MIMO_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1   # 可省略
MIMO_MODEL=mimo-v2.5                                     # 可省略
```

未配置密钥时,API 服务自动回退到内置伪适配器(仅演示,启动时打印警告)。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 同时启动 API 服务与前端(开发模式) |
| `npm run test` | 运行全部测试(最高层端到端产品测试使用伪适配器) |
| `npm run typecheck` | `tsc -b` + 服务端类型检查 |
| `npm run build` | 类型检查并构建前端产物到 `dist/` |
| `npm start` | 构建并以 API 服务托管 `dist/`(生产式单进程运行) |

## 结构

- `src/domain/` 领域核心:类型、种子数据(ADR 0002:C01 素材/SC1–SC3/P01/虚拟产品卡)、
  适配器端口(文案生成、对话生成)、产品用例(分析、发布、对话、结果)。
- `src/adapters/` 语言模型适配器:伪实现(测试/演示兜底)与 OpenAI 兼容真实实现、提示词组装。
- `src/product/` 产品缝:`ProductApi` 接口 + 进程内实现(测试)+ HTTP 实现(浏览器)。
- `src/ui/` 四步流程界面(素材、画像、对话、结果)。
- `server/` 轻量 Node 服务:HTTP API、本地 JSON 文件存储、密钥只存服务端。
- `src/App.test.tsx` 端到端产品测试:从转写稿输入到结果追溯的完整路径。
