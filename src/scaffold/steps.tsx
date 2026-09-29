/**
 * A list of things happening, one line each: a spinner on the one in flight, a tick on the ones
 * behind it, and nothing else on screen.
 *
 * This is the surface `lloyal new` already has — the same amber spinner and green tick from
 * {@link ./palette} — and the reason it exists as a component is that `ship` was the one long verb
 * without it, printing a build log where a reader wanted four words.
 *
 * It renders state and owns nothing else. Processes, their logs and their cancellation belong to
 * the runner in {@link ../npm-spawn}, because a view that owned a subprocess would have to be
 * mounted for the subprocess to be killable, which is exactly backwards.
 *
 * It draws on **stderr**. `terminal.ts` states the rule — stdout stays a clean pipe — so
 * `ship > image.txt` gets the report and nothing else, while the wizard still appears on a
 * terminal even when stdout is piped somewhere.
 */
import { Box, Static, Text, render } from 'ink';
import { Spinner, ThemeProvider } from '@inkjs/ui';
import type { ReactElement } from 'react';
import { cliTheme } from './palette.js';
import { interactive } from './terminal.js';

export type StepState = 'waiting' | 'running' | 'done' | 'failed';

/**
 * One piece of work inside a step, kept as a record rather than overwritten.
 *
 * A tail shows the latest line and loses the rest; these accumulate, so when the packager finishes
 * the reader can still see that it packaged, signed and notarized, in that order. The tick carries
 * STATE and the label carries KIND — a different glyph per kind would be a legend to learn for
 * information the word already gave.
 */
export interface Phase {
  readonly label: string;
  readonly detail?: string;
  readonly state: 'running' | 'done' | 'failed';
  /** Waiting on somebody else — the one distinction worth a mark, since it is the only wait the
   *  developer cannot shorten and it is an order of magnitude longer than the rest. */
  readonly waiting?: boolean;
}

export interface Step {
  readonly label: string;
  readonly state: StepState;
  /** Seconds this step has been running, so a long wait visibly moves. */
  readonly seconds?: number;
  /** What happened inside it, in order. */
  readonly phases?: readonly Phase[];
}

/** The width the phase labels share, so their details line up under each other. */
const column = (phases: readonly Phase[]): number => Math.max(0, ...phases.map((p) => p.label.length));

function Phases({ phases }: { phases: readonly Phase[] }): ReactElement | null {
  if (phases.length === 0) return null;
  const width = column(phases);
  return (
    <Box flexDirection="column">
      {phases.map((phase) => (
        <Box key={phase.label} gap={1}>
          <Text>{'  '}</Text>
          {phase.state === 'done' ? <Text color="green">✓</Text>
            : phase.state === 'failed' ? <Text color="red">✗</Text>
            : <Spinner />}
          <Text>{phase.label.padEnd(width)}</Text>
          {phase.detail === undefined ? null : (
            <Text dimColor={phase.waiting !== true}>{phase.detail}</Text>
          )}
        </Box>
      ))}
    </Box>
  );
}

/** A settled line and the record of what happened inside it, painted once and never repainted. */
function Settled({ step }: { step: Step }): ReactElement {
  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text color={step.state === 'done' ? 'green' : 'red'}>{step.state === 'done' ? '✓' : '✗'}</Text>
        <Text>{step.label}</Text>
        {/* The record is the point: how long it took is part of what happened, so it stays. */}
        {step.seconds === undefined || step.seconds < 3 ? null : <Text dimColor>{elapsed(step.seconds)}</Text>}
      </Box>
      <Phases phases={step.phases ?? []} />
    </Box>
  );
}

