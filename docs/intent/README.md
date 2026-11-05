# Emberline: intent

This folder records **why** Emberline is built the way it is: who it is for, what it must
achieve, the rules it never breaks, and the reasoning behind each major decision. The
[project README](../../README.md) covers *how* to run and use it.

Read these before changing anything substantial. If a change conflicts with an intent here,
either keep the intent or update this folder in the same commit, with the reason.

| File | Covers |
|---|---|
| [01-purpose.md](01-purpose.md) | Who Emberline is for, what it must make them feel and do, and what success looks like |
| [02-principles.md](02-principles.md) | The two equal goals (visual wow, real function) and the honesty rules that bind them |
| [03-constraints.md](03-constraints.md) | Hard constraints from the owner: no data in GitHub, SQLite, no dependencies, real data first |
| [04-modes.md](04-modes.md) | The intent behind each mode and cross-cutting feature, and what each one must never do |
| [05-data.md](05-data.md) | Each data source, why it was chosen, and what is real, interpolated, illustrative or simulated |
| [06-decisions.md](06-decisions.md) | Decision log: the choices made, the alternatives, and why |
| [07-status.md](07-status.md) | What is built, what is unfinished, and where the work goes next |
| [08-backlog.md](08-backlog.md) | Ideas not yet built, in suggested order, with their verified public data sources |

[CLAUDE.md](../../CLAUDE.md) is the condensed version of these files for coding agents, plus
the verified notes about external services. Keep the two in step.
