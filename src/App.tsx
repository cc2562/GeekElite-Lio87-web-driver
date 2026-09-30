import { useEffect, useMemo, useRef, useState } from 'react'
import { downloadKeymap, loadBackup, saveFirstBackup, type Backup } from './backup'
import { hidApi, Leo87Connection, requestLeo87, type HidDevice } from './device'
import { ACTIONS, KEY_ROWS, actionFor, canEdit, keyLabel, recordDescription } from './keymap'
import { diffRecords, hexRecord, recordAt, replaceRecord, validateKeymap, type KeyRecord } from './protocol'
import {
  MACRO_ACTION_LIMIT, macroTriggerRecord, parseMacroStorage, replaceMacro, usageForCode, usageLabel,
  type MacroAction, type MacroStorage, type MacroTriggerMode,
} from './macro'
import { downloadMacro, loadMacroBackup, saveFirstMacroBackup, type MacroBackup } from './macroBackup'

type Notice = { type: 'info' | 'success' | 'error'; text: string }
type Restore = { bytes: Uint8Array; title: string } | null
type MacroRestore = { bytes: Uint8Array; title: string } | null
const groups = [...new Set(ACTIONS.map(action => action.group))]
const sideControls = [
  { index: 83, icon: '↟', label: '滚轮上' },
  { index: 84, icon: '↡', label: '滚轮下' },
  { index: 85, icon: '◀◀', label: '上一曲' },
  { index: 87, icon: '▶▶', label: '下一曲' },
]