/** `1m 40s`, and plain seconds below a minute — a duration nobody has to decode. */
export function elapsed(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export function Steps({ steps }: { steps: readonly Step[] }): ReactElement {
  // `Static` appends and never repaints, which is what makes the finished lines accumulate up the
  // screen instead of flickering under the spinner.
  const settled = steps.filter((s) => s.state === 'done' || s.state === 'failed');
  const running = steps.find((s) => s.state === 'running');
  return (
    <ThemeProvider theme={cliTheme}>
      <Static items={settled}>{(step) => <Settled key={step.label} step={step} />}</Static>
      {running === undefined ? null : (
        <Box flexDirection="column">
          <Box gap={1}>
            <Spinner />
            <Text>{running.label}</Text>
            {running.seconds === undefined || running.seconds < 3 ? null : (
              <Text dimColor>{elapsed(running.seconds)}</Text>
            )}
          </Box>
          <Phases phases={running.phases ?? []} />
        </Box>
      )}
    </ThemeProvider>
  );
}

/** Driving a list of steps, without the caller knowing whether anything is being drawn. */
export interface StepsView {
  start(index: number): void;
  /**
   * Record a piece of work inside a step. The one before it settles, so the list reads as a
   * history rather than a status. Ignored where nothing is being drawn.
   */
  phase(index: number, phase: Omit<Phase, 'state'>): void;
  settle(index: number, ok: boolean): void;
  /** Take the view down, leaving the settled lines where they are. */
  stop(): void;
}

/**
 * Show `labels` as steps, on a terminal or in a pipe.
 *
 * One entry point for both, so no verb has to ask the TTY question twice or answer it differently.
 * A pipe gets plain lines and no escape codes; a terminal gets the wizard.
 */
export function showSteps(labels: readonly string[], stream: NodeJS.WriteStream = process.stderr): StepsView {
  const steps: Step[] = labels.map((label) => ({ label, state: 'waiting' }));
  const put = (index: number, next: Partial<Step>): void => { steps[index] = { ...steps[index], ...next }; };

  if (!interactive(stream)) {
    // A pipe is already getting the child's own output, so a tail of it would be a second copy.
    return {
      start: (i) => { put(i, { state: 'running' }); stream.write(`→ ${steps[i].label}\n`); },
      phase: () => { /* the child's own output is the record here */ },
      settle: (i, ok) => { put(i, { state: ok ? 'done' : 'failed' }); stream.write(`${ok ? '✓' : '✗'} ${steps[i].label}\n`); },
      stop: () => { /* nothing was mounted */ },
    };
  }

  const view = render(<Steps steps={steps} />, { stdout: stream, exitOnCtrlC: false });
  const paint = (): void => view.rerender(<Steps steps={[...steps]} />);

  // A step that waits on Apple for minutes has to look alive, so the clock runs on its own rather
  // than only when the child happens to say something.
  let startedAt = 0;
  let ticking: NodeJS.Timeout | undefined;
  const tick = (i: number): void => {
    put(i, { seconds: Math.round((Date.now() - startedAt) / 1000) });
    paint();
  };
  const stopClock = (): void => { if (ticking) clearInterval(ticking); ticking = undefined; };

  return {
    start: (i) => {
      stopClock();
      startedAt = Date.now();
      put(i, { state: 'running', seconds: 0, phases: [] });
      ticking = setInterval(() => tick(i), 1000);
      ticking.unref?.();
      paint();
    },
    phase: (i, next) => {
      const settled = (steps[i].phases ?? []).map((p) => ({ ...p, state: 'done' as const }));
      put(i, { phases: [...settled, { ...next, state: 'running' }] });
      paint();
    },
    settle: (i, ok) => {
      stopClock();
      // The phase that was still running when the step failed is the phase that FAILED. Marking
      // every phase done would print a green ✓ signed inside a red ✗ packaging step — the one
      // line a reader would use to decide where to look, pointing away from the cause.
      put(i, {
        state: ok ? 'done' : 'failed',
        phases: (steps[i].phases ?? []).map((p) =>
          p.state === 'running' ? { ...p, state: ok ? ('done' as const) : ('failed' as const) } : p,
        ),
      });
      paint();
    },
    stop: () => { stopClock(); view.unmount(); },
  };
}
