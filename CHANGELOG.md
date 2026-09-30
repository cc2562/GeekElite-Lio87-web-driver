# Changelog

本文件记录 Leo87 Studio 的主要功能变化、协议调整和已知问题。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。当前项目尚未发布正式稳定版本。

## [Unreleased]

### Added

- 新增灯光动画（灯效）设置：
  - `payload[8]` 灯效 ID 改为可选，覆盖 `docs/GeekElite_Leo87_Lighting_Protocol.md` §4 中实机确认的全部 18 个灯效；
  - 未确认的 `0x11` 不进入界面、也不在 `lighting.ts` 的灯效表里，`assertEffectId` 会在下发前拒绝；
  - `payload[10]` 暴露为速度档位 0–4（默认 1）。实机观察确认该字段**数值越小越快**：`0` 最快、`4` 最慢，因此界面档位说明按“最快 → 最慢”标注，并写明数字变大时动画反而变慢；
  - `payload[12]` 由 `rainbow` 布尔量改为 `mode: 'static' | 'cycle'`，行为与已验证的 0/1 一致；
  - 预览卡与通知改为显示当前灯效名与档位。
- 新增逐键颜色（自定义灯光）功能：
  - `src/lighting.ts`：384 字节颜色表数据模型（`colorAt` / `withRecordColor` / `clearRecordColor` / `clearColorMap` / `diffColorMap` / `coloredRecordCount`）、`0x0B` 分段报文、预设色板与 `#RRGGBB` 解析；
  - 键位面板新增「改键 / 逐键颜色」模式切换，复用同一张 TKL 键盘图与 keymap record 索引，键帽直接以该 record 的颜色呈现；
  - 「应用到键盘」在同一个事务内先切到自定义灯效 `0x13`，再完整写入 7 段颜色数据，提供差异预览并禁止无变更提交；
  - `src/colorMapBackup.ts`：颜色表保存在当前站点的 `localStorage`，支持导出 / 导入 384 字节 `.bin`。
- 新增板载宏协议模块：
  - `0x14` 宏数据分段读取；
  - `0x15` 宏数据分段写入与 ACK 校验；
  - `AA 55` Magic、`used_end`、`entry_count`（1–10）、变长 offset table、entry marker 与 action count 校验；
  - M1–M10 变长 entry 重建，以及 `entry_count` / offset / `used_end` 重算；
  - 每个宏最多 90 条动作。
- 新增宏实时录制界面：
  - 记录普通键盘 keydown、keyup 和事件间隔；
  - 忽略长按产生的重复 keydown；
  - 停止录制时补齐仍处于按下状态的键；
  - 支持逐条调整延时；
  - 键位解析按 `KeyboardEvent.code` → 旧式 `keyCode` → `key` 三级降级，未映射时明确报告而不是静默丢弃；
  - 录制监视条分离显示“按下 / 抬起 / 记录 / 忽略”计数，并给出最近一次事件的原因；另可展开“最近 8 个键盘事件”，每行含方向、原始 `code / key / keyCode`、解析结果、忽略原因与 `repeat`、`composing` 标记；
  - 只剩抬起事件时（输入法把字母键的按下截成 `Process / keyCode 229`）自动按“一次敲击 = 按下 + 抬起”补录，并在横幅说明这是补录结果；按下延时取事件间隔，敲击时长取本次不可用按下到抬起的间隔；
  - 检测到输入法组合输入（`compositionstart`）时提示切换到英文输入。
- 新增宏触发绑定：
  - M1–M10；
  - 正常停止、释放停止、按下停止；
  - 播放 1–255 次后停止。
- 新增独立的宏首次读取备份、`.bin` 导入导出和恢复入口。
- 新增宏协议、变长 entry、触发 record、设备读写中断、错位响应、超时及回读不一致测试。
- 新增宏读取失败的诊断链路：
  - `MacroLayoutError` 携带首次 56 字节探测样本与可复制的诊断报告；
  - 报告按实际结构解读：`magic`、`used_end`（小端与大端读法）、`entry_count`、保留区、offset table 中每一项的 `offset / action_count / marker / entry_end`，以及 `35 00` 出现位置和 hexdump；
  - 新增“导出原始转储”和“导出诊断报告”，未通过结构校验的样本也能保存；宏区域可展开查看报告文本。

### Changed

- 修正速度档位的方向标注：`payload[10]` 越小动画越快，界面端点由「最慢 / 最快」改为「最快 / 最慢」，并说明数字往右变大时动画变慢（此前按“越大越快”标注，与实际行为相反）。
- `lightPacket` 的入参由 `{ color, brightness, rainbow }` 改为 `{ effectId, brightness, speed, mode, color }`，字段位置严格对应协议笔记：`payload[8] = effectId`、`[9] = brightness`、`[10] = speed`、`[12] = mode`、`[13..15] = RGB`；校验和、`payload[27] = 0xff`、`payload[36] = 0x01` 保持不变。
- `Leo87Connection.setLighting` 在发送前做灯效白名单校验；新增 `setCustomColorMap(colorMap, lighting)`，事务为 `BEGIN → 自定义灯效 → 7 段 0x0B → END`，任一分段失败即中止且不发送结束帧。
- 修正宏存储结构的两处误读（由实机抓包闭环验证）：
  - Macro Entry 头顺序是 `<action_count:uint16> 35 00`，此前误读为 `35 00 <action_count>`，导致 entry 起点错开 2 字节；
  - Header `0x04` 是**当前序列化的 entry 数量**（1–10），不是固定值 10，offset table 长度随之等于 `entry_count × 2`。
  - 结果：`entry_count = 1` 的实机 storage 现在正常解析——`offsets[0] = 0x12`（`0x10 + 1 × 2`）、`0x12 + 4 + 1 × 4 = 0x1A = used_end`；此前判定为“used_end 无效：26”的数据确认完全合法。
  - `used_end` 下界改为“固定 Header + 1 个 offset + 1 个空 entry”，并新增闭环校验 `used_end = 0x10 + entry_count × 2 + Σ entry_size`。
