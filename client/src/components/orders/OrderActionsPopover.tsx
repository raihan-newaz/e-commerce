import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Portalled so a horizontally scrolling table cannot clip order actions. */
export function OrderActionsPopover({ id, onClose, children }: { id: string; onClose: () => void; children: React.ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [position, setPosition] = useState({ top: 0, left: 0, ready: false });

  useLayoutEffect(() => {
    const trigger = anchor.current?.parentElement?.querySelector<HTMLButtonElement>('button');
    const positionPanel = () => {
      if (!trigger || !panel.current) return;
      const rect = trigger.getBoundingClientRect();
      const height = Math.min(panel.current.scrollHeight, window.innerHeight - 16);
      const preferredTop = rect.bottom + height + 6 < window.innerHeight ? rect.bottom + 6 : rect.top - height - 6;
      const top = Math.max(8, Math.min(preferredTop, window.innerHeight - height - 8));
      setPosition({ top, left: Math.max(8, Math.min(rect.right - 196, window.innerWidth - 204)), ready: true });
    };
    positionPanel();
    panel.current?.querySelector<HTMLElement>('button, a')?.focus();
    const dismiss = (event: MouseEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger?.contains(event.target as Node)) close.current();
    };
    window.addEventListener('resize', positionPanel);
    window.addEventListener('scroll', positionPanel, true);
    document.addEventListener('mousedown', dismiss);
    return () => {
      window.removeEventListener('resize', positionPanel);
      window.removeEventListener('scroll', positionPanel, true);
      document.removeEventListener('mousedown', dismiss);
      if (document.activeElement === document.body || panel.current?.contains(document.activeElement)) trigger?.focus();
    };
  }, []);

  return <><span ref={anchor} hidden />{createPortal(<div
    ref={panel} id={id} className="orders-action-popover order-action-menu-container" role="group" aria-label="Order actions"
    style={{ top: position.top, left: position.left, visibility: position.ready ? 'visible' : 'hidden' }}
    onClick={event => event.stopPropagation()}
    onKeyDown={event => {
      if (event.key === 'Escape') {
        event.stopPropagation(); close.current();
        anchor.current?.parentElement?.querySelector<HTMLButtonElement>('button')?.focus();
      }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a') || []);
        const index = controls.indexOf(document.activeElement as HTMLElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length;
        controls[next]?.focus();
      }
    }}
    onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) close.current(); }}
  >{children}</div>, document.body)}</>;
}
