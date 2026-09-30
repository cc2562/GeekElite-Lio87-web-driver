import type { ReactNode } from 'react'

type PageHeaderProps = {
  eyebrow: string
  title: string
  highlight?: string
  description?: string
  children?: ReactNode
}

export function PageHeader({ eyebrow, title, highlight, description, children }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="animate-fade-up">
        <span className="font-display text-xs font-bold tracking-[0.22em] text-primary">{eyebrow}</span>
        <h1 className="mt-2 text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
          {title}
          {highlight && <span className="text-primary">{highlight}</span>}
        </h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}
