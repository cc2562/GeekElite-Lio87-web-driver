# GeekElite Leo87 宏功能逆向笔记

> 本文只整理 **Macro / 宏功能**。  
> 结论来自 GeekElite Leo87 实机 + WOB WebHID 抓包验证。  
> 为了方便后续交给 Codex / 驱动开发，本文把“已实机验证”和“推断”分开写。

---

# 1. 宏功能结论

Leo87 的固件确实具备板载宏功能，并且宏数据可以：

- 写入键盘；
- 从键盘重新读取；
- 持久化保存；
- 通过普通按键触发；
- 设置不同停止方式；
- 设置“播放 N 次后停止”。

目前已经实机跑通：

```text
按键 A
→ 绑定 M2
→ M2 内容为 A key down + A key up
→ 按下 A 后正常执行宏
```

因此 Macro 并不是网页端模拟，而是键盘 MCU / 固件自身执行。

---

# 2. Macro 数据区 GET / SET

## 2.1 GET Macro

已抓到：

```text
0x14 = GET Macro Data
```

典型读取：

```text
14 38 00 00
14 38 38 00
```

也就是按 offset 分块读取。

请求 payload：

```text
byte 0-1 : checksum LE
byte 2   : 0x14
byte 3   : length
byte 4   : offset low
byte 5   : offset high
byte 6   : 0x00
byte 7.. : 0 padding
```

实机示例：

```text
4C 00 14 38 00 00 00 ...
84 00 14 38 38 00 00 ...
```

响应会返回当前键盘中保存的宏数据。

---

## 2.2 SET Macro

已抓到：

```text
0x15 = SET Macro Data
```

写入结构：

```text
byte 0-1 : checksum LE
byte 2   : 0x15
byte 3   : length
byte 4   : offset low
byte 5   : offset high
byte 6   : 0x00
byte 7.. : macro data
```

实机示例：

```text
15 38 00 00 ...
15 38 38 00 ...
```

键盘会回显 / ACK 同一段数据。

---

# 3. Macro Storage 总体结构

当前观察到的 Macro storage 由：

```text
Header
Offset Table
Macro Entries
```

组成。

典型开头（实机：只序列化了 1 个 entry）：

```text
0x00  AA 55                              magic
0x02  1A 00                              used_end = 0x001A = 26
0x04  01 00                              entry_count = 1
0x06  00 00 00 00 00 00 00 00 00 00      reserved（10 字节）
0x10  12 00                              offsets[0] = 0x0012
0x12  01 00 35 00 66 03 0A 04            M1：action_count = 1，marker，870 ms 后 A 抬起
```

WOB 完整保存 M1–M10 时（entry_count = 10，M1/M2 各有 2 条动作）：

```text
0x00  AA 55        magic
0x02  5C 00        used_end = 0x5C
0x04  0A 00        entry_count = 10
0x06              reserved
0x10  24 00        offsets[0]
0x12  30 00        offsets[1]
0x14  3C 00        offsets[2]
      ...
0x22  58 00        offsets[9]
0x24              entries...
```

两次抓包唯一的差别是 `entry_count` 与随之变化的 offset table / used_end。
Storage 里存的是「当前有哪些 entry」，不是「设备支持 10 个宏」。

---

## 3.1 Magic

```text
AA 55
```

已多次稳定出现。

可视为：

```text
Macro Storage Magic
```

---

## 3.2 宏数量

`0x04` 的 uint16 是 **storage 里当前序列化的 entry 数量**：

```text
01 00
```

表示：

```text
entry_count = 1
```

也就是当前只存了 1 个 entry（实机抓包，M1 里有一条 A 抬起）。

之前看到：

```text
0A 00
```

一度被当成「设备固定支持 10 个宏」。实际含义是：

```text
entry_count = 10
```

即 WOB 保存整张表时把所有 10 个 entry 都写了下来。

结论：

- `M1 ~ M10` 是**可绑定槽位容量**，第 i 个 entry 对应 M(i+1)；
- storage **不保证永远序列化 10 个 entry**，合法范围是 `1 ≤ entry_count ≤ 10`；
- 所以 `01 00` 不是异常，`0A 00` 也不是常量。

---

## 3.3 Offset Table

offset table 从**固定位置 `0x10`** 开始，长度由 `entry_count` 决定：

```text
offset_table_size = entry_count × 2
```

实机 `entry_count = 1`：

```text
0x10  12 00   → offsets[0] = 0x0012
```

WOB 完整保存 `entry_count = 10`：

```text
0x10  24 00   → M1 start
0x12  30 00   → M2 start
0x14  3C 00   → M3 start
0x16  40 00   → M4 start
0x18  44 00   → M5 start
0x1A  48 00   → M6 start
0x1C  4C 00   → M7 start
0x1E  50 00   → M8 start
0x20  54 00   → M9 start
0x22  58 00   → M10 start
```

