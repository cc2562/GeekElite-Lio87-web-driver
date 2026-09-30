import { useState } from 'react'
import { AlertTriangle, Eraser, Keyboard, LayoutGrid, Move, Undo2 } from 'lucide-react'

import { PageHeader } from '@/components/app/PageHeader'
import { SaveButton, SaveSlotOutlet, type PendingChange } from '@/components/app/SaveButton'
import { KeyPickerDialog } from '@/components/keyboard/KeyPickerDialog'
import { KeyPickerPanel } from '@/components/keyboard/KeyPickerPanel'
import { MacroBindingForm } from '@/components/keyboard/MacroBindingForm'
import { KEYMAP_SIDE_CONTROLS, SkeuKeyboard, type KeyStateInfo } from '@/components/keyboard/SkeuKeyboard'
import { keyAppearance, resolveKeycapState } from '@/components/keyboard/keyboardHelpers'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import type { Lio87Session } from '@/hooks/useLio87Session'
import type { MacroTriggerMode } from '@/macro'
import { describeRecord, keyLabel, recordDescription } from '@/keymap'
import { cn } from '@/lib/utils'

export function KeymapView({ session }: { session: Lio87Session }) {
  const {
    hasDevice, busy, keymap, draft, backup, restore, setRestore, differences, pendingIndices, editsCount,
    selected, setSelected, selectedAction, selectedEditable, stageAction, stageMacroBinding, swapRecords,
    applyKeymap, clearEdits, recordIsEditable, macroSlotDirty,
  } = session

  const [bindingMacro, setBindingMacro] = useState(0)
  const [bindingMode, setBindingMode] = useState<MacroTriggerMode>('normal')
  const [repeatCount, setRepeatCount] = useState(1)
  const [pickerOpen, setPickerOpen] = useState(false)

  const working = Boolean(busy)
  const editLocked = !hasDevice || working || Boolean(restore)
  const macroDirty = macroSlotDirty(bindingMacro)

  const resolve = (index: number, defaultLabel: string): KeyStateInfo => {
    const appearance = keyAppearance(draft, index, defaultLabel, pendingIndices.has(index))
    return {
      label: appearance.label,
      state: resolveKeycapState({
        selected: selected === index,
        changed: appearance.changed,
        locked: Boolean(restore) || !keymap || !recordIsEditable(index),
      }),
      title: keymap ? `${keyLabel(index)} · ${recordDescription(draft ?? keymap, index)}` : defaultLabel,
    }
  }

  // 点击键位即选中，并自动弹出编辑弹窗：改键与绑宏都在同一个弹窗里完成。
  const handleSelect = (index: number, _additive: boolean) => {
    setSelected(index)
    if (editLocked || !recordIsEditable(index)) return
    setPickerOpen(true)
  }

  const macroBindingForm = (
    <MacroBindingForm
      bindingMacro={bindingMacro}
      bindingMode={bindingMode}
      repeatCount={repeatCount}
      onMacroChange={setBindingMacro}
      onModeChange={setBindingMode}
      onRepeatCountChange={setRepeatCount}
      onStage={() => stageMacroBinding(bindingMacro, bindingMode, repeatCount)}
      dirty={macroDirty}
      disabled={editLocked}
    />
  )

  const changes: PendingChange[] = restore
    ? [{ label: '恢复备份', detail: restore.title }]
    : differences.map(change => ({
        label: keyLabel(change.index),
        detail: `${describeRecord(change.before)} → ${describeRecord(change.after)}`,
      }))

  const canWrite = hasDevice && Boolean(backup) && (Boolean(restore) || differences.length > 0)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="02 / KEY MAPPING"
        title="你的键盘，"
        highlight="你说了算。"
        description="点击任意键位会自动弹出编辑弹窗，可以点选新的键位或直接绑定板载宏；也可以拖动键帽互换两个键的绑定。"
      >
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <i className="h-2.5 w-2.5 rounded-full bg-brand-400 shadow-[0_0_8px_rgba(249,115,22,0.6)]" />
          已更改
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <i className="h-2.5 w-2.5 rounded-full bg-brand-600" />
          已选中
        </span>
        <Badge variant="muted">{editsCount} 个待写入</Badge>
      </PageHeader>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Keyboard className="h-4 w-4 text-primary" />
              拟物键盘 · Lio 87
            </CardTitle>
            <CardDescription className="mt-1.5">
              {hasDevice
                ? '点击键位自动打开编辑弹窗；拖动键帽到另一个键即可互换两者的绑定。'
                : '连接键盘后即可选中与改键。'}
            </CardDescription>
          </div>
          <div className="hidden shrink-0 items-center gap-2 text-xs text-muted-foreground sm:flex">
            <Move className="h-4 w-4 text-primary" />
            支持拖拽互换
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-border bg-gradient-to-b from-stone-100/80 to-card p-3 sm:p-4">
            <SkeuKeyboard
              resolve={resolve}
              onSelect={handleSelect}
              disabled={editLocked}
              enableDrag={!editLocked}
              onSwap={swapRecords}
              sideControls={KEYMAP_SIDE_CONTROLS}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LayoutGrid className="h-4 w-4 text-primary" />
              键位编辑器
            </CardTitle>
            <CardDescription>
              {selected === null ? '在上方键盘上选择一个按键开始配置。' : keyLabel(selected)}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-5">
            {selected === null ? (
              <p className="py-10 text-center text-sm text-muted-foreground">尚未选择键位。</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">当前动作</span>
                    <span className="text-sm font-semibold">
                      {selectedAction?.label ?? recordDescription(draft ?? keymap!, selected)}
                    </span>
                  </div>
                  <Badge variant={selectedEditable ? 'success' : 'muted'}>
                    {restore ? '恢复预览中' : selectedEditable ? '可编辑' : '只读'}
                  </Badge>
                </div>

                {!selectedEditable ? (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    {restore ? '正在预览备份恢复；取消恢复后即可编辑。' : '该键位暂不支持编辑。'}
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label className="text-sm">可视化键位面板</Label>
                        <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)} disabled={editLocked}>
                          <Keyboard className="h-3.5 w-3.5" />
                          重新打开编辑弹窗
                        </Button>
                      </div>
                      <KeyPickerPanel onPick={stageAction} currentActionId={selectedAction?.id} disabled={editLocked} />
                    </div>

                    <div className="flex flex-col gap-3 border-t border-border pt-5">
                      <Label className="text-sm">绑定板载宏</Label>
                      {macroBindingForm}
                    </div>
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LayoutGrid className="h-4 w-4 text-primary" />
              待写入差异
            </CardTitle>
            <CardDescription>
              {restore
                ? restore.title
                : differences.length
                  ? `共 ${differences.length} 处键位变更`
                  : '当前配置没有待写入的变更'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <div className="scrollbar-thin max-h-64 flex-1 overflow-auto rounded-lg border border-border bg-muted/30">
              {changes.length ? (
                <ul className="divide-y divide-border">
                  {changes.slice(0, 20).map((change, index) => (
                    <li key={index} className="flex items-baseline justify-between gap-3 px-3 py-2 text-xs">
                      <span className="font-medium">{change.label}</span>
                      <code className="font-mono text-primary">{change.detail}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  点选键位并更改动作后，差异会显示在这里。
                </p>
              )}
            </div>
            {changes.length > 20 && (
              <p className="text-xs text-muted-foreground">另有 {changes.length - 20} 处变更未在此列出。</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {restore ? (
                <Button variant="outline" size="sm" onClick={() => setRestore(null)} disabled={working}>
                  <Undo2 className="h-3.5 w-3.5" />
                  取消恢复
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={clearEdits} disabled={working || editsCount === 0}>
                  <Eraser className="h-3.5 w-3.5" />
                  清空编辑
                </Button>
              )}
              <span className={cn('text-xs', canWrite ? 'text-success' : 'text-muted-foreground')}>
                {canWrite ? '可写入：点击右上角保存按钮确认。' : '尚无可以写入的变更。'}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <KeyPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={stageAction}
        targetLabel={selected !== null ? `${keyLabel(selected)} · ${selected}` : undefined}
        currentActionLabel={selectedAction?.label}
        disabled={editLocked}
        macroBinding={macroBindingForm}
      />

      <SaveSlotOutlet>
        <SaveButton
          changes={changes}
          onConfirm={applyKeymap}
          disabled={!canWrite}
          busy={busy === '写入键位'}
          label="保存键位"
          dialogHint={restore ? '确认后会把这份备份写入键盘。' : '确认后会把上面的修改写入键盘。'}
          confirmLabel="完整写入并验证"
          emptyHint="先更改键位后再保存"
        />
      </SaveSlotOutlet>
    </div>
  )
}
