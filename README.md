# Lio 87 Studio

**给 GeekElite Lio 87 键盘做的非官方网页配置工具。** 打开浏览器就能调灯、改键、录宏，不需要装驱动，也不需要注册账号。

## 这是什么

Lio 87 Studio 通过浏览器原生的 WebHID 直连键盘的厂商配置通道，把原本要靠厂商软件才能改的东西搬到了网页上。所有读写都在你的浏览器和键盘之间完成，没有服务端，配置数据不会离开本机。

- **灯光**：18 种实机确认过的灯效、亮度与速度档位、颜色与 RGB 轮换；切到「自定义」灯效后可以逐键取色，并支持色板与颜色表导入导出。
- **键位**：读取并完整写回 384 字节键位表。点击任意键位会自动弹出编辑弹窗，可以点选新键位、直接绑定板载宏，也可以拖动键帽把两个键的绑定互换。
- **宏**：实时录制普通键盘事件，逐条调整延时，保存到 M1–M10 槽位，再回到键位页绑定到任意按键。
- **数据**：首次读取自动备份到浏览器；写入前逐项列出待修改内容，确认后才下发；写入后回读校验。

| 项目 | 说明 |
| --- | --- |
| 支持设备 | GeekElite Lio 87（`VID:PID` = `320F:5055`，厂商配置通道 `FF1C:0092`） |
| 运行环境 | 桌面版 Chrome / Edge 等支持 WebHID 的浏览器 |
| 形态 | 纯静态前端，可直接托管在任意静态站点服务上 |

## 安装与运行

需要 **Node.js 22 或更新版本**（Vite 7 实际要求 `^20.19.0 || >=22.12.0`；仓库根目录带有 `.node-version`，用 nvm / fnm / volta 等版本管理器会自动切到 22），以及一个支持 WebHID 的桌面 Chrome 或 Edge。

```powershell
npm install
npm run dev
```

终端会打印本地地址（默认 `http://127.0.0.1:5173/`），打开后点击「连接 Lio 87」，在浏览器弹窗里选中设备并授权即可。首次连接会自动读取键位与板载宏。

> WebHID 只能在安全上下文里使用，`localhost` 和 HTTPS 都算安全，所以本地开发和线上部署都能正常连接。线上请务必使用 HTTPS。

## 数据与安全

配置数据只在**当前浏览器**和**键盘**之间流转，没有服务端、没有账号，也不会向任何服务器上传内容。

- **自动备份**：首次成功读取的 384 字节键位表会存进当前浏览器的 `localStorage`。写入前必须已经存在这份备份，避免改坏之后没有退路。
- **导出留档**：当前配置、首次备份、板载宏、逐键颜色表都可以导出为 `.bin` 文件长期保存。注意清理浏览器站点数据会连同本地备份一起删除，重要配置请自己导出留存。
- **写入前先确认**：所有写入统一走右上角的保存按钮，弹窗会一条条列出这次要改的内容，确认后才真正下发。
- **写完会核对**：键位表按完整 384 字节写回，写完后重新读取设备当前配置逐字节比对；宏写入后同样回读校验。万一没对上，页面会提示你直接试按键盘确认。
- **失败就停手**：任何写入中断、超时或校验失败都会立刻停止流程并断开设备，不会留下改到一半的状态。
- **关于逐键颜色**：设备没有读取逐键颜色的命令，所以颜色表只保存在本地浏览器（可导出留档），实际效果需要你观察键盘确认。

更底层的报文格式、事务顺序与宏存储结构，见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 与 [`docs/`](docs/) 下的实机抓包记录。

## 部署

构建产物是纯静态文件（`dist/`），推荐直接托管在 **Cloudflare Pages**：

1. 控制台 → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**，选择本仓库
2. 构建配置：
   - Build command：`npm test && npm run build`
   - Build output directory：`dist`
   - Root directory：留空（仓库根）
3. 环境变量新增 `NODE_VERSION` = `22`（Pages 构建镜像的默认 Node 版本可能偏低，不设置会构建失败）
4. **Save and Deploy**；之后推送到 `main` 会自动重新部署，PR 也会自动生成预览地址

不想接 Git 也可以直接命令行上传：

```powershell
npm run build
npx wrangler@latest pages deploy dist --project-name geekelite-lio87
```

### 如果部署成 Worker（`npx wrangler deploy`）

Cloudflare 新建项目现在默认走 **Worker** 流程，部署命令是 `npx wrangler deploy`。这条路径**必须**依赖仓库根的 `wrangler.jsonc` 把 `assets` 指向构建产物：

```jsonc
"assets": { "directory": "./dist" }
```

否则 Wrangler 不知道 `dist/` 是什么，只会发布一个空的 Worker——访问任何路径都固定返回 `Hello World!`，看起来就像部署失败了。加好配置后重新构建并部署，部署日志会打印上传的文件数（正常是 4 个：`index.html`、`favicon.svg` 和 `assets/` 下的 css、js）；显示 0 个就说明 `directory` 指错了。另外 `wrangler.jsonc` 里的 `name` 要与 Cloudflare 上那个 Worker 同名，否则会另建一个新 Worker。

两个注意点：WebHID 需要 HTTPS（Cloudflare 默认提供）；**不要把页面嵌进 iframe**——浏览器默认会拦掉 iframe 里的 HID 权限，连接会静默失败。

## 开发

```powershell
npm test        # 协议与设备层单元测试（vitest）
npm run build   # 类型检查 + 生产构建
```

技术栈：React 19 + TypeScript + Vite 7 + Tailwind CSS + shadcn/ui。

代码分为「设备协议层（`src/protocol.ts`、`src/device.ts`、`src/lighting.ts`、`src/keymap.ts`、`src/macro.ts`）→ 会话层（`src/hooks/useLio87Session.ts`）→ 视图层（`src/views/`）」三层，分层职责与关键数据流见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。实机抓包与逆向笔记见 [`docs/`](docs/)。

## 致谢

由 **DeepSeek**、**ChatGPT** 与 **CC米饭** 共同制作。

键盘固件与通信协议均未公开，本项目基于实机抓包与逆向分析实现，属非官方社区工具，与厂商无关联。使用前请先做好备份，风险自负。