于是第一个 entry 的起点就是：

```text
entry_start = 0x10 + entry_count × 2
```

- `entry_count = 1` → `0x12`
- `entry_count = 10` → `0x24`

这也解释了之前为什么会看到 `M1 offset = 0x24`：那次抓包正好是 10 个 entry。

offset 会随着前面宏的长度变化。

因此 Macro Entry 是**变长结构**，不是固定长度 slot。

---

## 3.4 used/end offset

Header 的 `0x02` 是 uint16 小端：

```text
uint16 used_end
```

它的含义是 **storage 的结束位置**，也就是最后一个 entry 的末尾：

```text
used_end = 0x10 + entry_count × 2 + Σ entry_size
entry_size = 4 + action_count × 4
```

实机样本（`entry_count = 1`，M1 = 1 条动作，entry_size = 8）：

```text
0x10 + 1 × 2 = 0x12     第一个 entry 起点
0x12 + 8     = 0x1A     used_end
```

所以抓到的：

```text
1A 00
```

即 `used_end = 26`，**完全合法**。

WOB 完整保存（`entry_count = 10`，M1/M2 各 2 条动作，其余空）：

```text
0x10 + 10 × 2 = 0x24     第一个 entry 起点
0x24 + (12 + 12 + 4 × 8) = 0x24 + 56 = 0x5C
```

即之前看到的：

```text
5C 00
```

命名建议保留 `used_end`，并加上注释：

```text
// inferred from live captures
```

---

# 4. Macro Entry

每个宏自身都有一个 4-byte header。

**顺序是 action_count 在前、marker 在后**：

```text
02 00 35 00
```

其中：

```text
02 00
```

是：

```text
action_count = 2
```

随后：

```text
35 00
```

是 Macro Entry 的固定 marker / type。

因此：

```c
struct MacroEntryHeader {
    uint16 action_count;
    uint16 marker;        // 0x0035
}
```

空宏：

```text
00 00 35 00
```

占 4 bytes。

entry 总长度：

```text
entry_size = 4 + action_count × 4
```

> 勘误：早期版本把这两字段写反成 `35 00 <action_count>`。
> 原因是当时只看到 `35 00 02 00` 这类出现在数据边界上的片段，
> 误把 marker 当成了 entry 起点，让整个 entry 起点错开了 2 字节。
> 实机 `entry_count = 1`、`offset = 0x12`、`used_end = 0x1A` 的样本可以同时闭环验证正确顺序。

---

# 5. Macro Action

目前普通键盘按键 action 已经实机验证为固定 4 bytes：

```text
<uint16 delay_ms>
<uint8 event_type>
<uint8 HID_usage>
```

即：

```c
struct MacroAction {
    uint16 delay_ms;
    uint8  event_type;
    uint8  hid_usage;
}
```

---

# 6. Key Down / Key Up 编码

实机测试：

```text
A 按下：1 ms
A 抬起：0 ms
```

对应：

```text
01 00 8A 04
00 00 0A 04
```

其中：

```text
04 = USB HID Keyboard Usage: A
```

因此已确认：

```text
0x8A = Keyboard Key Down
0x0A = Keyboard Key Up
```

两者正好：

```text
0x8A = 0x0A | 0x80
```

所以：

```text
bit 7 = press/down flag
```

对于普通键盘事件，目前可写：

```text
0A = release
8A = press
```

---

# 7. Delay

delay 为：

```text
uint16 little-endian
```

并且 WOB UI 中单位为：

```text
ms
```

实机样本：

```text
01 00 = 1 ms
64 00 = 100 ms
E8 03 = 1000 ms
```

例如：

```text
E8 03 8A 04
```

表示：

```text
延时 1000 ms
A down
```

### UI 行为

WOB 页面目前观察到：

```text
Key Down 最小值 = 1 ms
Key Up 可为 0 ms
```

注意：

> 这是 **WOB UI 已验证的限制**，不一定等于 Leo87 固件本身禁止 0 ms Key Down。

正式驱动可以先沿用：

```text
press delay >= 1
release delay >= 0
```

---

# 8. 一个完整宏示例

M2：

```text
A down after 1 ms
A up after 0 ms
```

Macro Entry：

```text
02 00 35 00
01 00 8A 04
00 00 0A 04
```

解析：

```text
02 00       action_count = 2
35 00       Macro Entry Marker

01 00       delay = 1 ms
8A          key down
04          HID A

00 00       delay = 0 ms
0A          key up
04          HID A
```

该结构已经在 Leo87 上成功执行。

## 8.1 实机单 entry 样本（完整 storage）

抓到的 26 字节 storage：

