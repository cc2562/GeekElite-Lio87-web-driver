# GeekElite Leo87 非官方驱动逆向笔记
> 目标：为已停止维护/倒闭厂商的 GeekElite Leo87 补做一个可用的 Windows 驱动或配置工具。  
> 本文整理目前已经通过实机验证的 HID 接口、RGB 控制、Keymap 读写、侧边快捷键行为与注意事项。  
> **不包含完整主键区键位表**；建议由设备拥有者另附 `leo87_keymap.bin` / 128-record 对照表。

---

## 1. 设备基本信息

### USB / HID
- Manufacturer String: `Telink`
- Product String: `GeekElite Leo87`
- VID: `0x320F`
- PID: `0x5055`
- bcdDevice / Release: `0x0108`
- USB Full-Speed
- 2 个 USB Interface

### HID 相关接口
设备可枚举出以下 HID collection：

- `Usage Page 0x0001 / Usage 0x0006`：Keyboard
- `Usage Page 0x0001 / Usage 0x0080`：System Control
- `Usage Page 0x000C / Usage 0x0001`：Consumer Control
- `Usage Page 0xFF1C / Usage 0x0092`：**厂商自定义配置通道**
- `Usage Page 0x0001 / Usage 0x0000`：Generic Desktop Aux
- `Usage Page 0x0001 / Usage 0x0002`：Mouse

最关键的是：

```text
VID        0x320F
PID        0x5055
Usage Page 0xFF1C
Usage      0x0092
Report ID  0x04
```

### Report Descriptor 关键部分

`FF1C:0092` 定义了：

- Report ID: `0x04`
- Output Report: 63 bytes payload
- Input Report: 63 bytes payload

因此 USB HID report 总长为：

```text
1 byte Report ID + 63 bytes payload = 64 bytes
```

对应 USB 端点：
- IN  endpoint `0x82`, 64 bytes
- OUT endpoint `0x05`, 64 bytes

---

## 2. Windows / hidapi 注意事项

在 Python `hidapi` 下：

### 写入
```python
dev.write(bytes([0x04]) + payload_63_bytes)
```

### 读取
Windows 下 `dev.read(64)` 返回的数据**包含 Report ID**：

```text
data[0] = 0x04
data[1:] = 63-byte payload
```

这一点很重要。此前曾因为把 `data[0]` 当 payload 起始而误判返回格式。

---

## 3. 通用校验和

目前 RGB、Keymap GET/SET 数据包都验证出相同规律：

```python
checksum = sum(payload[2:]) & 0xFFFF
payload[0] = checksum & 0xFF
payload[1] = (checksum >> 8) & 0xFF
```

也就是：

```text
payload[0] = checksum low byte
payload[1] = checksum high byte
```

校验范围是从 `payload[2]` 一直到 63-byte payload 末尾。

---

# 4. RGB 灯光控制

WOB 网页驱动虽然并非 Leo87 原生驱动，但其 RGB 控制协议与 Leo87 **高度兼容**，并已通过实机验证。

## 4.1 RGB 写入事务

WOB 页面每次更改 RGB 时通常发送 3 个 Report：

### Begin
```text
01 00 01 00 00 00 ... 共 63 bytes
```

### Lighting payload
示例：静态红色

```text
3A 02 06 27 00 00 00 00 06 04 04 00 00 FF 00 00 ...
```

### End / Commit
```text
02 00 02 00 00 00 ... 共 63 bytes
```

实践中，自制 RGB 脚本按以下流程发送可正常生效：

```python
send_report(BEGIN_FRAME)
send_report(LIGHT_PACKET)
send_report(END_FRAME)
```

---

## 4.2 已确认的 RGB 字段

63-byte lighting payload 中：

```text
offset  9 = brightness
offset 12 = color/effect mode flag
offset 13 = R
offset 14 = G
offset 15 = B
```

