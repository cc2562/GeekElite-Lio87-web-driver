# GeekElite Leo87 灯光 / RGB 动画协议逆向笔记

> 本文整理 GeekElite Leo87 实机 + WOB WebHID 抓包得到的灯光协议。  
> 重点包括：预设动画编号、RGB 参数、亮度、以及“自定义逐键灯光”的 384-byte RGB Map。
>
> 本文只记录当前抓包能够支持的结论；未验证字段会明确标为“待确认”。

---

# 1. 灯光配置通道

Leo87 使用厂商 HID：

```text
VID        = 0x320F
PID        = 0x5055
Usage Page = 0xFF1C
Usage      = 0x0092
Report ID  = 0x04
```

每个 HID Report：

```text
1-byte Report ID + 63-byte payload
```

Windows / hidapi 写入：

```python
dev.write(bytes([0x04]) + payload)
```

---

# 2. Checksum

目前灯光相关数据包继续符合已经验证过的 16-bit little-endian 累加校验：

```python
checksum = sum(payload[2:]) & 0xFFFF

payload[0] = checksum & 0xFF
payload[1] = (checksum >> 8) & 0xFF
```

---

# 3. 普通灯效写入事务

切换普通灯效时，WOB 会发送：

```text
BEGIN
LIGHT_CONFIG
END
```

## BEGIN

```text
01 00 01 00 00 00 ...
```

## END

```text
02 00 02 00 00 00 ...
```

## LIGHT_CONFIG

核心命令为：

```text
06 27
```

典型 payload：

```text
?? ?? 06 27 00 00 00 00 EE BB SS 00 MM RR GG BB ...
```

其中：

```text
payload[0..1]  = checksum
payload[2]     = 0x06
payload[3]     = 0x27
payload[8]     = effect_id
payload[9]     = brightness
payload[10]    = speed（数值越小越快：0 最快、4 最慢）
payload[12]    = 颜色 / RGB-cycle 类模式参数
payload[13]    = R
payload[14]    = G
payload[15]    = B
```

注意：

- `payload[8] = effect_id` 已由大量模式切换抓包直接确认。
- `payload[9] = brightness` 已在此前实验确认。
- `payload[10]` 已实机确认为速度档位，且**数值越小动画越快**：`0` 最快、`4` 最慢。
  本批抓包中各灯效样本恒为 `0x04`，因此早期只标为“疑似 speed”；后来的实机逐档观察推翻了“数值越大越快”的直觉标注。
  注意该结论来自实机观察，尚未逐灯效复核每个档位是否都有可见差异。
- `payload[12]` 已在此前静态色 / RGB 轮换测试中表现为模式标志。
- `payload[13:16]` 为 RGB 已实机确认。

---

# 4. 预设动画 ID

本次实机抓包得到以下对应关系：

| Effect ID | WOB 名称 |
|---:|---|
| `0x01` | 波浪 |
| `0x02` | 彩虹 |
| `0x03` | 转圈 |
| `0x04` | 光谱 |
| `0x05` | 呼吸 |
| `0x06` | 常亮 |
| `0x07` | 按键反应 |
| `0x08` | 涟漪 |
| `0x09` | 奔腾 |
| `0x0A` | 繁星 |
| `0x0B` | 百花齐放 |
| `0x0C` | 滚动 |
| `0x0D` | 大鹏展翅 |
| `0x0E` | 厚积薄发 |
| `0x0F` | 雨中漫步 |
| `0x10` | 扫描 |
| `0x11` | **本次未抓到 / 未确认** |
| `0x12` | 跑马灯 |
| `0x13` | 自定义 |

因此驱动里不要自行给 `0x11` 命名，等后续实机补测。

---

# 5. RGB / 亮度字段

此前已经通过自制 Python 程序实机验证：

```text
payload[9]  = brightness
payload[13] = R
payload[14] = G
payload[15] = B
```

亮度目前观察范围：

```text
0x00 ~ 0x04
```

例如：

```text
FF 00 00 = 红色
00 D7 0F = 绿色
00 99 FF = 浅蓝
31 53 FF = 深蓝
5E 01 D2 = 紫色
FF 00 8A = 粉色
```

任意 RGB 值也已经成功设置。

---

# 6. 自定义模式

普通“切换到自定义模式”仍然先发送标准灯光配置：

```text
effect_id = 0x13
```

例如：

```text
?? ?? 06 27 00 00 00 00 13 04 04 ...
```

