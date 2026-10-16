import React from 'react';
import Badge from './Badge';

/**
 * The marker for a CPU-managed team (CONTEXT.md, ADR 0067): its manager was
 * banned after the draft and the CPU sets its lineup. A neutral pill beside the
 * Team name, read from `teams[].is_cpu` on the league payload. The visible
 * "CPU" text is the marker; the title spells it out on hover.
 */
export default function CpuBadge({ sx, ...rest }) {
  return (
    <Badge
      variant="neutral"
      data-testid="cpu-badge"
      title="Managed by the CPU"
      sx={{ flex: 'none', ...sx }}
      {...rest}
    >
      CPU
    </Badge>
  );
}
