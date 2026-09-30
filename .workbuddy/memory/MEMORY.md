# Leo87 Studio 项目长期记录

## 设备与协议

- 配置接口：WebHID `VID 0x320F / PID 0x5055 / Usage Page 0xFF1C / Usage 0x0092 / Report ID 4`，payload 固定 63 字节，byte0-1 为 byte2 起的 16 位小端累加校验和，命令字在 byte2。
- Keymap：384 字节、128 条 3 字节 record，读 `0x07`/`0x08`（写后刷新统一用 `0x08` 七段事务），写 `0x09` 七段 + Begin/End。

## 宏存储（Macro Storage）结构 —— 实机抓包确认

```text
0x00  AA 55                 magic
0x02  used_end   uint16 LE  storage 结束位置
0x04  entry_count uint16 LE 当前序列化的 entry 数量（1–10），不是固定 10
0x06  reserved             10 字节（目前抓包均为 0）
0x10  offsets[entry_count] uint16 LE，offset table 长度 = entry_count × 2
entries...                 每个 entry 起于对应 offset
```

每个 entry：

```text
offset + 0x00  action_count uint16 LE
offset + 0x02  marker 0x0035
offset + 0x04  actions[action_count]，每条 4 字节：delay_ms:uint16 LE + event_type:uint8 + hid_usage:uint8
entry_size = 4 + action_count × 4
```

闭环约束（唯一判据）：

```text
used_end = 0x10 + entry_count × 2 + Σ (4 + action_count × 4)
```

- M1–M10 只是键位可绑定的槽位容量，第 i 个 entry 对应 M(i+1)；storage 不保证序列化 10 个 entry。
- 曾把 entry 头误读为 `35 00 <action_count>`、把 `0x04` 当成固定 10，导致 `entry_count=1 / used_end=0x1A` 的合法数据被判为损坏。已修正，勿再回退。
- 诊断入口：`inspectMacroHeader()` + `MacroLayoutError`（携带 56 字节探测样本与报告）；原始样本可经 `downloadRawMacro` 导出（跳过校验）。

## 工程约定

- 校验失败一律“拒绝解析 + 保留原始样本 + 给诊断报告”，禁止用放宽阈值的方式绕过。
- 写宏门禁不可削弱：必须有首次备份、写入前 `0x14` 范围探测、写入后逐字节回读比对。
- 回复用户时给文件路径与行号，先确认方案再实现。