需要特别区分：**单键自定义并不等于支持任意 RGB 调色。** WOB 的单键界面只提供有限/预设颜色；抓包里虽然使用 3-byte 颜色值传输，但这不能直接推出固件或 UI 支持任意逐键 RGB。

但真正修改逐键颜色时，会出现另一组命令：

```text
0x0B
```

这是本次最重要的新发现。

---

# 7. 自定义逐键颜色 Map

自定义灯光使用：

```text
command = 0x0B
```

数据按与 Keymap 完全相同的 offset 方式分块：

```text
0x0000 length 0x38
0x0038 length 0x38
0x0070 length 0x38
0x00A8 length 0x38
0x00E0 length 0x38
0x0118 length 0x38
0x0150 length 0x30
```

即总数据量：

```text
0x180 = 384 bytes
```

而：

```text
384 / 3 = 128
```

因此可以确认：

> 自定义灯光区也是一张 **128 × 3-byte** 的表。

---

# 8. 最关键发现：颜色 Map 与 Keymap Record 对齐

目前实机结果高度一致地证明：

```text
RGB record N
```

与：

```text
Keymap record N
```

使用相同的 8×16 / 128-record 位置编号。

每个自定义灯光 record 占 3 bytes。抓包中这些 3 bytes 与选中的颜色值对应，但 **WOB 的单键自定义界面并不支持任意 RGB 输入/任意 RGB 动画**。

因此这里更准确地称为：

```text
3-byte per-key color value
```

当前样本看起来采用 RGB 三通道形式编码（例如 `FF 00 00`、`00 D7 0F`），但 UI 侧只允许选择它提供的固定/有限颜色，而不是开放任意 RGB 调色。

所以：

```text
rgb_offset = record_index * 3
```

例如：

```python
record = 59
offset = record * 3
# 177 decimal = 0xB1
```

如果在颜色 Map 的 `0xB1` 写入：

```text
FF 72 00
```

就是给 **Record 59 对应的物理 LED** 设置该颜色。

---

# 9. 实机错位样本反而证明了 Record 对齐

WOB 使用的是错误的 75% 可视布局，因此 UI 中点击的键，并不一定对应 Leo87 的实际 LED。

这次恰好利用这种错位确认了 RGB Map 的 record 机制。

## 样本 A

WOB UI：

```text
左 Shift 亮灯
```

Leo87 实际：

```text
右侧 ' 键亮灯
```

抓包中颜色落在与 Leo87 Keymap 某个对应 record 一致的位置。

## 样本 B

WOB UI：

```text
] 亮灯
```

Leo87 实际：

```text
P 亮灯
```

同样可以通过：

```text
absolute RGB byte offset / 3
```

还原到实际 Record。

## 样本 C

WOB UI：

```text
Q 亮红灯
```

Leo87 实际：

```text
Home 亮红
```

颜色数据：

```text
FF 00 00
```

落在 Home 对应 record 的 RGB 三字节位置。

## 样本 D

WOB UI：

```text
V 亮绿灯
```

Leo87 实际：

```text
PageDown 亮绿
```

对应颜色：

```text
00 D7 0F
```

也落在 PageDown 对应 record 的 RGB 位置。

因此正式驱动**不应该使用 WOB 的 75% 图形键位映射**。

正确方式：

```text
Leo87 自己的 Keymap Record Table
        ↓
同 record index
        ↓
Custom RGB Map
```

---

# 10. 自定义颜色写入格式

每个 chunk：

```text
byte 0-1 = checksum LE
byte 2   = 0x0B
byte 3   = length
byte 4   = offset low
byte 5   = offset high
byte 6   = 0x00
byte 7.. = RGB map chunk
```

例如：

```text
?? ?? 0B 38 A8 00 00 [56 bytes RGB data]
```

最后一块：

```text
?? ?? 0B 30 50 01 00 [48 bytes RGB data]
```

---

# 11. 自定义颜色 Buffer

推荐驱动内部直接维护：

```python
color_map = bytearray(384)
```

设置一个 record：

```python
def set_record_color(color_map, record, c0, c1, c2):
    pos = record * 3

    color_map[pos + 0] = c0
    color_map[pos + 1] = c1
    color_map[pos + 2] = c2
```

例如：

```python
set_record_color(color_map, 63, 0, 215, 15)
```

就是：

```text
Record 63 = RGB(0, 215, 15)
```

具体 Record 63 对应哪个实体键，应由 Leo87 自己的键位表决定。