```text
AA 55 1A 00 01 00 00 00 00 00 00 00 00 00 00 00
12 00 01 00 35 00 66 03 0A 04
```

逐字段解析：

```text
0x00  AA 55        magic
0x02  1A 00        used_end = 26
0x04  01 00        entry_count = 1
0x06  00 ×10        reserved
0x10  12 00        offsets[0] = 0x0012   （= 0x10 + 1 × 2）
0x12  01 00        action_count = 1
0x14  35 00        marker = 0x0035
0x16  66 03        delay = 0x0366 = 870 ms
0x18  0A 04        A key up
0x1A               ← used_end
```

闭环校验：

```text
0x12 + 4 + 1 × 4 = 0x1A = used_end ✅
```

这个样本既是 `entry_count < 10` 的实例，也是 entry 头顺序的实证。

---

# 9. Macro Trigger Record

普通 Keymap record 为：

```text
3 bytes
```

宏 trigger 同样存放在 Keymap record 中。

---

## 9.1 M1 ~ M10 索引

已实机验证：

```text
M1  = 70 00 00
M2  = 70 01 00
M10 = 70 09 00
```

因此可以确认：

```text
70 <macro_index> <mode>
```

其中：

```text
macro_index = zero-based
```

即：

```text
M1  -> 00
M2  -> 01
M3  -> 02
M4  -> 03
M5  -> 04
M6  -> 05
M7  -> 06
M8  -> 07
M9  -> 08
M10 -> 09
```

---

# 10. 三种基础停止模式

以 M2 为例：

```text
正常停止   -> 70 01 00
释放停止   -> 70 01 01
按下停止   -> 70 01 02
```

因此：

```text
byte0 = 0x70
byte1 = macro index
byte2 = stop/play mode
```

已确认：

```text
mode 0x00 = 正常停止
mode 0x01 = 释放停止
mode 0x02 = 按下停止
```

---

# 11. 播放 N 次后停止

WOB UI 还有一种：

```text
播放 N 次后停止
```

实机测试：

```text
M2
播放 21 次后停止
```

Keymap record：

```text
71 01 15
```

由于：

```text
0x15 = 21 decimal
```

且：

```text
0x01 = M2 zero-based index
```

因此目前可确认：

```text
71 <macro_index> <repeat_count>
```

例如：

```text
71 01 15
```

即：

```text
播放 M2 21 次后停止
```

所以很可能：

```text
0x70 = normal macro trigger family
0x71 = repeat-N-times macro trigger family
```

### 推荐解析

```c
if (record[0] == 0x70) {
    macro_index = record[1];
    mode = record[2];
}

if (record[0] == 0x71) {
    macro_index = record[1];
    repeat_count = record[2];
}
```

---

# 12. Macro Trigger 当前已知格式

## 普通模式

```text
70 NN MM
```

其中：

```text
NN = macro index
MM = stop/play mode
```

---

## 播放 N 次

```text
71 NN CC
```

其中：

```text
NN = macro index
CC = repeat count
```

---

# 13. 目前已验证的 Macro Trigger 示例

```text
70 00 00 = M1 / 正常停止
70 01 00 = M2 / 正常停止
70 01 01 = M2 / 释放停止
70 01 02 = M2 / 按下停止
70 09 00 = M10 / 正常停止

71 01 15 = M2 / 播放 21 次后停止
```

---

# 14. 为什么之前 ABCD 宏没有正常工作

最初曾录制：

```text
A
B
C
D
```

但只有按下动作，没有对应释放动作。

类似：

```text
64 00 0A/8A 04
64 00 0A/8A 05
64 00 0A/8A 06
64 00 0A/8A 07
```

缺少完整的：

```text
down
up
```

配对。

后来改为：

```text
A down
A up
```

后宏可以正常执行。

因此驱动的 Macro Editor 应避免产生“只有按下没有抬起”的普通按键序列，除非用户明确需要 held-key 行为。

---

# 15. 驱动实现建议

## Macro Editor

推荐内部数据结构：

```python
class MacroAction:
    delay_ms: int
    pressed: bool
    hid_usage: int

class Macro:
    actions: list[MacroAction]
```

序列化：

```python
event_type = 0x8A if pressed else 0x0A

data = (
    delay_ms.to_bytes(2, "little")
    + bytes([event_type, hid_usage])
)
```

Macro entry：

```python
entry = (
    len(actions).to_bytes(2, "little")
    + b"\x35\x00"
    + b"".join(serialized_actions)
)
```

Macro storage：