### 亮度
已验证：
- `0x00` = 最低 / 关闭级别
- `0x04` = 亮度等级 4

目前实测范围为：
```text
0 ~ 4
```

### 静态 / RGB 轮换
已验证：

```text
payload[12] = 0x00  -> 静态颜色
payload[12] = 0x01  -> RGB 轮换
```

### RGB
已验证直接使用 RGB 3 通道：

```text
payload[13] = R
payload[14] = G
payload[15] = B
```

例如：

```text
FF 00 00 -> 红色
FF A8 00 -> 橙色
FF F0 05 -> 黄色
00 D7 0F -> 绿色
00 99 FF -> 浅蓝
31 53 FF -> 深蓝
5E 01 D2 -> 深紫
EE 00 F1 -> 浅紫
FF 00 8A -> 粉色
```

任意 RGB 值已验证可用，例如：

```text
RGB(123,45,67)
= 7B 2D 43
```

只要修改 13~15 字节并重算 checksum 即可。

---

## 4.3 RGB 最小发送示例

```python
def make_light_packet(r, g, b, brightness=4, rainbow=False):
    packet = bytearray(LIGHT_TEMPLATE)

    packet[9] = brightness
    packet[12] = 1 if rainbow else 0
    packet[13] = r
    packet[14] = g
    packet[15] = b

    checksum = sum(packet[2:]) & 0xFFFF
    packet[0] = checksum & 0xFF
    packet[1] = (checksum >> 8) & 0xFF

    return bytes(packet)
```

已验证自制 Python 工具可以成功设置任意颜色。

---

# 5. Keymap 读取

这是目前最重要的成果之一：**Leo87 可以直接读出当前完整 Keymap。**

## 5.1 Keymap 总大小

完整 keymap：

```text
384 bytes
```

每条 record：

```text
3 bytes
```

因此：

```text
384 / 3 = 128 records
```

可视为：

```text
8 rows × 16 columns
```

即：

```text
record index = row * 16 + column
```

完整主键区 record 表建议单独附上，不在本文展开。

---

## 5.2 GET Keymap 命令

命令字：

```text
0x07
```

请求 payload 结构：

```text
byte 0-1 : checksum LE
byte 2   : 0x07            # GET
byte 3   : length
byte 4   : offset low
byte 5   : offset high
byte 6   : 0x00
byte 7.. : 0 padding
```

完整 384 bytes 分 7 段读取：

```text
offset 0x0000, length 0x38
offset 0x0038, length 0x38
offset 0x0070, length 0x38
offset 0x00A8, length 0x38
offset 0x00E0, length 0x38
offset 0x0118, length 0x38
offset 0x0150, length 0x30
```

对应请求头：

```text
3F 00 07 38 00 00 00
77 00 07 38 38 00 00
AF 00 07 38 70 00 00
E7 00 07 38 A8 00 00
1F 01 07 38 E0 00 00
58 00 07 38 18 01 00
88 00 07 30 50 01 00
```

---

## 5.3 GET 响应格式

Windows `hidapi` 返回：

```text
[0]      Report ID = 0x04
[1..2]   checksum
[3]      command = 0x07
[4]      length
[5..6]   offset LE
[7]      reserved = 0x00
[8..]    keymap data
```

例如第一个块：

```text
04 3F 00 07 38 00 00 00
20 00 29
20 00 3A
20 00 3B
...
```

---

# 6. Keymap 写入

## 6.1 SET 命令

命令字：

```text
0x09
```

结构：

```text
byte 0-1 : checksum LE
byte 2   : 0x09             # SET
byte 3   : length
byte 4   : offset low
byte 5   : offset high
byte 6   : 0x00
byte 7.. : keymap data
```

WOB 页面写 keymap 时会按与 GET 相同的 7 个区块写入。

---

## 6.2 事务语义非常重要

Keymap 写入不能只发一个 chunk 后直接 Commit。

WOB 正常逻辑更接近：

