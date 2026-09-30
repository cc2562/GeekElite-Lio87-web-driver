import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'

import type { Notice } from '@/hooks/useLio87Session'
import { cn } from '@/lib/utils'

const STYLES: Record<Notice['type'], { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: 'border-sky-200 bg-sky-50 text-sky-900' },
  success: { icon: CheckCircle2, className: 'border-emerald-200 bg-emerald-50 text-emerald-900' },
  error: { icon: XCircle, className: 'border-red-200 bg-red-50 text-red-900' },
}

export function NoticeBar({ notice }: { notice: Notice }) {
  const { icon: Icon, className } = STYLES[notice.type]
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm leading-relaxed shadow-sm transition-colors',
        className,
      )}
    >
      {notice.type === 'info' ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
      ) : (
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <span className="text-balance">{notice.text}</span>
    </div>
  )
}
