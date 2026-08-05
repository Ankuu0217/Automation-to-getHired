import { useMutation } from '@tanstack/react-query';
import { ChevronDown, LogOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { logout } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

const PUBLIC_LINKS = [
  { to: '/login', label: 'Log in' },
] as const;

const APP_LINKS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/pipeline', label: 'Wire Board' },
  { to: '/templates', label: 'Templates' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/settings', label: 'Settings' },
] as const;

interface NavProps {
  variant?: 'public' | 'app';
  sentToday?: number;
  dailyCap?: number;
}

function UserMenu() {
  const navigate = useNavigate();
  const { user, clear } = useAuthStore();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSettled: () => {
      clear();
      navigate('/login', { replace: true });
    },
    onError: () => {
      toast.error('Could not reach the server — signed out locally.');
    },
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const initial = user?.name?.trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-[8px] border border-pure/[0.06] bg-graphite py-1 pl-1 pr-2 transition-quick hover:bg-steel"
      >
        <span className="flex size-7 items-center justify-center rounded-[8px] bg-obsidian font-sans text-xs font-normal text-pure">
          {initial}
        </span>
        <span className="hidden max-w-[120px] truncate font-sans text-sm font-normal text-cloud sm:block">
          {user?.name ?? 'Account'}
        </span>
        <ChevronDown
          className={cn('size-3.5 text-fog transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-56 animate-fade-in rounded-[8px] border border-pure/[0.06] bg-graphite p-2 shadow-lg">
          <div className="px-3 py-2">
            <p className="truncate font-sans text-sm font-normal text-cloud">{user?.name}</p>
            <p className="truncate font-mono text-[10px] uppercase tracking-[0.16px] text-fog">{user?.email}</p>
          </div>
          <Separator className="my-1 bg-pure/[0.06]" />
          <button
            type="button"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 font-sans text-sm font-normal text-ash transition-quick hover:bg-steel hover:text-pure disabled:opacity-50"
          >
            <LogOut className="size-4" />
            {logoutMutation.isPending ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}

export function Nav({ variant = 'public', sentToday = 0, dailyCap = 30 }: NavProps) {
  const location = useLocation();
  const isApp = variant === 'app';

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-pure/[0.06] bg-obsidian/80 backdrop-blur-[24px]">
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-6">
        <Link to={isApp ? '/dashboard' : '/'} aria-label="GetHired home">
          <Logo />
        </Link>

        {isApp ? (
          <nav className="hidden items-center gap-1 md:flex">
            {APP_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-[8px] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16px] transition-quick',
                    isActive ? 'bg-graphite text-pure' : 'text-ash hover:bg-graphite hover:text-pure',
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        ) : null}

        <div className="flex items-center gap-4">
          {isApp ? (
            <>
              <span className="hidden font-mono text-[11px] uppercase tracking-[0.16px] text-ash sm:inline">
                Sent today · {sentToday}/{dailyCap}
              </span>
              <UserMenu />
            </>
          ) : (
            <>
              {PUBLIC_LINKS.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className={cn(
                    'font-sans text-sm font-normal text-ash transition-quick hover:text-pure',
                    location.pathname === link.to && 'text-pure',
                  )}
                >
                  {link.label}
                </Link>
              ))}
              <Link to="/register">
                <Button>
                  Get started
                  <span aria-hidden>→</span>
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