```text
BEGIN
  SET chunk 0x0000
  SET chunk 0x0038
  SET chunk 0x0070
  SET chunk 0x00A8
  SET chunk 0x00E0
  SET chunk 0x0118
  SET chunk 0x0150
END / COMMIT
```

### 已踩过的坑
曾尝试：

```text
BEGIN
SET single chunk
END
```

结果 Leo87 把其余未填充区域当成空数据提交，导致大量按键失效，连 `Fn+Esc` 都无法工作。

最终通过 WOB 网页的 Reset 功能恢复。

### 因此建议
真正的驱动应：

1. 先 GET 完整 384-byte 当前 keymap
2. 本地备份
3. 只在内存副本中修改目标 record
4. 将**完整 7 个 chunk**重新写回
5. 最后 Commit

绝对不要使用错误的 75% 模板覆盖 Leo87。

---

# 7. Key Record 编码规律

不展开完整键位表，只记录编码格式。

## 7.1 普通 Keyboard 键

常见格式：

```text
20 00 XX
```

其中 `XX` 为标准 USB HID Keyboard Usage。

例如：

```text
20 00 04 -> A
20 00 05 -> B
20 00 28 -> Enter
20 00 2C -> Space
20 00 4B -> PageUp
20 00 4E -> PageDown
```

---

## 7.2 Modifier

Leo87 使用 bitfield 形式：

```text
20 01 00
20 02 00
20 04 00
20 08 00
20 10 00
20 20 00
20 40 00
```

分别对应 HID modifier bit。

例如已确认：
- Left Ctrl
- Left Shift
- Left Alt
- Left GUI
- Right Ctrl
- Right Shift
- Right Alt

完整键位位置请参考独立 keymap 表。

---

## 7.3 Consumer Control

侧边媒体快捷键对应 record 中出现：

```text
30 B6 00
30 B5 00
```

分别对应：
- Previous Track
- Next Track

因此 `0x30` 很可能代表 Consumer Control 类型 record。

---

# 8. 左侧 / 侧边快捷键

这是 Leo87 比普通 TKL 多出来的重要功能区。

## 8.1 滚轮

实机 HID 监听：

### 向上滚动 / 音量加
```text
Report ID 3
03 E9 00
```

Consumer Usage：

```text
0x00E9 = Volume Increment
```

### 向下滚动 / 音量减
```text
03 EA 00
```

Consumer Usage：

```text
0x00EA = Volume Decrement
```

松开后通常：

```text
03 00 00
```

---

## 8.2 上一曲 / 下一曲

### 前侧键：上一曲
```text
03 B6 00
```

Usage：

```text
0x00B6 = Scan Previous Track
```

### 后侧键：下一曲
```text
03 B5 00
```

Usage：

```text
0x00B5 = Scan Next Track
```

Keymap 中也观察到：

```text
30 B6 00
30 B5 00
```

与实际 HID 输出一致。

---

## 8.3 两个灯光实体按钮

Leo87 左侧还有两个灯光按钮：
- 主键盘灯开关
- 底部 / 侧边灯带开关

主机端监听到的 Consumer Control report **完全相同**：

```text
03 01 04
```

即：

```text
Consumer Usage = 0x0401
```

无论：
- 单击
- 长按
- 两键同时按

主机侧看到的仍然相同。

因此可以推断：

- 两个灯光键的区别主要由键盘 MCU 内部处理
- 主机侧仅靠 Consumer HID report 无法区分两颗实体键
- 若要重映射这两颗键，需要继续找 keymap 中的特殊 vendor record / 内部功能 ID

---

# 9. 特殊 record

在 Leo87 原厂 keymap 中观察到若干非普通 Keyboard / Consumer 格式：

```text
A0 40 00
A0 45 00
20 08 0F
A0 01 00
```

这些很可能对应：
- Fn
- 灯光控制键
- 特殊层切换
- 内部功能键
- 其它 vendor-specific action

