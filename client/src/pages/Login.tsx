import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@jobmail/shared';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { AuthLayout } from '@/components/AuthLayout';
import { Mono } from '@/components/Mono';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiRequestError, login } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const setUser = useAuthStore((s) => s.setUser);

  const {
    register: registerField,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: ({ user }) => {
      setUser(user);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/dashboard', { replace: true });
    },
    onError: (error) => {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not sign you in.');
    },
  });

  return (
    <AuthLayout>
      <div className="space-y-1">
        <h1 className="font-sans text-xl font-normal text-paper">
          Welcome back
        </h1>
        <p className="font-sans text-sm font-normal text-text-2-dark">Sign in to your dispatch desk.</p>
      </div>

      <form
        onSubmit={handleSubmit((values) => mutation.mutate(values))}
        className="mt-6 space-y-4"
        noValidate
      >
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-invalid={!!errors.email}
            {...registerField('email')}
          />
          {errors.email && (
            <Mono size="xs" color="danger">
              {errors.email.message}
            </Mono>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            aria-invalid={!!errors.password}
            {...registerField('password')}
          />
          {errors.password && (
            <Mono size="xs" color="danger">
              {errors.password.message}
            </Mono>
          )}
        </div>

        <Button type="submit" className="w-full" size="lg" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
          {mutation.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-6 text-center font-sans text-sm text-text-2-dark">
        New to GetHired?{' '}
        <Link
          to="/register"
          className="focus-ring rounded-btn font-normal text-paper underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </AuthLayout>
  );
}
