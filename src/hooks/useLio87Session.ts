import { useEffect, useMemo, useRef, useState } from 'react'

import { downloadKeymap, loadBackup, saveFirstBackup, type Backup } from '@/backup'
import { downloadColorMap, importColorMapFile, loadColorMap, saveColorMap, type ColorMapBackup } from '@/colorMapBackup'
import { loadPalette, savePalette } from '@/paletteBackup'
import { hidApi, Lio87Connection, requestLio87, type HidDevice } from '@/device'
import { ACTIONS, canEdit } from '@/keymap'
import {
  CUSTOM_EFFECT_ID, DEFAULT_EFFECT_ID, DEFAULT_SPEED, clearColorMap, clearRecordColor, coloredRecordCount, colorAt,
  createColorMap, diffColorMap, effectLabel, parseHexColor, withRecordColor,
} from '@/lighting'
import {
  downloadMacro, downloadMacroReport, downloadRawMacro, loadMacroBackup, saveFirstMacroBackup, type MacroBackup,
} from '@/macroBackup'
import {
  MACRO_ACTION_LIMIT, MacroLayoutError, describeKeyEvent, inspectMacroHeader, macroTriggerRecord, parseMacroStorage,
  replaceMacro, resolveKeyUsage, synthesizeTapActions, usageLabel,
  type MacroAction, type MacroStorage, type MacroTriggerMode,
} from '@/macro'
import { diffRecords, recordAt, replaceRecord, validateKeymap, type KeyRecord, type LightingMode } from '@/protocol'

export type Notice = { type: 'info' | 'success' | 'error'; text: string }
export type Restore = { bytes: Uint8Array; title: string } | null
export type MacroRestore = { bytes: Uint8Array; title: string } | null

const DEFAULT_LIGHTING_COLOR = '#F97316'

/**
 * Lio 87 设备会话层。
 *
 * 集中承载所有跨页共享的状态与工作流：设备连接与事务互斥（`operate`）、键位草稿与差异、
 * 灯光与逐键颜色、板载宏的读取 / 录制 / 写回，以及各类备份的导入导出。
 *
 * 所有写入路径都保持既有安全语义：keymap 完整七段写回 + 0x08 回读校验；宏写入前必须存在
 * 首次备份；逐键颜色由设备层强制切到 0x13；写入失败即断开设备。协议与设备模块保持不变。
 */
