import { useState } from 'react'
import { ChevronDown, Database, Download, ListTree, RotateCcw, ShieldCheck, Trash2, Undo2, Upload } from 'lucide-react'

import { PageHeader } from '@/components/app/PageHeader'
import { SaveButton, SaveSlotOutlet, type PendingChange } from '@/components/app/SaveButton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { Lio87Session } from '@/hooks/useLio87Session'
import { describeRecord, keyLabel, recordDescription } from '@/keymap'
import { hexRecord, recordAt } from '@/protocol'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

export function DataView({ session }: { session: Lio87Session }) {
  const {
    hasDevice, busy, keymap, backup, restore, setRestore, differences, editsCount, applyKeymap,
    clearEdits, importKeymapFile, restoreKeymapFromBackup, downloadCurrentKeymap, downloadFirstBackup,
    fileInput, recordIsEditable,
  } = session

  const [showRecords, setShowRecords] = useState(false)
  const working = Boolean(busy)

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
        eyebrow="04 / DATA & SAFETY"
        title="每次改动，"
        highlight="心里有数。"
        description="写入前先备份，逐项确认后再写回键盘。首次读取的配置会自动保存在本浏览器。"
      >
        <Badge variant={backup ? 'success' : 'muted'}>{backup ? '已有首次备份' : '尚无备份'}</Badge>
        <Badge variant={editsCount ? 'warning' : 'muted'}>{editsCount} 个待写入</Badge>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              A / 保存当前配置
            </CardTitle>
            <CardDescription>当前配置的备份会保存在本浏览器，也可以下载到本地。</CardDescription>
          </CardHeader>
          <CardContent className="mt-auto flex flex-col gap-4">
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
              {backup ? `备份时间 · ${formatDate(backup.createdAt)}` : '尚无备份'}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={downloadCurrentKeymap} disabled={!keymap || working}>
                <Download className="h-3.5 w-3.5" />
                下载当前配置
              </Button>
              <Button variant="outline" size="sm" onClick={downloadFirstBackup} disabled={!backup || working}>
                <Download className="h-3.5 w-3.5" />
                下载备份文件
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-primary" />
              B / 从备份恢复
            </CardTitle>
            <CardDescription>使用浏览器里的备份，或导入此前导出的备份文件。</CardDescription>
          </CardHeader>
          <CardContent className="mt-auto flex flex-col gap-4">
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
              {restore ? `待恢复 · ${restore.title}` : '尚未载入恢复数据'}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={restoreKeymapFromBackup}
                disabled={!keymap || !backup || working}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                使用浏览器备份
              </Button>
              <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={!keymap || working}>
                <Upload className="h-3.5 w-3.5" />
                导入 .bin 文件
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".bin,application/octet-stream"
                hidden
                onChange={event => {
                  const file = event.target.files?.[0]
                  if (file) void importKeymapFile(file)
                }}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              C / 写入预览
            </CardTitle>
            <CardDescription>
              {restore ? restore.title : differences.length ? `${differences.length} 处变更待写入` : '当前配置没有待写入的变更'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <div className="scrollbar-thin max-h-56 flex-1 overflow-auto rounded-lg border border-border bg-muted/30">
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
                  选择按键并修改动作后，差异会显示在这里。
                </p>
              )}
            </div>
            {changes.length > 20 && (
              <p className="text-xs text-muted-foreground">另有 {changes.length - 20} 处变更未在此列出。</p>
            )}
            <div className="mt-auto flex flex-wrap items-center gap-2">
              {restore ? (
                <Button variant="outline" size="sm" onClick={() => setRestore(null)} disabled={working}>
                  <Undo2 className="h-3.5 w-3.5" />
                  取消恢复
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={clearEdits} disabled={working || editsCount === 0}>
                  <Trash2 className="h-3.5 w-3.5" />
                  清空编辑
                </Button>
              )}
              <span className={cn('text-xs', canWrite ? 'text-success' : 'text-muted-foreground')}>
                {canWrite ? '点击右上角保存按钮完成写入。' : '尚无可以写入的变更。'}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ListTree className="h-4 w-4 text-primary" />
              原始记录
            </CardTitle>
            <CardDescription className="mt-1.5">查看设备当前保存的原始配置记录。</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowRecords(value => !value)}>
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showRecords && 'rotate-180')} />
            {showRecords ? '收起' : '展开'}配置记录
          </Button>
        </CardHeader>
        {showRecords && (
          <CardContent>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 128 }, (_, index) => {
                const editable = recordIsEditable(index)
                return (
                  <div
                    key={index}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]',
                      editable ? 'border-brand-200 bg-accent/60' : 'border-border bg-muted/30',
                    )}
                  >
                    <span className="font-mono text-muted-foreground">{index.toString().padStart(3, '0')}</span>
                    <code className="font-mono text-primary">{keymap ? hexRecord(recordAt(keymap, index)) : '— — —'}</code>
                    <span className="truncate text-muted-foreground">
                      {keymap ? recordDescription(keymap, index) : '未读取'}
                    </span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        )}
      </Card>

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