function parseColor(hex: string): { r: number; g: number; b: number } {
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

const labelAliases: Record<string, string> = {
  PrtSc: 'Print Screen', ScrLk: 'Scroll Lock', Ins: 'Insert', Del: 'Delete',
  PgUp: 'Page Up', PgDn: 'Page Down', Caps: 'Caps Lock',
}

function keyAppearance(keymap: Uint8Array | null, index: number, originalLabel: string, pending: boolean) {
  if (!keymap) return { label: originalLabel, changed: false }
  const action = actionFor(recordAt(keymap, index))
  if (!action) {
    const description = recordDescription(keymap, index)
    const macro = description.match(/^(M\d+) ·/)
    return macro ? { label: macro[1], changed: true } : { label: originalLabel, changed: pending }
  }
  const expected = labelAliases[originalLabel] ?? originalLabel
  const isModifierAlias = ['Ctrl', 'Shift', 'Alt', 'Win'].includes(originalLabel) && action.label.endsWith(originalLabel)
  const changed = pending || (action.label !== expected && !isModifierAlias)
  return { label: changed ? action.label : originalLabel, changed }
}

export default function App() {
  const api = hidApi()
  const connection = useRef<Leo87Connection | null>(null)
  const busyRef = useRef(false)
  const [device, setDevice] = useState<HidDevice | null>(null)
  const [keymap, setKeymap] = useState<Uint8Array | null>(null)
  const [backup, setBackup] = useState<Backup | null>(() => { try { return loadBackup() } catch { return null } })
  const [restore, setRestore] = useState<Restore>(null)
  const [edits, setEdits] = useState<Map<number, KeyRecord>>(new Map())
  const [selected, setSelected] = useState<number | null>(null)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState<Notice>({ type: 'info', text: '连接键盘后，先读取完整键位表，再开始配置。' })
  const [color, setColor] = useState('#63e6be')
  const [brightness, setBrightness] = useState(4)
  const [rainbow, setRainbow] = useState(false)
  const [showRecords, setShowRecords] = useState(false)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const [macroRaw, setMacroRaw] = useState<Uint8Array | null>(null)
  const [macroStorage, setMacroStorage] = useState<MacroStorage | null>(null)
  const [macroError, setMacroError] = useState('')
  const [macroBackup, setMacroBackup] = useState<MacroBackup | null>(() => { try { return loadMacroBackup() } catch { return null } })
  const [macroRestore, setMacroRestore] = useState<MacroRestore>(null)
  const [selectedMacro, setSelectedMacro] = useState(0)
  const [macroDrafts, setMacroDrafts] = useState<Map<number, MacroAction[]>>(new Map())
  const [recording, setRecording] = useState(false)
  const [bindingMacro, setBindingMacro] = useState(0)
  const [bindingMode, setBindingMode] = useState<MacroTriggerMode>('normal')
  const [repeatCount, setRepeatCount] = useState(1)
  const macroFileInput = useRef<HTMLInputElement | null>(null)
  const recordedActions = useRef<MacroAction[]>([])
  const pressedUsages = useRef<Set<number>>(new Set())
  const lastMacroEvent = useRef(0)

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
      setMacroDrafts(new Map())
      setRecording(false)
      setNotice({ type: 'error', text: '键盘已断开。重新连接后请先读取设备状态。' })
    }
    api.addEventListener('disconnect', onDisconnect)
    return () => api.removeEventListener('disconnect', onDisconnect)
  }, [api])

  const draft = useMemo(() => {
    if (!keymap) return null
    if (restore) return restore.bytes
    let next = keymap
    for (const [index, record] of edits) next = replaceRecord(next, index, record)
    return next
  }, [keymap, edits, restore])
  const differences = useMemo(() => keymap && draft ? diffRecords(keymap, draft) : [], [keymap, draft])
  const pendingIndices = useMemo(() => new Set(differences.map(change => change.index)), [differences])
  const selectedRecord = selected !== null && draft ? recordAt(draft, selected) : null
  const selectedEditable = selected !== null && keymap ? canEdit(keymap, selected) && !restore : false
  const selectedAction = selectedRecord ? ACTIONS.find(action => action.record.every((value, i) => value === selectedRecord[i])) : undefined
  const selectedMacroEntry = macroStorage?.entries[selectedMacro] ?? null
  const selectedMacroActions = macroDrafts.get(selectedMacro) ?? selectedMacroEntry?.actions ?? []
  const selectedMacroDirty = macroDrafts.has(selectedMacro)

  useEffect(() => {
    if (!recording) return
    const capture = (event: KeyboardEvent, pressed: boolean) => {
      const usage = usageForCode(event.code)
      if (usage === null) return
      event.preventDefault()
      if (pressed && (event.repeat || pressedUsages.current.has(usage))) return
      if (!pressed && !pressedUsages.current.has(usage)) return
      const actions = recordedActions.current
      if (pressed && actions.length + pressedUsages.current.size + 2 > MACRO_ACTION_LIMIT) return
      if (!pressed && actions.length >= MACRO_ACTION_LIMIT) return
      const now = performance.now()
      const elapsed = Math.min(0xffff, Math.max(pressed ? 1 : 0, Math.round(now - lastMacroEvent.current)))
      lastMacroEvent.current = now
      if (pressed) pressedUsages.current.add(usage)
      else pressedUsages.current.delete(usage)
      const next = [...actions, { delayMs: elapsed, pressed, usage }]
      recordedActions.current = next
      setMacroDrafts(previous => new Map(previous).set(selectedMacro, next))
    }
    const down = (event: KeyboardEvent) => capture(event, true)
    const up = (event: KeyboardEvent) => capture(event, false)
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
    }
  }, [recording, selectedMacro])

  async function operate(label: string, action: () => Promise<void>, writing = false) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(label)
    try { await action() }
    catch (error) {
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
      setMacroBackup(null)
      const message = error instanceof Error ? error.message : String(error)
      setMacroStorage(null)
      setMacroError(message)
      return message
    }
    try {
      const parsed = parseMacroStorage(bytes)
      setMacroStorage(parsed)
      setMacroError('')
      return null
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setMacroStorage(null)
      setMacroError(message)
      return message
    }
  }

  async function readMacros(current: Leo87Connection): Promise<string | null> {
    try {
      return acceptMacroRead(await current.readMacroStorage())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setMacroRaw(null)
      setMacroStorage(null)
      setMacroError(message)
      setMacroDrafts(new Map())
      return message
    }
  }

  function connect() {
    if (!api) return
    void operate('连接设备', async () => {
      const found = await requestLeo87(api)
      if (!found) { setNotice({ type: 'info', text: '未选择 Leo87 配置接口。' }); return }
      const next = new Leo87Connection(found)
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
      const macroWarning = await readMacros(next)
      setNotice(macroWarning
        ? { type: 'info', text: `键位配置已读取；宏数据读取失败：${macroWarning}。键位与灯光功能仍可使用。` }
        : { type: 'success', text: '已连接并读取键位与板载宏配置；界面已按设备现值刷新。' })
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
      setMacroRaw(null)
      setMacroStorage(null)
      setMacroError('')
      setMacroDrafts(new Map())
      setMacroRestore(null)
      setRecording(false)
      setNotice({ type: 'info', text: '已断开设备。浏览器中的首次读取备份仍保留。' })
    })
  }

  function applyLighting() {
    if (!connection.current || !keymap) return
    void operate('应用灯光', async () => {
      await connection.current!.setLighting({ color: parseColor(color), brightness, rainbow })
      setNotice({ type: 'success', text: '灯光指令已发送。请观察键盘确认效果。' })
    }, true)
  }

  function stageAction(actionId: string) {
    if (selected === null || !keymap || !canEdit(keymap, selected)) return
    const action = ACTIONS.find(item => item.id === actionId)
    if (!action) return
    setEdits(previous => {
      const next = new Map(previous)
      const original = recordAt(keymap, selected)
      if (original.every((value, i) => value === action.record[i])) next.delete(selected)
      else next.set(selected, action.record)
      return next
    })
  }

  function stageMacroBinding() {
    if (selected === null || !keymap || !canEdit(keymap, selected)) return
    const record = macroTriggerRecord(bindingMacro, bindingMode, repeatCount)
    setEdits(previous => {
      const next = new Map(previous)
      const original = recordAt(keymap, selected)
      if (original.every((value, index) => value === record[index])) next.delete(selected)
      else next.set(selected, record)
      return next
    })
  }

  function startMacroRecording() {
    if (!selectedMacroEntry?.editable || macroRestore) return
    recordedActions.current = []
    pressedUsages.current = new Set()
    lastMacroEvent.current = performance.now()
    setMacroDrafts(previous => new Map(previous).set(selectedMacro, []))
    setRecording(true)
  }

  function stopMacroRecording() {
    let next = recordedActions.current.slice()
    for (const usage of pressedUsages.current) {
      if (next.length >= MACRO_ACTION_LIMIT) break
      next.push({ delayMs: 0, pressed: false, usage })
    }
    recordedActions.current = next
    pressedUsages.current = new Set()
    setMacroDrafts(previous => new Map(previous).set(selectedMacro, next))
    setRecording(false)
  }

  function updateMacroDelay(index: number, delayMs: number) {
    const minimum = selectedMacroActions[index]?.pressed ? 1 : 0
    if (!Number.isInteger(delayMs) || delayMs < minimum || delayMs > 0xffff) return
    const next = selectedMacroActions.map((action, actionIndex) => actionIndex === index ? { ...action, delayMs } : action)
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
    void writeMacroBytes(next, `M${selectedMacro + 1} 已完整写入并通过 0x14 回读校验。`)
  }

  async function importMacroFile(file: File) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      parseMacroStorage(bytes)
      setMacroRestore({ bytes, title: `宏备份 · ${file.name}` })
      setMacroDrafts(new Map())
      setRecording(false)
      setNotice({ type: 'info', text: '已载入宏备份。检查来源后，可在宏区域完整写回。' })
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : String(error) })
    }
    if (macroFileInput.current) macroFileInput.current.value = ''
  }

  function applyKeymap() {
    if (!connection.current || !keymap || !draft || !backup || (!restore && differences.length === 0)) return
    void operate('写入键位', async () => {
      if (!restore && differences.some(change => !canEdit(keymap, change.index))) throw new Error('更改包含未开放的 record')
      const result = await connection.current!.writeAndVerify(draft)
      if (result.readback) setKeymap(result.readback)
      setEdits(new Map())
      setRestore(null)
      if (result.readError) {
        setNotice({ type: 'info', text: `完整报文已发送，但 0x08 回读未完成：${result.readError}。实体按键可能已生效，仍可继续编辑或发送备份。` })
      } else if (result.mismatchOffset !== null) {
        setNotice({ type: 'info', text: `完整报文已发送，但 0x08 回读在 0x${result.mismatchOffset.toString(16).padStart(4, '0')} 与目标不同。实机按键可能已生效，仍可继续编辑或发送备份。` })
      } else {
        setNotice({ type: 'success', text: '七段写入完成，384 字节 0x08 回读与目标一致。' })
      }
    }, true)
  }

  async function importFile(file: File) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      validateKeymap(bytes)
      setRestore({ bytes, title: `文件备份 · ${file.name}` })
      setEdits(new Map())
      setNotice({ type: 'info', text: '已载入备份文件。请检查下方差异，再点击完整写入。' })
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : String(error) })
    }
    if (fileInput.current) fileInput.current.value = ''
  }

  const hasDevice = Boolean(device && keymap)
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Leo87 Studio 首页"><span className="brand-mark">L<span>87</span></span><span className="brand-name">LEO87 <em>STUDIO</em></span></a>
        <div className="topbar-right"><span className="version">WEB DRIVER / V0.1</span><span className={`device-pill ${hasDevice ? 'online' : ''}`}><span className="status-dot" />{hasDevice ? '设备已连接' : '等待连接'}</span></div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line" />GEEKELITE / LEO87</div><h1>让熟悉的键盘，<br /><span>继续发光。</span></h1><p>为 Leo87 打造的网页配置工具。连接设备、调整灯光、读取并安全修改键位，一切都从你手中的键盘开始。</p><div className="hero-actions"><button className="primary-button" onClick={connect} disabled={!api || Boolean(busy)}>{busy === '连接设备' ? '正在读取…' : hasDevice ? '重新选择设备' : '连接 Leo87'}<span>↗</span></button><span className="hero-note">{!api ? '当前浏览器不支持 WebHID' : 'Chrome / Edge · USB 连接'}</span></div></div>
          <div className="hero-art" aria-hidden="true"><div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" /><div className="hero-board"><div className="hero-board-row">{Array.from({ length: 15 }, (_, i) => <i key={i} />)}</div><div className="hero-board-row">{Array.from({ length: 15 }, (_, i) => <i key={i} />)}</div><div className="hero-board-row">{Array.from({ length: 14 }, (_, i) => <i key={i} />)}</div><div className="hero-board-row">{Array.from({ length: 13 }, (_, i) => <i key={i} />)}</div><div className="hero-board-row">{Array.from({ length: 12 }, (_, i) => <i key={i} />)}</div><div className="hero-board-row bottom">{Array.from({ length: 11 }, (_, i) => <i key={i} />)}</div></div><span className="hero-art-caption">87 KEYS / ENDLESS POSSIBILITIES</span></div>
        </section>

        <div className={`notice ${notice.type}`} role="status"><span className="notice-icon">{notice.type === 'success' ? '✓' : notice.type === 'error' ? '!' : 'i'}</span><span>{notice.text}</span></div>

        <section className="workspace-heading"><div><span className="section-number">01 / CONTROL CENTER</span><h2>你的键盘，<span>你的设置。</span></h2></div><div className="workspace-tools">{hasDevice && <><button className="text-button" onClick={reread} disabled={Boolean(busy)}>↻ 重新读取</button><button className="text-button" onClick={disconnect} disabled={Boolean(busy)}>断开连接 ↗</button></>}</div></section>

        <div className="panel-grid">
          <section className="panel lighting-panel"><div className="panel-top"><div className="panel-icon light-icon">✳</div><span className="panel-counter">01 — LIGHTING</span></div><h3>灯光控制</h3><p className="panel-description">选一种颜色，让桌面拥有自己的氛围。</p><div className="lighting-preview" style={{ '--light-color': color } as React.CSSProperties}><div className="preview-glow" /><div className="preview-inner"><span>LEO<span>87</span></span><small>{rainbow ? 'RGB CYCLE' : 'STATIC COLOR'}</small></div></div><div className="field-line"><label htmlFor="color">灯光颜色</label><div className="color-field"><input id="color" type="color" value={color} onChange={event => setColor(event.target.value)} disabled={Boolean(busy)} /><span>{color.toUpperCase()}</span></div></div><div className="field-block"><div className="field-heading"><label htmlFor="brightness">亮度等级</label><strong>{brightness} <span>/ 4</span></strong></div><input id="brightness" className="brightness-range" type="range" min="0" max="4" step="1" value={brightness} onChange={event => setBrightness(Number(event.target.value))} disabled={Boolean(busy)} /><div className="range-labels"><span>关闭</span><span>最亮</span></div></div><label className="toggle-line"><span><strong>RGB 轮换</strong><small>自动变换颜色</small></span><input type="checkbox" checked={rainbow} onChange={event => setRainbow(event.target.checked)} disabled={Boolean(busy)} /><span className="toggle-switch" /></label><button className="panel-button" onClick={applyLighting} disabled={!hasDevice || Boolean(busy)}>应用灯光设置 <span>→</span></button></section>

          <section className="panel keymap-panel"><div className="panel-top"><div className="panel-icon key-icon">⌘</div><span className="panel-counter">02 — KEY MAPPING</span></div><h3>键位配置</h3><p className="panel-description">每次连接都会读取键盘当前配置。点击按键或滚轮方向，挑选你需要的动作。</p><div className="keymap-meta"><span><i className="meta-dot editable" /> 所有显示位置均可编辑</span><span><i className="meta-dot changed" /> 已更改键位</span><span className="meta-count">{keymap ? '当前配置 · 128 条记录' : '等待读取键位'}</span></div><div className="keyboard-scroll"><div className="keyboard"><div className="side-controls">{sideControls.map(control => { const appearance = keyAppearance(draft, control.index, control.label, pendingIndices.has(control.index)); return <button key={control.index} className={`key side-key ${selected === control.index ? 'selected' : ''} ${appearance.changed ? 'changed' : ''}`} disabled={!hasDevice || Boolean(busy)} onClick={() => setSelected(control.index)} title={keymap ? `${keyLabel(control.index)} · ${recordDescription(draft!, control.index)}` : control.label}><span>{control.icon}</span><small>{appearance.label}</small></button> })}</div><div className="main-keys">{KEY_ROWS.map((row, rowIndex) => <div className="keyboard-row" key={rowIndex}>{row.map(key => { const appearance = keyAppearance(draft, key.index, key.label, pendingIndices.has(key.index)); return <button key={key.index} className={`key ${selected === key.index ? 'selected' : ''} ${appearance.changed ? 'changed' : ''}`} style={{ '--key-width': key.width ?? 1, '--key-gap': key.gap ?? 0 } as React.CSSProperties} disabled={!hasDevice || Boolean(busy)} onClick={() => setSelected(key.index)} title={keymap ? `Record ${key.index} · ${recordDescription(draft!, key.index)}` : key.label}><span>{appearance.label}</span></button> })}</div>)}</div></div></div><div className="key-editor"><div className="editor-heading"><span>{selected === null ? '选择一个按键开始' : `${keyLabel(selected)} · Record ${selected.toString().padStart(3, '0')}`}</span><span className={`editor-badge ${selectedEditable ? 'editable' : ''}`}>{selected === null ? '未选择' : selectedEditable ? '可编辑' : '恢复预览中'}</span></div>{selectedRecord ? <><div className="editor-current"><span>当前动作</span><strong>{selectedAction?.label ?? recordDescription(draft!, selected!)}</strong><code>{hexRecord(selectedRecord)}</code></div>{selectedEditable ? <><label className="action-select-label">更改为<select value={selectedAction?.id ?? ''} onChange={event => stageAction(event.target.value)} disabled={Boolean(busy)}>{!selectedAction && <option value="" disabled>选择普通动作…</option>}{groups.map(group => <optgroup key={group} label={group}>{ACTIONS.filter(action => action.group === group).map(action => <option value={action.id} key={action.id}>{action.label}</option>)}</optgroup>)}</select></label><div className="macro-binding"><span>绑定板载宏</span><select value={bindingMacro} onChange={event => setBindingMacro(Number(event.target.value))}>{Array.from({ length: 10 }, (_, index) => <option value={index} key={index}>M{index + 1}</option>)}</select><select value={bindingMode} onChange={event => setBindingMode(event.target.value as MacroTriggerMode)}><option value="normal">正常停止</option><option value="release">释放停止</option><option value="press">按下停止</option><option value="repeat">播放次数</option></select>{bindingMode === 'repeat' && <input type="number" min="1" max="255" value={repeatCount} onChange={event => setRepeatCount(Math.min(255, Math.max(1, Number(event.target.value))))} />}<button onClick={stageMacroBinding} disabled={Boolean(busy) || macroDrafts.has(bindingMacro)}>暂存绑定</button></div>{macroDrafts.has(bindingMacro) && <p className="binding-note">请先保存 M{bindingMacro + 1}，再绑定到按键。</p>}</> : <p className="locked-explanation">正在预览备份恢复；取消恢复后即可编辑这个位置。</p>}</> : <p className="editor-empty">读取设备后，选择键盘上的按键查看实时记录。</p>}</div></section>
        </div>

        <section className="macro-section">
          <div className="data-heading"><div><span className="section-number">02 / ONBOARD MACRO</span><h2>把一串动作，<span>交给一个键。</span></h2></div><p>实时录制普通键盘事件，保存到 M1–M10，再从键位配置中绑定触发方式。</p></div>
          <div className="macro-panel">
            <div className="macro-toolbar">
              <div><strong>板载宏存储</strong><small>{macroStorage ? `已读取 ${macroStorage.usedEnd} 字节` : macroError ? `读取或解析失败 · ${macroError}` : '连接设备后自动读取'}</small></div>
              <div className="data-actions macro-data-actions"><button onClick={() => macroRaw && downloadMacro(macroRaw, 'leo87-current-macros.bin')} disabled={!macroRaw || Boolean(busy)}>导出当前宏</button><button onClick={() => macroBackup && downloadMacro(macroBackup.bytes, 'leo87-first-macro-backup.bin')} disabled={!macroBackup || Boolean(busy)}>导出首次备份</button><button onClick={() => { if (macroBackup) { try { parseMacroStorage(macroBackup.bytes); setMacroRestore({ bytes: macroBackup.bytes, title: '浏览器首次宏备份' }); setMacroDrafts(new Map()) } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : String(error) }) } } }} disabled={!macroBackup || Boolean(busy)}>载入首次备份</button><button onClick={() => macroFileInput.current?.click()} disabled={!hasDevice || Boolean(busy)}>导入 .bin</button><input ref={macroFileInput} type="file" accept=".bin,application/octet-stream" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void importMacroFile(file) }} /></div>
            </div>
            {macroRestore && <div className="macro-restore"><span>{macroRestore.title} · {macroRestore.bytes.length} 字节</span><div><button className="cancel-button" onClick={() => setMacroRestore(null)} disabled={Boolean(busy)}>取消</button><button className="write-button" onClick={() => void writeMacroBytes(macroRestore.bytes, '宏备份已完整恢复并通过回读校验。')} disabled={Boolean(busy) || !macroBackup || !hasDevice}>{busy === '写入宏' ? '正在恢复…' : '完整写回备份'}</button></div></div>}
            {macroStorage ? <>
              <div className="macro-slots">{macroStorage.entries.map((entry, index) => { const actions = macroDrafts.get(index) ?? entry.actions; return <button key={index} className={`${selectedMacro === index ? 'selected' : ''} ${macroDrafts.has(index) ? 'dirty' : ''}`} onClick={() => { if (recording) stopMacroRecording(); setSelectedMacro(index) }} disabled={Boolean(busy) || Boolean(macroRestore)}><strong>M{index + 1}</strong><span>{actions.length} / {MACRO_ACTION_LIMIT}</span><small>{entry.editable ? actions.length ? '键盘事件' : '空宏' : '含未知事件'}</small></button> })}</div>
              <div className="macro-editor-panel">
                <div className="macro-editor-head"><div><span>M{selectedMacro + 1}</span><strong>{selectedMacroActions.length} 个动作</strong><small>{selectedMacroEntry?.editable ? selectedMacroDirty ? '有未保存更改' : '与设备一致' : '包含未确认的事件编码，仅可查看原始数据'}</small></div><div className="macro-editor-actions">{recording ? <button className="record-stop" onClick={stopMacroRecording}>停止录制</button> : <button onClick={startMacroRecording} disabled={!selectedMacroEntry?.editable || Boolean(busy) || Boolean(macroRestore)}>● 开始录制</button>}<button onClick={clearMacro} disabled={!selectedMacroEntry?.editable || Boolean(busy) || Boolean(macroRestore)}>清空</button><button className="write-button" onClick={saveSelectedMacro} disabled={!selectedMacroDirty || recording || Boolean(busy) || !macroBackup || Boolean(macroRestore)}>{busy === '写入宏' ? '正在写入…' : '保存到键盘'}</button></div></div>
                {recording && <div className="recording-banner"><i /> 正在录制 M{selectedMacro + 1}：请直接按下需要记录的普通键。修饰键、媒体键和鼠标事件不会录入。</div>}
                <div className="macro-actions-list">{selectedMacroActions.length ? selectedMacroActions.map((action, index) => <div className="macro-action-row" key={`${index}-${action.usage}-${action.pressed}`}><span>{String(index + 1).padStart(2, '0')}</span><strong className={action.pressed ? 'down' : 'up'}>{action.pressed ? '按下' : '抬起'}</strong><b>{usageLabel(action.usage)}</b><label>延时 <input type="number" min={action.pressed ? 1 : 0} max="65535" value={action.delayMs} disabled={!selectedMacroEntry?.editable || Boolean(macroRestore)} onChange={event => updateMacroDelay(index, Math.min(65535, Math.max(action.pressed ? 1 : 0, Number(event.target.value))))} /> ms</label></div>) : <div className="macro-empty">这个槽位还没有动作。点击“开始录制”，按下并松开几个键试试。</div>}</div>
              </div>
            </> : <div className="macro-unavailable">{macroError ? '宏原始数据没有通过安全校验。你仍可导出当前数据用于继续分析。' : '尚未读取宏数据。'}</div>}
          </div>
        </section>

        <section className="data-section"><div className="data-heading"><div><span className="section-number">03 / DATA & SAFETY</span><h2>每次改动，<span>心里有数。</span></h2></div><p>写入前备份、逐项预览、完整回写并再次读取验证。</p></div><div className="data-grid"><div className="data-card"><span className="data-card-index">A / BACKUP</span><h3>保存当前配置</h3><p>首次读取的 384 字节自动保存在本浏览器。也可以下载二进制备份。</p><div className="backup-time">{backup ? `首次备份 · ${formatDate(backup.createdAt)}` : '尚无备份'}</div><div className="data-actions"><button onClick={() => keymap && downloadKeymap(keymap, 'leo87-current-keymap.bin')} disabled={!keymap || Boolean(busy)}>下载当前配置 ↓</button><button onClick={() => backup && downloadKeymap(backup.bytes, 'leo87-first-read-backup.bin')} disabled={!backup || Boolean(busy)}>下载首次备份 ↓</button></div></div><div className="data-card"><span className="data-card-index">B / RESTORE</span><h3>从备份恢复</h3><p>选择本浏览器的首次读取备份，或导入此前导出的 384 字节文件。</p><div className="data-actions"><button onClick={() => { if (backup) { setRestore({ bytes: backup.bytes, title: '浏览器首次读取备份' }); setEdits(new Map()) } }} disabled={!keymap || !backup || Boolean(busy)}>使用浏览器备份 ↗</button><button onClick={() => fileInput.current?.click()} disabled={!keymap || Boolean(busy)}>导入 .bin 文件 ↗</button><input ref={fileInput} type="file" accept=".bin,application/octet-stream" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file) }} /></div></div><div className="data-card diff-card"><span className="data-card-index">C / WRITE PREVIEW</span><h3>即将写入</h3><p>{restore ? restore.title : edits.size ? `${edits.size} 个按键已暂存` : '选择按键并修改动作后，差异会显示在这里。'}</p><div className="diff-list">{differences.length ? differences.slice(0, 8).map(change => <div className="diff-item" key={change.index}><span>{keyLabel(change.index)}</span><code>{hexRecord(change.before)} → {hexRecord(change.after)}</code></div>) : <div className="diff-empty">{restore ? 'GET 未显示差异；仍可重新发送完整备份' : '当前配置没有待写入的变更'}</div>}{differences.length > 8 && <div className="diff-more">另有 {differences.length - 8} 条差异</div>}</div><div className="write-actions">{restore && <button className="cancel-button" onClick={() => setRestore(null)} disabled={Boolean(busy)}>取消恢复</button>}{!restore && edits.size > 0 && <button className="cancel-button" onClick={() => setEdits(new Map())} disabled={Boolean(busy)}>清空编辑</button>}<button className="write-button" onClick={applyKeymap} disabled={!keymap || !backup || (!restore && differences.length === 0) || Boolean(busy)}>{busy === '写入键位' ? '正在写入并验证…' : '完整写入并验证'} <span>→</span></button></div></div></div></section>

        <section className="record-section"><button className="record-toggle" onClick={() => setShowRecords(!showRecords)}>{showRecords ? '收起' : '查看'} 128 条原始记录 <span>{showRecords ? '−' : '+'}</span></button>{showRecords && <div className="record-grid">{Array.from({ length: 128 }, (_, index) => <div className={`record-row ${keymap && canEdit(keymap, index) ? 'record-editable' : ''}`} key={index}><span>{index.toString().padStart(3, '0')}</span><code>{keymap ? hexRecord(recordAt(keymap, index)) : '— — —'}</code><span>{keymap ? recordDescription(keymap, index) : '未读取'}</span></div>)}</div>}</section>
      </main>
      <footer><span>LEO87 STUDIO · 非官方社区工具</span><span>数据仅在浏览器与键盘之间传输</span></footer>
    </div>
  )
}