export function useLio87Session() {
  const api = hidApi()
  const connection = useRef<Lio87Connection | null>(null)
  const busyRef = useRef(false)

  // —— 设备与 keymap ——
  const [device, setDevice] = useState<HidDevice | null>(null)
  const [keymap, setKeymap] = useState<Uint8Array | null>(null)
  const [backup, setBackup] = useState<Backup | null>(() => { try { return loadBackup() } catch { return null } })
  const [restore, setRestore] = useState<Restore>(null)
  const [edits, setEdits] = useState<Map<number, KeyRecord>>(new Map())
  const [selected, setSelected] = useState<number | null>(null)

  // —— 全局反馈 ——
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)

  // —— 灯光动画 ——
  const [color, setColor] = useState(DEFAULT_LIGHTING_COLOR)
  const [brightness, setBrightness] = useState(4)
  const [speed, setSpeed] = useState(DEFAULT_SPEED)
  const [effectId, setEffectId] = useState(DEFAULT_EFFECT_ID)
  const [colorMode, setColorMode] = useState<LightingMode>('static')

  // —— 逐键颜色：设备没有对应的读取命令，因此本地工作表就是唯一记录。 ——
  const [colorMapBackup, setColorMapBackup] = useState<ColorMapBackup | null>(() => { try { return loadColorMap() } catch { return null } })
  const [colorMap, setColorMap] = useState<Uint8Array>(() => colorMapBackup?.bytes ?? createColorMap())
  const [sentColorMap, setSentColorMap] = useState<Uint8Array>(() => colorMapBackup?.bytes ?? createColorMap())
  // 用户自定义色板：设备端没有对应存储，同样只保存在本浏览器。
  const [palette, setPalette] = useState<string[]>(() => { try { return loadPalette()?.colors ?? [] } catch { return [] } })
  // 逐键颜色的多选集合：按住 Ctrl / Cmd 点击可累加。
  const [colorSelection, setColorSelection] = useState<number[]>([])

  // —— 板载宏 ——
  const [macroRaw, setMacroRaw] = useState<Uint8Array | null>(null)
  const [macroStorage, setMacroStorage] = useState<MacroStorage | null>(null)
  const [macroError, setMacroError] = useState('')
  const [macroDiagnostic, setMacroDiagnostic] = useState('')
  const [macroBackup, setMacroBackup] = useState<MacroBackup | null>(() => { try { return loadMacroBackup() } catch { return null } })
  const [macroRestore, setMacroRestore] = useState<MacroRestore>(null)
  const [selectedMacro, setSelectedMacro] = useState(0)
  const [macroDrafts, setMacroDrafts] = useState<Map<number, MacroAction[]>>(new Map())
  const [recording, setRecording] = useState(false)
  const [keyLog, setKeyLog] = useState<string[]>([])
  const [keyTrace, setKeyTrace] = useState('')
  const [imeComposing, setImeComposing] = useState(false)
  const [tapFallback, setTapFallback] = useState(false)

  // —— 文件输入引用 ——
  const fileInput = useRef<HTMLInputElement | null>(null)
  const colorFileInput = useRef<HTMLInputElement | null>(null)
  const macroFileInput = useRef<HTMLInputElement | null>(null)

  // —— 录制期间的瞬时数据 ——
  const recordedActions = useRef<MacroAction[]>([])
  const pressedUsages = useRef<Set<number>>(new Set())
  const lastMacroEvent = useRef(0)
  const keyCounts = useRef({ downs: 0, ups: 0, recorded: 0, ignored: 0 })
  const lastIgnoredDown = useRef(0)

  const draft = useMemo(() => {
    if (!keymap) return null
    if (restore) return restore.bytes
    let next = keymap
    for (const [index, record] of edits) next = replaceRecord(next, index, record)
    return next
  }, [keymap, edits, restore])

  const differences = useMemo(() => (keymap && draft ? diffRecords(keymap, draft) : []), [keymap, draft])
  const pendingIndices = useMemo(() => new Set(differences.map(change => change.index)), [differences])
  const selectedRecord = selected !== null && draft ? recordAt(draft, selected) : null
  const selectedEditable = selected !== null && keymap ? canEdit(keymap, selected) && !restore : false
  const selectedAction = selectedRecord
    ? ACTIONS.find(action => action.record.every((value, i) => value === selectedRecord[i]))
    : undefined

  const selectedMacroEntry = macroStorage?.entries[selectedMacro] ?? null
  const selectedMacroActions = macroDrafts.get(selectedMacro) ?? selectedMacroEntry?.actions ?? []
  const selectedMacroDirty = macroDrafts.has(selectedMacro)
  // 设备只序列化 entry_count 个 entry，其余槽位视为空槽：可录制，保存时才补建 entry。
  const selectedSlotEditable = Boolean(macroStorage) && (selectedMacroEntry?.editable ?? true)

  const colorDifferences = useMemo(() => diffColorMap(sentColorMap, colorMap), [sentColorMap, colorMap])
  const coloredCount = useMemo(() => coloredRecordCount(colorMap), [colorMap])
  const selectedColor = selected !== null ? colorAt(colorMap, selected) : null

  const hasDevice = Boolean(device && keymap)

  useEffect(() => {
    if (!api) return
    const onDisconnect = (event: { device: HidDevice }) => {
      if (connection.current?.device !== event.device) return
      connection.current = null
      setDevice(null)
      setKeymap(null)
      setEdits(new Map())
      setRestore(null)
      setMacroRaw(null)
      setMacroStorage(null)
      setMacroError('设备已断开')
      setMacroDiagnostic('')
      setMacroDrafts(new Map())
      setRecording(false)
      setNotice({ type: 'error', text: '键盘已断开。重新连接后请先读取设备状态。' })
    }
    api.addEventListener('disconnect', onDisconnect)
    return () => api.removeEventListener('disconnect', onDisconnect)
  }, [api])

  useEffect(() => {
    if (!recording) return
    // 录制期间收到的每个键盘事件都会写进监视条：未映射、重复按下、动作上限、缺少按下记录等原因都不再静默丢弃。
    const capture = (event: KeyboardEvent, pressed: boolean) => {
      const now = performance.now()
      const resolution = resolveKeyUsage(event)
      const flags = `${event.repeat ? ' · repeat' : ''}${event.isComposing ? ' · composing' : ''}`
      const base = `${describeKeyEvent(event, resolution)} · ${pressed ? '按下' : '抬起'}${flags}`
      const log = (reason: string) => {
        setKeyTrace(`${base} · ${reason}`)
        setKeyLog(previous => [`${base} · ${reason}`, ...previous].slice(0, 8))
      }
      if (pressed) keyCounts.current.downs += 1
      else keyCounts.current.ups += 1

      const usage = resolution.usage
      if (usage === null) {
        // 记住这次“不可用按下”的时刻：输入法组合输入时字母键只有它会到，抬起才是真实键位。
        if (pressed) lastIgnoredDown.current = now
        keyCounts.current.ignored += 1
        log('已忽略（未映射的键无法写入宏）')
        return
      }
      event.preventDefault()
      const actions = recordedActions.current
      const held = pressedUsages.current.has(usage)

      if (pressed) {
        lastIgnoredDown.current = 0
        if (event.repeat || held) {
          keyCounts.current.ignored += 1
          log('已忽略（该键已在按下状态）')
          return
        }
      } else if (!held) {
        // 按下事件没有进来（输入法截走了 keydown，只剩带真实键位的 keyup）。
        // 补录成一次敲击，否则字母区在本环境里永远录不进去。
        const tapStart = lastIgnoredDown.current || now
        lastIgnoredDown.current = 0
        if (actions.length + 2 > MACRO_ACTION_LIMIT) {
          keyCounts.current.ignored += 1
          log(`已忽略（已达 ${MACRO_ACTION_LIMIT} 条动作上限）`)
          return
        }
        const next = [...actions, ...synthesizeTapActions(usage, now - lastMacroEvent.current, now - tapStart)]
        lastMacroEvent.current = now
        recordedActions.current = next
        keyCounts.current.recorded += 2
        setTapFallback(true)
        log('补录为一次敲击（按下 + 抬起）')
        setMacroDrafts(previous => new Map(previous).set(selectedMacro, next))
        return
      }

      if (pressed && actions.length + pressedUsages.current.size + 2 > MACRO_ACTION_LIMIT) {
        keyCounts.current.ignored += 1
        log(`已忽略（已达 ${MACRO_ACTION_LIMIT} 条动作上限）`)
        return
      }
      if (!pressed && actions.length >= MACRO_ACTION_LIMIT) {
        keyCounts.current.ignored += 1
        log(`已忽略（已达 ${MACRO_ACTION_LIMIT} 条动作上限）`)
        return
      }
      const elapsed = Math.min(0xffff, Math.max(pressed ? 1 : 0, Math.round(now - lastMacroEvent.current)))
      lastMacroEvent.current = now
      if (pressed) pressedUsages.current.add(usage)
      else pressedUsages.current.delete(usage)
      const next = [...actions, { delayMs: elapsed, pressed, usage }]
      recordedActions.current = next
      keyCounts.current.recorded += 1
      log('已记录')
      setMacroDrafts(previous => new Map(previous).set(selectedMacro, next))
    }
    const down = (event: KeyboardEvent) => capture(event, true)
    const up = (event: KeyboardEvent) => capture(event, false)
    // 输入法组合输入会截走字母键，这里只用于提示，不干预录制流程。
    const onCompositionStart = () => setImeComposing(true)
    const onCompositionEnd = () => setImeComposing(false)
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('compositionstart', onCompositionStart, true)
    window.addEventListener('compositionend', onCompositionEnd, true)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('compositionstart', onCompositionStart, true)
      window.removeEventListener('compositionend', onCompositionEnd, true)
    }
  }, [recording, selectedMacro])

  async function operate(label: string, action: () => Promise<void>, writing = false) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(label)
    try {
      await action()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setNotice({ type: 'error', text: `${label}失败：${message}${writing ? '。为避免继续写入，已断开设备；请重新连接并读取状态。' : ''}` })
      if (writing) {
        try { await connection.current?.close() } catch { /* 设备可能已断开 */ }
        connection.current = null
        setDevice(null)
        setKeymap(null)
        setEdits(new Map())
        setRestore(null)
        setMacroRaw(null)
        setMacroStorage(null)
        setMacroDrafts(new Map())
        setRecording(false)
      }
    } finally {
      busyRef.current = false
      setBusy('')
    }
  }

  function acceptRead(bytes: Uint8Array) {
    validateKeymap(bytes)
    const saved = saveFirstBackup(bytes)
    setBackup(saved)
    setKeymap(bytes)
    setEdits(new Map())
    setRestore(null)
    setSelected(null)
    setColorSelection([])
  }

  // 失败时保留设备真实回送的样本：布局错误自带 56 字节探测窗口，解析错误回退到整段数据。
  function macroFailure(error: unknown, fallback: Uint8Array | null): { message: string; raw: Uint8Array | null; report: string } {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof MacroLayoutError) return { message, raw: error.header, report: error.report }
    return { message, raw: fallback, report: fallback && fallback.length >= 2 ? inspectMacroHeader(fallback) : '' }
  }

  function acceptMacroRead(bytes: Uint8Array): string | null {
    setMacroRaw(bytes)
    setMacroDrafts(new Map())
    setMacroRestore(null)
    setRecording(false)
    try {
      const saved = saveFirstMacroBackup(bytes)
      setMacroBackup(saved)
    } catch (error) {
      const failure = macroFailure(error, bytes)
      setMacroBackup(null)
      setMacroStorage(null)
      setMacroError(failure.message)
      setMacroDiagnostic(failure.report)
      return failure.message
    }
    try {
      const parsed = parseMacroStorage(bytes)
      setMacroStorage(parsed)
      setMacroError('')
      setMacroDiagnostic('')
      return null
    } catch (error) {
      const failure = macroFailure(error, bytes)
      setMacroStorage(null)
      setMacroError(failure.message)
      setMacroDiagnostic(failure.report)
      return failure.message
    }
  }

  async function readMacros(current: Lio87Connection): Promise<string | null> {
    try {
      return acceptMacroRead(await current.readMacroStorage())
    } catch (error) {
      const failure = macroFailure(error, null)
      setMacroRaw(failure.raw)
      setMacroStorage(null)
      setMacroError(failure.message)
      setMacroDiagnostic(failure.report)
      setMacroDrafts(new Map())
      return failure.message
    }
  }

  // —— 连接与设备生命周期 ——

  function connect() {
    if (!api) return
    void operate('连接设备', async () => {
      const found = await requestLio87(api)
      if (!found) { setNotice({ type: 'info', text: '未选择 Lio 87 配置接口。' }); return }
      const next = new Lio87Connection(found)
      const previous = connection.current
      try {
        await next.open()
        const bytes = await next.readKeymap()
        acceptRead(bytes)
        if (previous && previous.device !== found) await previous.close()
        connection.current = next
        setDevice(found)
      } catch (error) {
        if (previous?.device !== found) await next.close()
        throw error
      }
      // 宏读取失败只影响宏页面，不打断连接；成功时不做多余提示。
      await readMacros(next)
    })
  }

  function reread() {
    if (!connection.current) return
    void operate('重新读取', async () => {
      const bytes = await connection.current!.readKeymap()
      acceptRead(bytes)
      const macroWarning = await readMacros(connection.current!)
      setNotice(macroWarning
        ? { type: 'info', text: `键位表已重新读取；宏数据读取失败：${macroWarning}` }
        : { type: 'success', text: '键位与宏数据已重新读取；未保存的编辑已清除。' })
    })
  }

  function disconnect() {
    if (!connection.current) return
    void operate('断开设备', async () => {
      await connection.current!.close()
      connection.current = null
      setDevice(null)
      setKeymap(null)
      setEdits(new Map())
      setRestore(null)
      setSelected(null)
      setColorSelection([])
      setMacroRaw(null)
      setMacroStorage(null)
      setMacroError('')
      setMacroDrafts(new Map())
      setMacroRestore(null)
      setRecording(false)
      setNotice({ type: 'info', text: '已断开设备。' })
    })
  }

  // —— 灯光动画 ——

  function applyLighting() {
    if (!connection.current || !keymap) return
    void operate('应用灯光', async () => {
      await connection.current!.setLighting({ effectId, brightness, speed, mode: colorMode, color: parseHexColor(color) })
      setNotice({ type: 'success', text: `已下发灯效「${effectLabel(effectId)}」· 亮度 ${brightness} · 速度 ${speed}。请观察键盘确认效果。` })
    }, true)
  }

  // —— 逐键颜色：编辑只改本地草稿；只有“应用到键盘”才会写设备并更新本地工作表。 ——

  /** Ctrl / Cmd 点击累加多选，普通点击重置为单选。 */
  function selectColorRecord(index: number, additive: boolean) {
    setSelected(index)
    setColorSelection(previous => {
      if (!additive) return [index]
      return previous.includes(index) ? previous.filter(item => item !== index) : [...previous, index]
    })
  }

  /** 把颜色应用到当前多选的全部键位。 */
  function applyColorToSelection(hex: string) {
    if (colorSelection.length === 0) return
    try {
      const rgb = parseHexColor(hex)
      let next = colorMap
      for (const index of colorSelection) next = withRecordColor(next, index, rgb)
      setColorMap(next)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : String(error) })
    }
  }

  /** 清空当前多选键位的颜色。 */
  function clearSelectionColors() {
    if (colorSelection.length === 0) return
    let next = colorMap
    for (const index of colorSelection) next = clearRecordColor(next, index)
    setColorMap(next)
  }

  function clearAllKeyColors() {
    setColorMap(clearColorMap(colorMap))
  }

  function applyCustomColorMap() {
    if (!connection.current || !keymap || colorDifferences.length === 0) return
    const next = colorMap
    const changed = colorDifferences.length
    void operate('应用逐键颜色', async () => {
      await connection.current!.setCustomColorMap(next, { effectId: CUSTOM_EFFECT_ID, brightness, speed, mode: colorMode, color: parseHexColor(color) })
      setSentColorMap(next)
      // 本地工作表写入失败与已发出的报文无关，单独兜底，不影响设备状态。
      try { setColorMapBackup(saveColorMap(next)) } catch { setColorMapBackup(null) }
      setNotice({ type: 'success', text: `已下发逐键颜色（${changed} 个键有改动）。请观察键盘确认效果。` })
    }, true)
  }

  async function importColorMap(file: File) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      setColorMap(importColorMapFile(bytes))
      setNotice({ type: 'info', text: '已载入颜色表，确认差异后再保存。' })
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : String(error) })
    }
    if (colorFileInput.current) colorFileInput.current.value = ''
  }

  function downloadColorMapFile() {
    downloadColorMap(colorMap, 'lio87-perkey-colors.bin')
  }

  function addPaletteColor(hex: string) {
    try {
      setPalette(savePalette([...palette, hex]).colors)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : String(error) })
    }
  }

  function removePaletteColor(hex: string) {
    try {
      setPalette(savePalette(palette.filter(item => item !== hex)).colors)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : String(error) })
    }
  }

  // —— 键位草稿 ——

  function stageAction(actionId: string) {
    if (selected === null || !keymap || !canEdit(keymap, selected)) return
    const action = ACTIONS.find(item => item.id === actionId)
    if (!action) return
    stageRecord(selected, action.record)
  }

  function stageMacroBinding(macroIndex: number, mode: MacroTriggerMode, repeatCount: number) {
    if (selected === null || !keymap || !canEdit(keymap, selected)) return
    stageRecord(selected, macroTriggerRecord(macroIndex, mode, repeatCount))
  }

  function stageRecord(index: number, record: KeyRecord) {
    if (!keymap || !canEdit(keymap, index)) return
    setEdits(previous => {
      const next = new Map(previous)
      const original = recordAt(keymap, index)
      if (original.every((value, i) => value === record[i])) next.delete(index)
      else next.set(index, record)
      return next
    })
  }

  /** 拖拽互换：把两个 record 的动作对调并写入草稿（不接触设备）。 */
  function swapRecords(from: number, to: number) {
    if (!keymap || from === to) return
    if (!canEdit(keymap, from) || !canEdit(keymap, to)) return
    const source = draft ? recordAt(draft, from) : recordAt(keymap, from)
    const target = draft ? recordAt(draft, to) : recordAt(keymap, to)
    const next = new Map(edits)
    const originalFrom = recordAt(keymap, from)
    const originalTo = recordAt(keymap, to)
    // 让 from 的最终值变成 target，to 的最终值变成 source；与原始值相同时从草稿里移除。
    if (target.every((value, i) => value === originalFrom[i])) next.delete(from)
    else next.set(from, target)
    if (source.every((value, i) => value === originalTo[i])) next.delete(to)
    else next.set(to, source)
    setEdits(next)
  }

  function applyKeymap() {
    if (!connection.current || !keymap || !draft || !backup || (!restore && differences.length === 0)) return
    void operate('写入键位', async () => {
      if (!restore && differences.some(change => !canEdit(keymap, change.index))) throw new Error('更改包含未开放的 record')
      const result = await connection.current!.writeAndVerify(draft)
      if (result.readback) setKeymap(result.readback)
      setEdits(new Map())
      setRestore(null)
      if (result.readError || result.mismatchOffset !== null) {
        setNotice({ type: 'info', text: '修改已发送到键盘，但没能确认写入结果。按键可能已经生效，建议直接试按确认。' })
      } else {
        setNotice({ type: 'success', text: '键位已写入键盘并核对无误。' })
      }
    }, true)
  }

  async function importKeymapFile(file: File) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      validateKeymap(bytes)
      setRestore({ bytes, title: `文件备份 · ${file.name}` })
      setEdits(new Map())
      setNotice({ type: 'info', text: '已载入备份文件，检查差异后再保存。' })
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : String(error) })
    }
    if (fileInput.current) fileInput.current.value = ''
  }

  // —— 板载宏 ——

  function startMacroRecording() {
    if (!selectedSlotEditable || macroRestore) return
    recordedActions.current = []
    pressedUsages.current = new Set()
    lastMacroEvent.current = performance.now()
    keyCounts.current = { downs: 0, ups: 0, recorded: 0, ignored: 0 }
    lastIgnoredDown.current = 0
    setKeyLog([])
    setKeyTrace('')
    setImeComposing(false)
    setTapFallback(false)
    setMacroDrafts(previous => new Map(previous).set(selectedMacro, []))
    setRecording(true)
  }

  function stopMacroRecording() {
    const next = recordedActions.current.slice()
    for (const usage of pressedUsages.current) {
      if (next.length >= MACRO_ACTION_LIMIT) break
      next.push({ delayMs: 0, pressed: false, usage })
    }
    recordedActions.current = next
    pressedUsages.current = new Set()
    setMacroDrafts(previous => new Map(previous).set(selectedMacro, next))
    setRecording(false)
  }

  // 录制中点击槽位会先停止录制（录到的动作属于原槽位），这里显式提示，避免用户以为按键失灵。
  function selectMacroSlot(index: number) {
    if (recording) {
      stopMacroRecording()
      setNotice({ type: 'info', text: `已停止录制 M${selectedMacro + 1}，已录制的动作保留在该槽位。` })
    }
    setSelectedMacro(index)
  }

  function updateMacroDelay(index: number, delayMs: number) {
    const minimum = selectedMacroActions[index]?.pressed ? 1 : 0
    if (!Number.isInteger(delayMs) || delayMs < minimum || delayMs > 0xffff) return
    const next = selectedMacroActions.map((action, actionIndex) => (actionIndex === index ? { ...action, delayMs } : action))
    setMacroDrafts(previous => new Map(previous).set(selectedMacro, next))
  }

  function clearMacro() {
    if (recording) stopMacroRecording()
    setMacroDrafts(previous => new Map(previous).set(selectedMacro, []))
  }

  async function writeMacroBytes(bytes: Uint8Array, successText: string) {
    if (!connection.current || !macroBackup) return
    await operate('写入宏', async () => {
      const actual = await connection.current!.writeMacroAndVerify(bytes)
      const parseError = acceptMacroRead(actual)
      if (parseError) throw new Error(parseError)
      setNotice({ type: 'success', text: successText })
    }, true)
  }

  function saveSelectedMacro() {
    if (!macroStorage || !selectedMacroDirty || recording) return
    const next = replaceMacro(macroStorage, selectedMacro, selectedMacroActions)
    void writeMacroBytes(next, `M${selectedMacro + 1} 已保存到键盘。`)
  }

  function restoreMacroBackup() {
    if (!macroBackup) return
    void writeMacroBytes(macroBackup.bytes, '宏备份已恢复。')
  }

  function loadFirstMacroBackup() {
    if (!macroBackup) return
    try {
      parseMacroStorage(macroBackup.bytes)
      setMacroRestore({ bytes: macroBackup.bytes, title: '浏览器首次宏备份' })
      setMacroDrafts(new Map())
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : String(error) })
    }
  }

  function restoreFromMacroBytes(bytes: Uint8Array) {
    void writeMacroBytes(bytes, '宏备份已恢复。')
  }

  async function importMacroFile(file: File) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      parseMacroStorage(bytes)
      setMacroRestore({ bytes, title: `宏备份 · ${file.name}` })
      setMacroDrafts(new Map())
      setRecording(false)
      setNotice({ type: 'info', text: '已载入宏备份，可在宏页面写回键盘。' })
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : String(error) })
    }
    if (macroFileInput.current) macroFileInput.current.value = ''
  }

  function restoreKeymapFromBackup() {
    if (!backup) return
    setRestore({ bytes: backup.bytes, title: '浏览器首次读取备份' })
    setEdits(new Map())
  }

  function downloadCurrentKeymap() {
    if (keymap) downloadKeymap(keymap, 'lio87-current-keymap.bin')
  }

  function downloadFirstBackup() {
    if (backup) downloadKeymap(backup.bytes, 'lio87-first-read-backup.bin')
  }

  function downloadCurrentMacros() {
    if (macroRaw) downloadRawMacro(macroRaw, macroError ? 'lio87-macro-dump.bin' : 'lio87-current-macros.bin')
  }

  function downloadMacroDiagnostic() {
    if (macroDiagnostic) downloadMacroReport(macroDiagnostic, 'lio87-macro-diagnostic.txt')
  }

  function downloadFirstMacroBackup() {
    if (macroBackup) downloadMacro(macroBackup.bytes, 'lio87-first-macro-backup.bin')
  }

  function recordIsEditable(index: number): boolean {
    return Boolean(keymap && canEdit(keymap, index))
  }

  /** 该宏槽位是否存在未保存的草稿（用于禁止绑定尚未保存的宏）。 */
  function macroSlotDirty(index: number): boolean {
    return macroDrafts.has(index)
  }

  function clearEdits() {
    setEdits(new Map())
  }

  return {
    // 环境与连接
    api,
    hasDevice,
    device,
    busy,
    notice,
    setNotice,
    connect,
    reread,
    disconnect,
    // 键位
    keymap,
    draft,
    backup,
    restore,
    setRestore,
    differences,
    pendingIndices,
    editsCount: edits.size,
    selected,
    setSelected,
    selectedRecord,
    selectedEditable,
    selectedAction,
    stageAction,
    stageMacroBinding,
    swapRecords,
    applyKeymap,
    clearEdits,
    importKeymapFile,
    restoreKeymapFromBackup,
    downloadCurrentKeymap,
    downloadFirstBackup,
    fileInput,
    recordIsEditable,
    // 灯光
    color,
    setColor,
    brightness,
    setBrightness,
    speed,
    setSpeed,
    effectId,
    setEffectId,
    colorMode,
    setColorMode,
    applyLighting,
    // 逐键颜色
    colorMap,
    colorMapBackup,
    colorDifferences,
    coloredCount,
    selectedColor,
    colorSelection,
    selectColorRecord,
    applyColorToSelection,
    clearSelectionColors,
    clearAllKeyColors,
    applyCustomColorMap,
    importColorMap,
    downloadColorMapFile,
    colorFileInput,
    palette,
    addPaletteColor,
    removePaletteColor,
    // 宏
    macroRaw,
    macroStorage,
    macroError,
    macroDiagnostic,
    macroBackup,
    macroRestore,
    setMacroRestore,
    selectedMacro,
    selectMacroSlot,
    selectedMacroEntry,
    selectedMacroActions,
    selectedMacroDirty,
    selectedSlotEditable,
    macroSlotDirty,
    recording,
    keyCounts,
    keyLog,
    keyTrace,
    imeComposing,
    tapFallback,
    startMacroRecording,
    stopMacroRecording,
    updateMacroDelay,
    clearMacro,
    saveSelectedMacro,
    restoreMacroBackup,
    loadFirstMacroBackup,
    restoreFromMacroBytes,
    importMacroFile,
    downloadCurrentMacros,
    downloadMacroDiagnostic,
    downloadFirstMacroBackup,
    macroFileInput,
  }
}

export type Lio87Session = ReturnType<typeof useLio87Session>
