import type { ReactNode } from 'react';

import { Logo } from '@/components/Logo';
import { Mono } from '@/components/Mono';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-6 py-12">
      <div className="w-full max-w-[400px] animate-fade-in">
        <div className="mb-6 text-center">
          <Logo />
        </div>

        <div className="rounded-card border border-graphite bg-ink-2 p-6">{children}</div>

        <Mono size="xs" color="fog" className="mt-4 block text-center">
          Your data stays yours
        </Mono>
      </div>
    </div>
  );
}