---

# 12. 写入完整自定义颜色 Map

建议采用完整事务：

```text
BEGIN

0B 38 0000
0B 38 0038
0B 38 0070
0B 38 00A8
0B 38 00E0
0B 38 0118
0B 30 0150

END
```

也就是：

```text
01 00 01 ...
[7 × Custom color chunks]
02 00 02 ...
```

不要使用 WOB 的视觉键位编号生成 Leo87 RGB buffer。

---

# 13. 为什么自定义模式比普通动画复杂

普通动画只需要告诉固件：

```text
effect
brightness
speed
color
...
```

动画由键盘 MCU 自己生成。

而自定义模式实际上还有第二层：

```text
Effect Config
+
384-byte per-record color map
```

因此可以理解为：

```text
Effect 0x13
    ↓
启用 Custom 模式

Command 0x0B
    ↓
给 128 个矩阵/LED record 分别指定单键颜色值
```

---

# 14. 与 Keymap 的关系

当前可以把两者理解成：

```text
Keymap:
128 records × 3 bytes
→ 每个 Record 描述“这个位置按下做什么”

Custom color map:
128 records × 3 bytes
→ 每个 Record 描述“这个位置显示什么单键颜色”
```

两张表都使用相同 record index。

因此正式驱动 UI 最好维护一份唯一的：

```text
Leo87 physical position → record index
```

然后同时供：

```text
Key Remap
Macro Binding
Per-key color
```

使用。

这样不会再受 WOB 75% 布局错位影响。

---

# 15. 当前已知灯效结构速查

```text
Report ID:
04

Light config:
06 27

Effect ID:
payload[8]

Brightness:
payload[9]

Speed:
payload[10]    # 数值越小越快：0 最快、4 最慢

Mode / color behavior:
payload[12]

RGB:
payload[13]
payload[14]
payload[15]

Custom effect:
0x13

Custom color map SET:
0x0B

Custom color map size:
384 bytes

Per-light record:
3-byte color value

> 当前抓包与 RGB 三通道数值一致，但 WOB 单键界面不开放任意 RGB 输入，因此不要把这里描述成“支持任意逐键 RGB”。

Record count:
128

Custom color record index:
与 Keymap record index 对齐
```

---

# 16. 下一步建议测试

目前最值得继续抓的不是更多颜色，而是几个**单变量实验**：

1. ~~同一个 Effect，只修改速度滑块，确认 `payload[10]`~~ —— 已完成：`payload[10]` 是速度档位，且数值越小越快（`0` 最快、`4` 最慢）。
   仍可补做的是逐灯效复核每个档位是否都有可见差异，以及速度与亮度是否互相影响。
2. 同一个 Effect，只修改方向，找 direction 字段；
3. 补抓 Effect `0x11`；
4. 看自定义 RGB Map 是否存在对应 GET 命令；
5. 测试自定义模式下：
   - 单键 RGB
   - 多键 RGB
   - 全键 RGB
   - `00 00 00` 是否代表关闭；
6. 测试亮度是否影响 Custom RGB Map，还是只由全局 brightness 统一缩放。

---

# 17. 驱动实现建议

建议拆成：

```text
LightingController
├── set_effect(effect_id)
├── set_brightness(level)
├── set_speed(level)
├── set_color(r, g, b)
└── set_custom_map(rgb_map)

CustomColorMap
├── records[128]
├── set_record(index, color)
├── clear_record(index)
├── clear_all()
└── serialize() -> 384 bytes
```

GUI 层则使用真正的 Leo87 TKL 实体布局，把每个可视按键绑定到其实际 `record_index`。

---

## 当前结论

普通动画：

```text
0x01 ~ 0x13 中已确认大部分 Effect ID
payload[9]  = brightness，0 ~ 4
payload[10] = speed，数值越小越快（0 最快、4 最慢）
payload[12] = 0 静态色 / 1 RGB 轮换
payload[13..15] = R G B
```

自定义动画：

```text
0x13 = Custom Mode
0x0B = Custom RGB Map write
384 bytes
128 records
3 bytes / record
R G B
```

最重要的是：

> **自定义单键颜色 Map 与 Leo87 Keymap 使用同一套 Record 索引。**

这意味着只要已有正确的 Leo87 物理键位 → Record 对照表，就可以直接实现准确的逐键颜色编辑器，而不必继续依赖 WOB 的错误 75% 键盘布局。
