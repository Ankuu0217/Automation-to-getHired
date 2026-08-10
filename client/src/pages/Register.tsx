import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, type RegisterInput } from '@jobmail/shared';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { AuthLayout } from '@/components/AuthLayout';
import { Mono } from '@/components/Mono';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiRequestError, register } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

export function Register() {
  const navigate = useNavigate();
  const setUser = useAuthStore((s) => s.setUser);

  const {
    register: registerField,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const mutation = useMutation({
    mutationFn: register,
    onSuccess: ({ user }) => {
      setUser(user);
      toast.success(`Account created — we sent a verification link to ${user.email}.`);
      navigate('/onboarding', { replace: true });
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && (error.code === 'CONFLICT' || error.status === 409)) {
        toast.error('That email is already registered. Try signing in instead.');
      } else {
        toast.error(
          error instanceof ApiRequestError ? error.message : 'Could not create your account.',
        );
      }
    },
  });

  return (
    <AuthLayout>
      <div className="space-y-1">
        <Mono size="xs" color="fog">
          New account
        </Mono>
        <h1 className="font-sans text-subheading font-normal text-paper">
          Create your account.
        </h1>
        <p className="font-sans text-sm font-normal text-text-2-dark">Start sending dispatches that get opened.</p>
      </div>

      <form
        onSubmit={handleSubmit((values) => mutation.mutate(values))}
        className="mt-6 space-y-4"
        noValidate
      >
        <div className="space-y-1.5">
          <Label htmlFor="name">Full name</Label>
          <Input
            id="name"
            autoComplete="name"
            placeholder="Ada Lovelace"
            aria-invalid={!!errors.name}
            {...registerField('name')}
          />
          {errors.name && (
            <Mono size="xs" color="danger">
              {errors.name.message}
            </Mono>
          )}
        </div>

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
            autoComplete="new-password"
            placeholder="8+ characters, with a letter and a number"
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
          {mutation.isPending ? 'Creating account…' : 'Create account'}
        </Button>

        <p className="text-center font-sans text-xs text-text-2-dark">
          We’ll email you a link to verify your address before your first send.
        </p>
      </form>

      <p className="mt-6 text-center font-sans text-sm text-text-2-dark">
        Already have an account?{' '}
        <Link
          to="/login"
          className="focus-ring rounded-btn font-mono text-[13px] uppercase tracking-[-0.02em] text-paper underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