- 编辑器槽位模型跟随调整：设备未序列化的槽位显示为“尚未序列化”，可录制并在保存时补建空 entry；已有 entry 不会被重新编号，清空槽位也不会删除 entry。
- 宏区域标题改为显示 `${usedEnd} 字节 · ${entryCount} 个 entry`。
- 宏读取失败时不再丢弃设备已回送的数据：首次探测窗口会保留到页面供导出与诊断使用（此前失败样本会被清空，与界面“仍可导出”的提示不符）。
- 首次 `0x14` 探测长度提取为常量 `MACRO_HEADER_PROBE`，并注明固定 Header 与 offset table 必须落在该窗口内，才能在不写设备的前提下判断结构。

- 宏录制的键位来源由单一 `KeyboardEvent.code` 改为 `resolveKeyUsage` 的三级降级，避免在 `code` 缺失的环境（部分内嵌浏览器、虚拟键盘）里整类按键都录不进去。
- 录制过程不再有静默忽略分支：未映射的键、重复按下、缺少对应抬起记录、达到 90 条动作上限都会在监视条写明原因。此前这些分支直接 `return`，用户只能看到“按键没反应”。
- 实机定位到「数字键能录、字母键没反应」的原因：输入法在中文模式下会截走字母键的 `keydown`（变成 `Process / keyCode 229`，且没有可用的 `code`），只有带着真实键位的 `keyup` 会到达页面，于是字母的按下被忽略、抬起也因“没有对应的按下记录”被忽略。数字键在中文输入法下直接透传，所以两件事都正常——这也是该现象只在字母区出现的原因。
- 录制中点击其它槽位不再静默停止录制：会先把当前槽位的动作保留为草稿并给出提示，避免“切了槽位后按键全部失灵”的误解。

- 键位图会显示设备当前读取到的动作。已改键位显示新动作名称，并使用琥珀色键帽区分。
- 修正左 Win 被错误识别为改键的问题；Win 与 Ctrl、Shift、Alt 一样识别左右修饰键别名。
- 写入键位后的刷新改用完整的 `Begin → Current Config → 7 × 0x08 → End` 读取事务。
- GET 回读不一致不再直接断言实体写入失败，页面会保留当前状态并提示待确认。
- 键盘图中的所有已显示位置均允许重新指定动作，包括读取到未知编码的位置。
- 滚轮向上和滚轮向下加入键位编辑，分别对应 record 83 和 84。

### Known Issues

- `entry_count = 0`（从未保存过任何宏的 storage）尚未在实机观察到，当前解析要求 `1 ≤ entry_count ≤ 10`；若实机出现，会以“entry 数量超出 1–10”拒绝并保留诊断报告，需再确认空 storage 的真实形态。
- Header 的 `0x06–0x0F` 保留字段（目前抓包均为 0）、storage 总容量与完整事务包围方式仍待更多实机抓包确认。
- Consumer Control、鼠标、修饰键组合及其他特殊宏事件尚未开放录制。
- 小键盘（`Numpad*`）键位目前未映射为 HID usage，录制时会明确显示“未映射”，不会被写入宏。
- 敲击补录只生成「按下 + 抬起」两条动作，无法还原真实按住时长与组合键（同时按住多个键）关系。要把时序录准，请在录制前把输入法切到英文。
- 向尚未序列化的槽位写入（即写入后 `entry_count` 变大）的设备行为尚未实机验证；写回仍以“写入前范围探测 + 逐字节回读”为唯一判据，不一致时拒绝并保留原数据。
- 宏读取与写入仍属实验功能：结构校验失败时页面不会写入宏数据，键位和灯光功能不受影响。
- 逐键颜色表没有对应的读取命令（协议笔记 §16 的待确认项），因此不做回读校验：页面显示的始终是本地工作表，无法确认设备实际值，也无法在重连后还原键盘上的真实颜色。
- 灯效方向字段、未抓到的 `0x11` 以及 `00 00 00` 是否表示关闭都尚未实机验证，本次均未实现对应功能。
- 速度档位只确认了“数值越小越快”，尚未逐灯效复核每个档位是否都有可见差异，也未验证速度与亮度是否互相影响。

## [0.1.0] - 2026-09-30

### Added

- 建立 Vite、React 19 和 TypeScript 网页项目。
- 使用 WebHID 连接 `320F:5055 / FF1C:0092 / Report ID 4` 配置接口。
- 新增静态 RGB、亮度 0–4 和 RGB 轮换控制。
- 新增 384 字节 keymap 七段读取、完整写回和备份恢复。
- 新增中文 TKL 键盘布局、当前动作查看、差异预览和原始 128 条 record 查看。
- 支持标准键、修饰键、媒体键及已确认的上一曲、下一曲编码。
