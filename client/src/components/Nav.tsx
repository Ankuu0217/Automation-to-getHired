import { useMutation } from '@tanstack/react-query';
import { ChevronDown, LogOut, Menu, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { Logo } from '@/components/Logo';
import { Separator } from '@/components/ui/separator';
import { logout } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

const APP_LINKS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/pipeline', label: 'Pipeline' },
  { to: '/dispatches', label: 'Dispatches' },
  { to: '/contacts', label: 'Contacts' },
  { to: '/templates', label: 'Templates' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/settings', label: 'Settings' },
] as const;

interface NavProps {
  variant?: 'app' | 'public';
  sentToday?: number;
  dailyCap?: number;
}

const PUBLIC_PILL =
  'focus-ring rounded-nav px-3 py-2 font-mono text-[13px] uppercase tracking-[-0.02em] text-text-2-dark transition-quick hover:bg-ink-3 hover:text-paper';

/** Landing header: transparent on ink, in flow (not sticky). */
function PublicNav() {
  return (
    <header className="absolute inset-x-0 top-0 z-40">
      <div className="mx-auto flex h-20 w-full max-w-[1200px] items-center justify-between px-6">
        <Link to="/" aria-label="GetHired home" className="focus-ring rounded-btn">
          <Logo />
        </Link>
        <div className="flex items-center gap-1 sm:gap-2">
          <a href="#method" className={cn(PUBLIC_PILL, 'hidden sm:inline-block')}>
            Method
          </a>
          <a href="#platform" className={cn(PUBLIC_PILL, 'hidden sm:inline-block')}>
            Platform
          </a>
          <Link to="/login" className={PUBLIC_PILL}>
            Log in
          </Link>
          <Link
            to="/register"
            className="focus-ring ml-1 inline-flex h-9 items-center gap-2 rounded-nav bg-paper px-4 font-mono text-[13px] uppercase tracking-[-0.02em] text-ink transition-quick hover:opacity-[0.92]"
          >
            Start applying
            <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </header>
  );
}

function UserMenu({ sentToday, dailyCap }: { sentToday: number; dailyCap: number }) {
  const navigate = useNavigate();
  const { user, clear } = useAuthStore();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const initial = user?.name?.trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="relative" ref={menuRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="focus-ring flex items-center gap-2 rounded-nav border border-graphite bg-ink-2 py-1 pl-1 pr-2 transition-quick hover:bg-ink-3"
      >
        <span className="flex size-7 items-center justify-center rounded-btn bg-ink font-mono text-xs font-normal text-paper">
          {initial}
        </span>
        <span className="hidden max-w-[120px] truncate font-sans text-sm font-normal text-paper sm:block">
          {user?.name ?? 'Account'}
        </span>
        <ChevronDown
          className={cn('size-3.5 text-text-3-dark transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-56 animate-fade-in rounded-card border border-graphite bg-ink-2 p-2">
          <div className="px-3 py-2">
            <p className="truncate font-sans text-sm font-normal text-paper">{user?.name}</p>
            <p className="truncate font-mono text-[10px] uppercase tracking-[0.16px] text-text-3-dark">{user?.email}</p>
            <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.16px] text-text-2-dark lg:hidden">
              Sent today · {sentToday}/{dailyCap}
            </p>
          </div>
          <Separator className="my-1" />
          <button
            type="button"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            className="focus-ring flex w-full items-center gap-2 rounded-btn px-3 py-2 font-sans text-sm font-normal text-text-2-dark transition-quick hover:bg-ink-3 hover:text-paper disabled:opacity-50"
          >
            <LogOut className="size-4" />
            {logoutMutation.isPending ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}

export function Nav({ variant = 'app', sentToday = 0, dailyCap = 30 }: NavProps) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'focus-ring rounded-nav px-3 py-2 font-mono text-[13px] uppercase tracking-[-0.02em] transition-quick',
      isActive ? 'bg-lime text-ink' : 'text-text-2-dark hover:bg-ink-3 hover:text-paper',
    );

  if (variant === 'public') return <PublicNav />;

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-graphite bg-ink/80 backdrop-blur-[24px]">
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-6">
        <Link to="/dashboard" aria-label="GetHired home" className="focus-ring rounded-btn">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {APP_LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} className={linkClass}>
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <span className="hidden whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.16px] text-text-2-dark lg:inline">
            Sent today · {sentToday}/{dailyCap}
          </span>
          <UserMenu sentToday={sentToday} dailyCap={dailyCap} />
          <button
            type="button"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            onClick={() => setMobileOpen((v) => !v)}
            className="focus-ring rounded-btn p-2 text-text-2-dark transition-quick hover:bg-ink-3 hover:text-paper md:hidden"
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav
          id="mobile-nav"
          aria-label="Primary"
          className="animate-fade-in border-t border-graphite bg-ink/95 backdrop-blur-[24px] md:hidden"
        >
          <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-1 px-4 py-3">
            {APP_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  cn(
                    'focus-ring rounded-nav px-3 py-2.5 font-mono text-[13px] uppercase tracking-[-0.02em] transition-quick',
                    isActive
                      ? 'bg-lime text-ink'
                      : 'text-text-2-dark hover:bg-ink-3 hover:text-paper',
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
            <p className="px-3 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.16px] text-text-3-dark">
              Sent today · {sentToday}/{dailyCap}
            </p>
          </div>
        </nav>
      )}
    </header>
  );
}
