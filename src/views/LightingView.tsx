import { useEffect, useRef, type CSSProperties } from 'react'
import { Download, Eraser, Lightbulb, Palette, Plus, Sparkles, Upload, X } from 'lucide-react'

import { PageHeader } from '@/components/app/PageHeader'
import { SaveButton, SaveSlotOutlet, type PendingChange } from '@/components/app/SaveButton'
import { SkeuKeyboard, type KeyStateInfo } from '@/components/keyboard/SkeuKeyboard'
import { isUncolored, resolveKeycapState } from '@/components/keyboard/keyboardHelpers'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import type { Lio87Session } from '@/hooks/useLio87Session'
import { CUSTOM_EFFECT_ID, EFFECT_OPTIONS, PRESET_COLORS, colorAt, effectLabel, hexColor } from '@/lighting'
import { keyLabel } from '@/keymap'
import { cn } from '@/lib/utils'

const PALETTE_SWATCH = 'keycap h-9 w-9 shrink-0 rounded-full'

export function LightingView({ session }: { session: Lio87Session }) {
  const {
    hasDevice, busy, color, setColor, brightness, setBrightness, speed, setSpeed, effectId, setEffectId,
    colorMode, setColorMode, applyLighting, colorMap, colorDifferences, coloredCount,
    selected, selectedColor, colorSelection, selectColorRecord, applyColorToSelection, clearSelectionColors,
    clearAllKeyColors, applyCustomColorMap, importColorMap, downloadColorMapFile, colorFileInput,
    palette, addPaletteColor, removePaletteColor,
  } = session

  const paletteInputRef = useRef<HTMLInputElement | null>(null)

  const working = Boolean(busy)
  // 逐键颜色只在「自定义」灯效下才有意义：设备会先切到自定义灯效再写整张颜色表。
  const customMode = effectId === CUSTOM_EFFECT_ID
  const colorDirty = customMode && colorDifferences.length > 0
  const applyBusy = busy === '应用灯光' || busy === '应用逐键颜色'
  const selectionCount = colorSelection.length
  const swatchesDisabled = working || selectionCount === 0

  // 系统取色器在拖动过程中会连续触发 input 事件，只在确认（原生 change）后写入色板，
  // 否则滑动一次就会把途经的所有颜色都加进来。
  useEffect(() => {
    const input = paletteInputRef.current
    if (!input) return
    const commit = () => addPaletteColor(input.value)
    input.addEventListener('change', commit)
    return () => input.removeEventListener('change', commit)
  }, [customMode, addPaletteColor])

  const resolve = (index: number, defaultLabel: string): KeyStateInfo => {
    const value = colorAt(colorMap, index)
    const blank = isUncolored(value)
    return {
      label: defaultLabel,
      state: resolveKeycapState({ selected: colorSelection.includes(index), color: value, colorMode: true }),
      color: blank ? undefined : hexColor(value),
      title: blank ? keyLabel(index) : `${keyLabel(index)} · ${hexColor(value)}`,
    }
  }

  const changes: PendingChange[] = [
    { label: '灯效', detail: effectLabel(effectId) },
    { label: '亮度', detail: `${brightness} / 4` },
    { label: '速度档位', detail: `${speed} / 4` },
    { label: '颜色模式', detail: colorMode === 'cycle' ? 'RGB 轮换' : '静态色' },
    { label: '颜色', detail: color.toUpperCase() },
    ...(customMode
      ? colorDifferences.slice(0, 10).map(change => ({
          label: `逐键颜色 · ${keyLabel(change.index)}`,
          detail: `${hexColor(change.before)} → ${hexColor(change.after)}`,
        }))
      : []),
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="01 / LIGHTING"
        title="光效，"
        highlight="看得见。"
        description="选择灯效，微调亮度、速度与颜色。切到「自定义」灯效后，还可以逐键设置颜色。"
      >
        {customMode && (
          <Badge variant={colorDirty ? 'warning' : 'muted'}>
            {colorDirty ? `${colorDifferences.length} 处颜色变更` : '颜色表无变更'}
          </Badge>
        )}
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-primary" />
            灯光与动画
          </CardTitle>
          <CardDescription>保存后请观察键盘确认效果。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-5">
            <div className="relative h-44 overflow-hidden rounded-xl border border-stone-800 bg-stone-950">
              <div
                className="absolute inset-0 animate-glow-pulse blur-3xl"
                style={{ background: `radial-gradient(circle at 50% 55%, ${color}, transparent 62%)` }}
              />
              <div className="relative z-10 flex h-full flex-col items-center justify-center gap-2">
                <span
                  className="font-display text-4xl font-extrabold tracking-[0.28em] text-white"
                  style={{ textShadow: `0 0 26px ${color}` }}
                >
                  LIO87
                </span>
                <span className="text-[11px] tracking-[0.2em] text-stone-400">
                  {effectLabel(effectId)} · {colorMode === 'cycle' ? 'RGB 轮换' : '静态色'}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <Label>灯效</Label>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {EFFECT_OPTIONS.map(effect => {
                  const active = effect.id === effectId
                  return (
                    <button
                      key={effect.id}
                      type="button"
                      disabled={working}
                      onClick={() => setEffectId(effect.id)}
                      title={effect.label}
                      className={cn(
                        'rounded-lg border px-2 py-2 text-xs font-semibold transition-all',
                        active
                          ? 'border-primary bg-accent text-primary shadow-sm ring-1 ring-primary/30'
                          : 'border-border bg-card text-muted-foreground hover:border-brand-300 hover:text-foreground',
                        working && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      {effect.label}
                    </button>
                  )
                })}
              </div>
              {!customMode && (
                <p className="rounded-lg border border-dashed border-brand-200 bg-accent/50 px-3 py-2 text-xs leading-relaxed text-accent-foreground">
                  想逐键设置颜色？选择「自定义」灯效即可。
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-6 lg:border-l lg:border-border lg:pl-6">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">速度档位</span>
                <span className="font-mono text-xs text-primary">{speed} / 4</span>
              </div>
              <Slider
                aria-label="速度档位"
                min={0}
                max={4}
                step={1}
                value={[speed]}
                disabled={working}
                onValueChange={value => setSpeed(value[0])}
              />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>最快</span>
                <span>最慢</span>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">亮度等级</span>
                <span className="font-mono text-xs text-primary">{brightness} / 4</span>
              </div>
              <Slider
                aria-label="亮度等级"
                min={0}
                max={4}
                step={1}
                value={[brightness]}
                disabled={working}
                onValueChange={value => setBrightness(value[0])}
              />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>关闭</span>
                <span>最亮</span>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="light-color">灯光颜色</Label>
                <div className="flex items-center gap-2">
                  <Switch
                    id="cycle"
                    checked={colorMode === 'cycle'}
                    disabled={working}
                    onCheckedChange={checked => setColorMode(checked ? 'cycle' : 'static')}
                  />
                  <Label htmlFor="cycle" className="cursor-pointer text-xs text-muted-foreground">
                    RGB 轮换
                  </Label>
                </div>
              </div>
              <div className="flex items-center gap-2 self-start rounded-md border border-input bg-card px-2.5 py-1.5 shadow-sm">
                <input
                  id="light-color"
                  type="color"
                  value={color}
                  disabled={working}
                  onChange={event => setColor(event.target.value)}
                  className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-0"
                />
                <span className="font-mono text-xs">{color.toUpperCase()}</span>
              </div>
            </div>

            <div className="mt-auto flex items-start gap-2 rounded-lg border border-brand-100 bg-accent/60 px-3 py-2.5 text-xs leading-relaxed text-accent-foreground">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {customMode
                ? '保存时会一并下发灯光参数与逐键颜色。'
                : '选择「自定义」灯效后，保存会同时写入逐键颜色。'}
            </div>
          </div>
        </CardContent>
      </Card>

      {customMode && (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Palette className="h-4 w-4 text-primary" />
                逐键颜色
              </CardTitle>
              <CardDescription className="mt-1.5">
                点击键盘上的键位取色；按住 Ctrl 点击可以多选，颜色会同时应用到选中的键位。
              </CardDescription>
            </div>
            <Badge variant="muted" className="shrink-0">
              已设置 {coloredCount} / 128 个键
            </Badge>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="rounded-xl border border-border bg-gradient-to-b from-stone-100/80 to-card p-3 sm:p-4">
              <SkeuKeyboard
                resolve={resolve}
                onSelect={selectColorRecord}
                disabled={!hasDevice || working}
                sideControls={[]}
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
              <div className="flex flex-col gap-4">
                {selected === null || !selectedColor ? (
                  <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
                    {hasDevice ? '选择键盘上的按键为该键位设置颜色。' : '连接设备后即可逐键取色。'}
                  </p>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                      <div className="flex min-w-0 flex-col">
                        <span className="text-xs text-muted-foreground">
                          {selectionCount > 1 ? `已选 ${selectionCount} 个键位` : '当前键位'}
                        </span>
                        <span className="truncate text-sm font-semibold">
                          {selectionCount > 1 ? '颜色将同时应用' : keyLabel(selected)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {isUncolored(selectedColor) ? (
                          <span className="text-xs text-muted-foreground">未设置</span>
                        ) : (
                          <>
                            <span
                              className="h-6 w-6 rounded-md border border-border"
                              style={{ background: hexColor(selectedColor) }}
                            />
                            <code className="font-mono text-xs text-primary">{hexColor(selectedColor)}</code>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 rounded-md border border-input bg-card px-2.5 py-1.5 shadow-sm">
                        <input
                          type="color"
                          aria-label="自定义颜色"
                          value={hexColor(selectedColor)}
                          disabled={working}
                          onChange={event => applyColorToSelection(event.target.value)}
                          className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-0"
                        />
                        <span className="font-mono text-xs">自定义</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={clearSelectionColors} disabled={working}>
                          <Eraser className="h-3.5 w-3.5" />
                          清除颜色
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={clearAllKeyColors}
                          disabled={working || coloredCount === 0}
                        >
                          全部清除
                        </Button>
                      </div>
                    </div>
                  </>
                )}

                <div className="flex flex-col gap-2">
                  <Label className="text-xs">预设色板</Label>
                  <div className="flex flex-wrap gap-2">
                    {PRESET_COLORS.map(preset => (
                      <button
                        key={preset.hex}
                        type="button"
                        data-state="colored"
                        disabled={swatchesDisabled}
                        title={`${preset.label} · ${preset.hex}`}
                        aria-label={`${preset.label} ${preset.hex}`}
                        onClick={() => applyColorToSelection(preset.hex)}
                        style={{ '--key-color': preset.hex } as CSSProperties}
                        className={cn(
                          PALETTE_SWATCH,
                          selectedColor && hexColor(selectedColor) === preset.hex
                            ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                            : '',
                          swatchesDisabled && 'cursor-not-allowed opacity-50',
                        )}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs">我的色板</Label>
                    <span className="text-[10px] text-muted-foreground">添加后保存在本浏览器</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {palette.map(hex => (
                      <div key={hex} className="group relative">
                        <button
                          type="button"
                          data-state="colored"
                          disabled={swatchesDisabled}
                          title={`${hex}（点击应用到当前键位）`}
                          aria-label={`应用 ${hex}`}
                          onClick={() => applyColorToSelection(hex)}
                          style={{ '--key-color': hex } as CSSProperties}
                          className={cn(
                            PALETTE_SWATCH,
                            selectedColor && hexColor(selectedColor) === hex
                              ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                              : '',
                            swatchesDisabled && 'cursor-not-allowed opacity-50',
                          )}
                        />
                        <button
                          type="button"
                          aria-label={`从我的色板删除 ${hex}`}
                          onClick={() => removePaletteColor(hex)}
                          className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}

                    <label
                      title="添加自定义颜色"
                      className="relative grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full border-2 border-dashed border-brand-300 text-primary transition-colors hover:border-primary hover:bg-accent"
                    >
                      <Plus className="h-4 w-4" />
                      <input
                        ref={paletteInputRef}
                        type="color"
                        aria-label="添加自定义颜色"
                        defaultValue="#F97316"
                        className="absolute inset-0 h-full w-full cursor-pointer border-0 bg-transparent p-0 opacity-0"
                      />
                    </label>
                  </div>
                  {palette.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">点击 + 挑选颜色，即可加入我的色板。</p>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-4 lg:border-l lg:border-border lg:pl-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">待写入颜色差异</span>
                  <span className="font-mono text-xs text-primary">
                    {colorDifferences.length ? `${colorDifferences.length} 个键` : '无变更'}
                  </span>
                </div>
                <div className="scrollbar-thin max-h-52 flex-1 overflow-auto rounded-lg border border-border bg-muted/30">
                  {colorDifferences.length ? (
                    <ul className="divide-y divide-border">
                      {colorDifferences.slice(0, 12).map(change => (
                        <li key={change.index} className="flex items-center justify-between px-3 py-2 text-xs">
                          <span>{keyLabel(change.index)}</span>
                          <code className="font-mono text-primary">
                            {hexColor(change.before)} → {hexColor(change.after)}
                          </code>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="py-10 text-center text-sm text-muted-foreground">
                      点选键位并选择颜色后，差异会显示在这里。
                    </p>
                  )}
                </div>
                {colorDifferences.length > 12 && (
                  <p className="text-xs text-muted-foreground">另有 {colorDifferences.length - 12} 条差异</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={downloadColorMapFile} disabled={working}>
                    <Download className="h-3.5 w-3.5" />
                    导出颜色表
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => colorFileInput.current?.click()} disabled={working}>
                    <Upload className="h-3.5 w-3.5" />
                    导入颜色表
                  </Button>
                  <input
                    ref={colorFileInput}
                    type="file"
                    accept=".bin,application/octet-stream"
                    hidden
                    onChange={event => {
                      const file = event.target.files?.[0]
                      if (file) void importColorMap(file)
                    }}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <SaveSlotOutlet>
        <SaveButton
          changes={changes}
          onConfirm={() => {
            if (colorDirty) applyCustomColorMap()
            else applyLighting()
          }}
          disabled={!hasDevice}
          busy={applyBusy}
          label="保存灯光"
          dialogHint={
            colorDirty
              ? `将下发灯光参数，并为 ${colorDifferences.length} 个键写入新颜色。`
              : '将下发当前灯效、亮度、速度、颜色与轮换设置。'
          }
          confirmLabel={colorDirty ? '写入颜色表' : '下发灯光设置'}
          emptyHint="连接设备后即可保存灯光"
        />
      </SaveSlotOutlet>
    </div>
  )
}
