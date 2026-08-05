import { X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/*
 * Chip editor for short string lists (skills, preferred roles). Enter or
 * comma adds, case-insensitive dedupe, X removes. Extracted from
 * Onboarding.tsx — the defaults keep the original behavior verbatim.
 */
interface SkillsEditorProps {
  skills: string[];
  onChange: (skills: string[]) => void;
  /** Entry cap — matches the server-side skills limit by default. */
  max?: number;
  /** Toast shown when the cap is hit. */
  maxMessage?: string;
  placeholder?: string;
  emptyLabel?: string;
  /** aria-label for the add (+) button. */
  addLabel?: string;
}

export function SkillsEditor({
  skills,
  onChange,
  max = 50,
  maxMessage,
  placeholder = 'Add a skill (e.g. React) and press Enter',
  emptyLabel = 'No skills yet — add a few below.',
  addLabel = 'Add skill',
}: SkillsEditorProps) {
  const [draft, setDraft] = useState('');

  const addSkill = () => {
    const value = draft.trim();
    if (!value) return;
    if (skills.length >= max) {
      toast.error(maxMessage ?? `Maximum of ${max} skills.`);
      return;
    }
    if (!skills.some((s) => s.toLowerCase() === value.toLowerCase())) {
      onChange([...skills, value]);
    }
    setDraft('');
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {skills.map((skill) => (
          <span
            key={skill}
            className="inline-flex items-center gap-1 rounded-pill border border-graphite px-2.5 py-1 font-sans text-xs text-text-2-dark"
          >
            {skill}
            <button
              type="button"
              aria-label={`Remove ${skill}`}
              onClick={() => onChange(skills.filter((s) => s !== skill))}
              className="focus-ring rounded-pill p-0.5 text-text-3-dark transition-quick hover:text-paper"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {skills.length === 0 && <p className="font-sans text-sm text-text-2-dark">{emptyLabel}</p>}
      </div>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              addSkill();
            }
          }}
          placeholder={placeholder}
        />
        <Button type="button" variant="outline" size="icon" onClick={addSkill} aria-label={addLabel}>
          <span aria-hidden>+</span>
        </Button>
      </div>
    </div>
  );
}
