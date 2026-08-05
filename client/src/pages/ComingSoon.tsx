import type { LucideIcon } from 'lucide-react';
import { Construction } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

interface ComingSoonProps {
  title: string;
  milestone: string;
  description?: string;
  icon?: LucideIcon;
}

export function ComingSoon({ title, milestone, description, icon: Icon = Construction }: ComingSoonProps) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center animate-fade-in-up">
      <Card className="w-full max-w-md text-center">
        <CardContent className="flex flex-col items-center gap-4 p-10">
          <div className="flex size-14 items-center justify-center rounded-card border border-border bg-surface">
            <Icon className="size-6 text-cyan" />
          </div>
          <div className="space-y-1.5">
            <h1 className="font-display text-xl font-normal text-text-1">{title}</h1>
            <p className="font-sans text-sm text-text-2">
              {description ?? 'This section is on the roadmap and will slot into this navigation soon.'}
            </p>
          </div>
          <Badge variant="default">Available in milestone {milestone}</Badge>
        </CardContent>
      </Card>
    </div>
  );
}
