import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// The layer every menu opens in. It renders into document.body, because a pane can be its own
// stacking context, and a backdrop inside one sits under the other panes and never gets their
// clicks. A click or right-click outside the menu closes it, and so does Escape.
export function MenuLayer({
  onClose,
  children
}: {
  onClose: () => void
  children: ReactNode
}): React.JSX.Element {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  return createPortal(
    <>
      <div
        className="context-menu-backdrop"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      {children}
    </>,
    document.body
  )
}
