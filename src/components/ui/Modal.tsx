import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { type ReactNode } from 'react'
import { cx } from '@/lib/util'

export function Modal({
  open, onOpenChange, title, description, children, footer, wide = false,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--c-scrim)] backdrop-blur-[3px] data-[state=open]:animate-[fade_.2s_ease]" />
        <Dialog.Content
          className={cx(
            'fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-[14px] border border-line-strong bg-surface shadow-[var(--frame-shadow)] focus:outline-none scroll',
            wide ? 'max-w-[760px]' : 'max-w-[560px]',
          )}
        >
          <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-surface px-6 py-4">
            <Dialog.Title className="font-display text-[22px] leading-tight">{title}</Dialog.Title>
            <div className="flex-1" />
            <Dialog.Close
              className="grid h-9 w-9 place-items-center rounded-[8px] border border-line text-muted transition-colors hover:border-accent hover:text-ink"
              aria-label="Close"
            >
              <X size={17} />
            </Dialog.Close>
          </div>
          {description && (
            <Dialog.Description asChild>
              <div className="px-6 pt-4 text-[13px] text-muted">{description}</div>
            </Dialog.Description>
          )}
          <div className="px-6 py-5">{children}</div>
          {footer && <div className="sticky bottom-0 flex justify-end gap-2.5 border-t border-line bg-surface px-6 py-4">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
