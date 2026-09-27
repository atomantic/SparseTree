import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject, type SyntheticEvent } from 'react';

interface AccessibleDialogProps {
  open: boolean;
  labelledBy: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  canClose?: boolean;
  onClose: () => void;
  children: ReactNode;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function AccessibleDialog({
  open,
  labelledBy,
  initialFocusRef,
  canClose = true,
  onClose,
  children,
}: AccessibleDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;

    const activeElement = document.activeElement;
    returnFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    if (!dialog.open) dialog.showModal();

    const focusTimer = window.setTimeout(() => {
      const target = initialFocusRef?.current;
      (target && dialog.contains(target) ? target : dialog).focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
      if (dialog.open) dialog.close();

      const returnFocus = returnFocusRef.current;
      returnFocusRef.current = null;
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [open, initialFocusRef]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab') return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusableElements = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter(element => !element.closest('[hidden], [inert], [aria-hidden="true"]'));
    if (focusableElements.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (event.shiftKey && (activeElement === first || !dialog.contains(activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (activeElement === last || !dialog.contains(activeElement))) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    if (canClose) onClose();
  };

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      tabIndex={-1}
      onCancel={handleCancel}
      onKeyDown={handleKeyDown}
      onClick={event => {
        if (event.target === event.currentTarget && canClose) onClose();
      }}
      className="fixed inset-0 z-50 m-0 flex h-full w-full max-h-none max-w-none items-center justify-center overflow-y-auto border-0 bg-transparent p-4 text-left shadow-none backdrop:bg-black/60 backdrop:backdrop-blur-sm focus:outline-none"
    >
      {children}
    </dialog>
  );
}
