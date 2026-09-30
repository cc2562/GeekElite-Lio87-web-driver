import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { MacroTriggerMode } from '@/macro'

export const TRIGGER_MODES: Array<{ value: MacroTriggerMode; label: string; hint: string }> = [
  { value: 'normal', label: '正常停止', hint: '再次按下该键时停止播放' },
  { value: 'release', label: '释放停止', hint: '松开按键即停止播放' },
  { value: 'press', label: '按下停止', hint: '按下按键时停止播放' },
  { value: 'repeat', label: '播放次数', hint: '按指定次数循环播放' },
]

type MacroBindingFormProps = {
  bindingMacro: number
  bindingMode: MacroTriggerMode
  repeatCount: number
  onMacroChange: (index: number) => void
  onModeChange: (mode: MacroTriggerMode) => void
  onRepeatCountChange: (count: number) => void
  /** 把当前选择暂存为待写入的键位更改。 */
  onStage: () => void
  /** 选中的宏槽位是否存在未保存的草稿，存在时禁止绑定。 */
  dirty: boolean
  disabled?: boolean
}

/**
 * 板载宏绑定表单：选择 M1–M10 槽位与触发方式，暂存为待写入的键位更改。
 *
 * 状态由调用方持有，因此可以同时出现在「键位编辑器」卡片与「拟物小键盘」弹窗里，
 * 两处始终共享同一份选择，不会出现不一致。
 */
export function MacroBindingForm({
  bindingMacro,
  bindingMode,
  repeatCount,
  onMacroChange,
  onModeChange,
  onRepeatCountChange,
  onStage,
  dirty,
  disabled,
}: MacroBindingFormProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,96px)_minmax(0,1fr)_auto] sm:items-center">
        <Select value={String(bindingMacro)} onValueChange={value => onMacroChange(Number(value))} disabled={disabled}>
          <SelectTrigger aria-label="选择宏槽位">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 10 }, (_, index) => (
              <SelectItem key={index} value={String(index)}>
                M{index + 1}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={bindingMode}
          onValueChange={value => onModeChange(value as MacroTriggerMode)}
          disabled={disabled}
        >
          <SelectTrigger aria-label="选择触发方式">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRIGGER_MODES.map(mode => (
              <SelectItem key={mode.value} value={mode.value}>
                {mode.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={onStage} disabled={disabled || dirty} className="sm:w-auto">
          暂存绑定
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {bindingMode === 'repeat' && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            播放次数
            <Input
              type="number"
              min={1}
              max={255}
              value={repeatCount}
              disabled={disabled}
              onChange={event => onRepeatCountChange(Math.min(255, Math.max(1, Number(event.target.value))))}
              className="h-8 w-24"
            />
          </label>
        )}
        <span className="text-xs text-muted-foreground">
          {TRIGGER_MODES.find(mode => mode.value === bindingMode)?.hint}
        </span>
      </div>

      {dirty && (
        <p className="text-xs text-warning">
          M{bindingMacro + 1} 有未保存的修改，请先在「宏」页面保存后再绑定。
        </p>
      )}
    </div>
  )
}