```python
entry_count = len(entries)
table_end = 0x10 + entry_count * 2
used_end = table_end + sum(len(entry) for entry in entries)

offsets = []
offset = table_end
for entry in entries:
    offsets.append(offset)
    offset += len(entry)

storage = (
    b"\xaa\x55"
    + used_end.to_bytes(2, "little")
    + entry_count.to_bytes(2, "little")
    + bytes(10)                                       # reserved
    + b"".join(value.to_bytes(2, "little") for value in offsets)
    + b"".join(entries)
)
```

---

## Offset Table

每次修改宏之后：

1. 从第一个 Macro Entry 开始重新排列；
2. 重新计算 M1~M10 offset；
3. 更新 `used_end`；
4. 重新生成完整 macro storage；
5. 用 `0x15` 分块完整写回。

不要只在原 byte array 中强行塞入变长 entry，否则会破坏后续宏 offset。

---

# 16. 安全建议

正式驱动建议：

- 修改宏前先 `0x14 GET` 完整 Macro Storage；
- 自动保存原始备份；
- 校验 `AA 55` magic；
- 校验 `used_end` 落在 `0x10 + 2 + 4` 到安全上限之间；
- 读取 `entry_count`，校验 `1 ≤ entry_count ≤ 10`；
- offset table 从 `0x10` 开始，长度 `entry_count × 2`；
- 校验所有 offsets 单调递增、且第一个 offset ≥ `0x10 + entry_count × 2`；
- 逐个 entry 校验：`offset+0x00` 是 `action_count`，`offset+0x02` 是 `35 00` marker；
- 校验每个 entry 的 `4 + action_count × 4` 与相邻 offset 的差值一致；
- 校验最后一个 entry 的末尾 == `used_end`（最宽松可接受 `≤ used_end`）；
- 校验 `used_end` 不超过实际读取到的 buffer 长度；
- 写入前生成完整 storage，写入后再 `0x14 GET` 并 byte-by-byte verify；
- keymap trigger 与 macro storage 分开保存；
- 不要把 Macro SET 和 Keymap SET 混为一条事务。

> 不要为了「通过校验」放宽阈值。`used_end` 与 offsets、entry 长度之间应该是互相闭环的关系，
> 任一处对不上时拒绝解析，比猜一个能读通的解释更安全。

---

# 17. 当前协议速查

```text
Macro GET:
0x14

Macro SET:
0x15

Macro storage magic:
AA 55

Macro storage Header:
0x00 uint16 magic = 0x55AA
0x02 uint16 used_end
0x04 uint16 entry_count     1 ~ 10
0x06 10 bytes reserved
0x10 uint16 offsets[entry_count]

Macro entry:
<action_count:uint16> 35 00 <actions...>
entry_size = 4 + action_count × 4

Macro action:
<delay_ms:uint16> <event_type:uint8> <hid_usage:uint8>

Keyboard release:
0A

Keyboard press:
8A

Macro trigger:
70 <macro_index> <mode>

Macro repeat-N:
71 <macro_index> <repeat_count>

Macro index:
M1  = 00
M2  = 01
...
M10 = 09

Normal modes:
00 = 正常停止
01 = 释放停止
02 = 按下停止
```

---

# 18. 尚未完全逆向的部分

目前仍建议继续研究：

- `0x70` 是否还有 mode `03+`
- `0x71` 的 repeat count 是否支持 0、255 等边界值
- 是否有无限循环编码
- Consumer Control 在宏里的 action type
- Mouse action 的编码
- Modifier / 组合键宏的 event_type
- Header 中 `0x06–0x0F` 保留字段是否存在非零值（目前抓包均为 0）
- `entry_count = 0` 是否会出现（当前实机最少为 1，尚未观察到空 storage）
- 最大 action 数量
- delay 最大值是否实际为 `65535 ms`

---

## 当前结论

Leo87 的宏系统已经基本跑通：

```text
Macro storage Header ✅
used_end 语义        ✅
entry_count 语义     ✅
动态 offset table    ✅
宏数据读取       ✅
宏数据写入       ✅
M1~M10           ✅
变长 Entry        ✅
Action Count      ✅
Delay             ✅
Key Down          ✅
Key Up            ✅
普通触发          ✅
停止模式          ✅
播放 N 次         ✅
板载执行          ✅
```

已经足够实现一个可用的 Macro Editor。

Storage 结构现在完全闭环：

```text
used_end = 0x10 + entry_count × 2 + Σ (4 + action_count × 4)
```

这个等式同时约束 Header、offset table 和每个 entry，
任何一项对不上都说明数据或解析有误，可以直接拒绝而不必猜测。

> 复盘：`used_end = 0x001A` 曾一度被当成「存储损坏」。
> 真正的原因是两处结构误读——entry 头字段顺序写反、把 `entry_count` 当成固定 10。
> 两个误读叠加后，`0x1A` 落到了「比最小 Header 还小」的位置，看起来就像坏数据。
> 结构修正后，同一段字节是完全合法的 storage。
