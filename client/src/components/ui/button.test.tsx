import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from './button';

describe('Button', () => {
  it('renders children with the default accent variant', () => {
    render(<Button>Send it</Button>);
    const button = screen.getByRole('button', { name: 'Send it' });
    expect(button).toBeInTheDocument();
    expect(button.className).toContain('bg-primary');
    expect(button.className).toContain('text-primary-foreground');
  });

  it('applies variant and size classes', () => {
    render(
      <Button variant="outline" size="sm">
        Cancel
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Cancel' });
    expect(button.className).toContain('border-graphite');
    expect(button.className).toContain('h-8');
  });
});