**目前尚未完全确认具体对应关系。**

驱动实现时不应擅自修改这些 record。

---

# 10. WOB 网页驱动兼容性结论

网址：

```text
https://wobwxe.com/
```

### 已验证兼容
- RGB 动效切换
- RGB 预设颜色
- 亮度
- RGB 轮换
- Keymap GET
- Keymap SET
- Reset

### 不完全兼容
WOB 网页识别 Leo87 后套用了 **75% / 81-key 布局模板**，而 Leo87 是 TKL/87-key。

因此直接使用网页 Keymap 保存会：
- 覆盖 Leo87 原厂 TKL 专属槽位
- 导致 Pause / Home / Delete / End / Space / 右侧 modifier 等键异常或失效
- 某些情况下甚至造成大面积键位失效

但其底层协议本身与 Leo87 高度兼容，因此非常适合作为逆向参考。

---

# 11. 建议的正式驱动架构

推荐把最终驱动分成几个模块。

## Device
负责：
- 查找 `VID 320F / PID 5055`
- 查找 `FF1C:0092`
- 打开 Report ID 4
- HID 收发

## Protocol
负责：
- checksum
- 63-byte payload
- GET / SET
- Begin / Commit

## RGB
负责：
- brightness
- static RGB
- RGB cycle
- 后续灯效枚举

## Keymap
负责：
- GET 384 bytes
- 保存 backup
- 解析 128 × 3-byte record
- 修改指定 record
- 完整 7-chunk 写回
- restore backup

## Side Controls
负责：
- Consumer Control 监听
- Previous / Next
- Volume Up / Down
- 后续探索两个灯光实体键

## Safety
强烈建议加入：
- 首次运行自动 dump 当前 keymap
- 自动保存 `factory/current backup`
- 修改前做 diff
- 禁止只写单 chunk 后 Commit
- 禁止修改未知 `A0 xx xx` record
- 提供一键 restore
- 提供 dry-run
- 修改前显示即将变动的 record

---

# 12. 建议保存的辅助文件

交给 Codex / 后续开发时建议一起提供：

```text
leo87_protocol.md              # 本文
leo87_keymap.bin               # 原厂 384-byte dump
leo87_keymap_raw.txt           # GET 原始响应
leo87_keymap_table.md          # 用户自行附上的完整键位表
rgb_capture_examples.txt       # WOB RGB 抓包
```

---

# 13. 已验证的最小事实清单

截至目前，以下结论经过 Leo87 实机验证：

- `320F:5055`
- Manufacturer `Telink`
- Product `GeekElite Leo87`
- Vendor HID = `FF1C:0092`
- Report ID = `4`
- 63-byte payload
- 16-bit little-endian 累加 checksum
- `0x07` = Keymap GET
- `0x09` = Keymap SET
- Keymap = 384 bytes = 128 × 3-byte records
- GET 按 7 个 block 读取
- 普通键 record 常见格式为 `20 00 XX`
- Consumer media record 可见 `30 B6 00 / 30 B5 00`
- RGB 的 R/G/B 位于 payload 13/14/15
- brightness 位于 payload 9
- static / RGB-cycle flag 位于 payload 12
- 自制 Python RGB 控制已成功
- 自制 Python Keymap dump 已成功
- WOB Reset 可以恢复错误 Keymap
- 左侧滚轮与上一曲/下一曲均已确认对应 Consumer Usage
- 两颗灯光实体键主机侧都报告 `0x0401`，无法仅靠 HID 输入区分

---

## 最后的开发原则

**先读、再改、完整写回。**

Leo87 的协议本身并不难，真正的风险主要来自：
1. 使用了错误的 75% keymap 模板；
2. 只写单个 chunk 后直接 Commit；
3. 修改未知 vendor-specific record。

只要最终驱动始终以 Leo87 自己实时读出的 384-byte keymap 为基准，再做最小 diff，整体是可以做得很安全的。
