import { motion } from 'framer-motion';
import {
  BarChart3,
  Camera,
  Mail,
  PenTool,
  Send,
  Sparkles,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

import { AiPromptInput } from '@/components/AiPromptInput';
import { CategoryTile } from '@/components/CategoryTile';
import { Logo } from '@/components/Logo';
import { Mono } from '@/components/Mono';
import { StatSpotlight } from '@/components/StatSpotlight';
import { Button } from '@/components/ui/button';

const FEATURES = [
  {
    color: 'iris' as const,
    icon: Send,
    title: 'Outreach autopilot',
    description: 'Vision AI reads the LinkedIn screenshot and extracts company, role, JD, and HR contact.',
  },
  {
    color: 'peri' as const,
    icon: BarChart3,
    title: 'Pipeline tracking',
    description: 'Kanban + funnel analytics show opens, replies, interviews, and best-performing templates.',
  },
  {
    color: 'deep' as const,
    icon: Mail,
    title: 'Follow-up engine',
    description: 'Queued, tracked, and auto-attached with your resume. Follow-ups stop on reply or bounce.',
  },
  {
    color: 'orchid' as const,
    icon: PenTool,
    title: 'Template studio',
    description: 'Save prompts and compare reply rates to double down on what actually gets responses.',
  },
  {
    color: 'pale' as const,
    icon: Sparkles,
    title: 'AI email writer',
    description: 'The email is personalized to the JD — no generic “I hope this finds you well” fluff.',
  },
  {
    color: 'cyan' as const,
    icon: Camera,
    title: 'Tracking & analytics',
    description: 'Daily caps, jitter between sends, MX checks, and human-in-the-loop review by default.',
  },
] as const;

function Header() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border bg-background/80 backdrop-blur-[24px]">
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-6">
        <Logo />
        <div className="flex items-center gap-4">
          <Link
            to="/login"
            className="font-sans text-sm font-normal text-text-2 transition-quick hover:text-pure"
          >
            Log in
          </Link>
          <Link to="/register">
            <Button>
              Get started
              <span aria-hidden>→</span>
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}

export function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-pure">
      <Header />

      {/* Hero */}
      <section className="relative overflow-hidden pb-20 pt-36">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[680px] sky-hero"
          style={{
            maskImage: 'linear-gradient(to bottom, black 40%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, black 40%, transparent 100%)',
          }}
        />
        <div className="relative mx-auto w-full max-w-[1200px] px-6">
          <div className="mx-auto max-w-3xl text-center">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 2.5, ease: [0.455, 0.03, 0.515, 0.955] }}
            >
              <Mono size="sm" color="ash">
                Cold email, perfected
              </Mono>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 2.5, delay: 0.08, ease: [0.455, 0.03, 0.515, 0.955] }}
              className="mt-6 font-display text-[clamp(56px,8vw,96px)] font-normal leading-[0.9] text-pure"
            >
              The job you screenshotted, <span className="italic">applied</span>.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 2.5, delay: 0.16, ease: [0.455, 0.03, 0.515, 0.955] }}
              className="mx-auto mt-5 max-w-[560px] font-sans text-lg font-light leading-[1.5] text-text-2"
            >
              Turn LinkedIn job posts into sent, tracked, personalized HR outreach emails — with
              your resume attached and follow-ups that stop on reply.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 2.5, delay: 0.24, ease: [0.455, 0.03, 0.515, 0.955] }}
              className="mx-auto mt-8 max-w-xl"
            >
              <AiPromptInput
                placeholder="Paste a LinkedIn job URL or drop a screenshot…"
                onSubmit={(value) => {
                  if (value.trim()) navigate('/register');
                }}
              />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 2.5, delay: 0.32, ease: [0.455, 0.03, 0.515, 0.955] }}
              className="mt-6 flex justify-center"
            >
              <Link to="/register">
                <Button size="lg">
                  Get started
                  <span aria-hidden>→</span>
                </Button>
              </Link>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="py-20">
        <div className="mx-auto w-full max-w-[1200px] px-6">
          <div className="mb-12 text-center">
            <Mono size="sm" color="ash">
              The system
            </Mono>
            <h2 className="mt-3 font-display text-[38px] font-normal leading-[0.9] text-text-1">
              Six modules, one <span className="italic">workflow</span>.
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <CategoryTile
                key={feature.title}
                color={feature.color}
                title={feature.title}
                description={feature.description}
                icon={feature.icon}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Product band */}
      <section className="bg-surface py-[90px]">
        <div className="mx-auto w-full max-w-[1200px] px-6">
          <div className="text-center">
            <Mono size="sm" color="ash">
              The product
            </Mono>
            <h2 className="mt-3 font-display text-[38px] font-normal leading-[0.9] text-text-1">
              A quiet desk for a noisy <span className="italic">search</span>.
            </h2>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 2.5, ease: [0.455, 0.03, 0.515, 0.955] }}
            className="mx-auto mt-12 max-w-5xl"
          >
            <div className="chrome-frame">
              <div className="aspect-[16/10] overflow-hidden rounded-func bg-background">
                {/* Product screenshot placeholder — machined-metal frame is the hero */}
                <div className="flex h-full flex-col">
                  <div className="flex h-10 items-center gap-2 border-b border-border px-4">
                    <div className="flex gap-1.5">
                      <span className="size-2.5 rounded-full bg-text-3/40" />
                      <span className="size-2.5 rounded-full bg-text-3/40" />
                      <span className="size-2.5 rounded-full bg-text-3/40" />
                    </div>
                    <Mono size="xs" color="fog" className="ml-auto">
                      GetHired
                    </Mono>
                  </div>
                  <div className="flex flex-1">
                    <div className="w-48 border-r border-border p-4">
                      <div className="space-y-2">
                        <div className="h-2 w-20 rounded bg-text-3/20" />
                        <div className="h-2 w-28 rounded bg-text-3/20" />
                        <div className="h-2 w-16 rounded bg-text-3/20" />
                      </div>
                    </div>
                    <div className="flex-1 p-6">
                      <div className="h-4 w-48 rounded bg-text-3/20" />
                      <div className="mt-6 grid grid-cols-4 gap-3">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <div key={i} className="h-16 rounded-func bg-text-3/10" />
                        ))}
                      </div>
                      <div className="mt-6 h-48 rounded-func bg-text-3/10" />
                      <div className="mt-4 space-y-2">
                        <div className="h-8 w-full rounded bg-text-3/10" />
                        <div className="h-8 w-full rounded bg-text-3/10" />
                        <div className="h-8 w-full rounded bg-text-3/10" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Proof card */}
      <section className="py-20">
        <div className="mx-auto w-full max-w-[1200px] px-6">
          <div className="mx-auto max-w-xl">
            <StatSpotlight
              label="Response rate"
              value="18%"
              description="Average reply rate for GetHired users who review before sending. Human-in-the-loop beats spray-and-pray."
            />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col items-center justify-between gap-3 px-6 sm:flex-row">
          <Logo />
          <Mono size="xs" color="fog">
            © {new Date().getFullYear()} GetHired · Your data stays yours
          </Mono>
          <div className="flex gap-4">
            <Link to="/login" className="font-sans text-sm text-text-2 transition-quick hover:text-pure">
              Log in
            </Link>
            <Link to="/register" className="font-sans text-sm text-text-2 transition-quick hover:text-pure">
              Sign up
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
