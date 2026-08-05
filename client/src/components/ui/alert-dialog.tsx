import { AnimatePresence, motion } from 'framer-motion';
import * as React from 'react';

import { Button } from '@/components/ui/button';

/**
 * Themed confirmation dialog — replaces window.confirm for destructive
 * actions. Controlled: render it with open/onOpenChange and a confirm
 * handler; the caller owns any async state via `loading`.
 */
interface AlertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
}

function AlertDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  onConfirm,
}: AlertDialogProps) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, onOpenChange]);

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          role="alertdialog"
          aria-modal="true"
          aria-label={title}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-background/70"
            onClick={() => onOpenChange(false)}
          />
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'tween', duration: 0.15, ease: 'easeOut' }}
            className="relative w-full max-w-md rounded-card border border-border bg-surface p-6 shadow-lg"
          >
            <h2 className="font-display text-xl font-normal text-text-1">{title}</h2>
            <div className="mt-2 font-sans text-sm font-normal leading-relaxed text-text-2">
              {description}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                ref={cancelRef}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                {cancelLabel}
              </Button>
              <Button
                type="button"
                variant={destructive ? 'destructive' : 'default'}
                size="sm"
                onClick={onConfirm}
                disabled={loading}
              >
                {loading ? 'Working…' : confirmLabel}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export { AlertDialog };
