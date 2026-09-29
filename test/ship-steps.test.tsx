/**
 * What the wizard actually puts on screen. The runner's rows prove the processes are owned; these
 * prove a reader can see what is happening to them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from 'ink-testing-library';
import { Steps, elapsed } from '../src/scaffold/steps.js';
import { packagerPhase } from '../src/commands/ship.js';

describe('the steps a reader sees', () => {
  it('ticks what is finished and spins on what is not', () => {
    const { lastFrame } = render(
      <Steps steps={[
        { label: 'Building the desktop surface', state: 'done' },
        { label: 'Packaging the application', state: 'running' },
        { label: 'Notarizing the disk image', state: 'waiting' },
      ]} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('✓ Building the desktop surface');
    expect(frame).toContain('Packaging the application');
    // A step nobody has reached is not drawn at all: a list of pending work is noise.
    expect(frame).not.toContain('Notarizing the disk image');
  });

  it('marks a failed step, so the list says which one stopped', () => {
    const { lastFrame } = render(<Steps steps={[{ label: 'Packaging the application', state: 'failed' }]} />);
    expect(lastFrame() ?? '').toContain('✗ Packaging the application');
  });

  /** The packager runs for minutes. Without this the wizard is the firehose's opposite mistake:
   *  nothing on screen at all, and no way to tell working from hung. */
  it('keeps what happened inside a step as a record, not a status', () => {
    const { lastFrame } = render(
      <Steps steps={[{
        label: 'Packaging the application',
        state: 'running',
        seconds: 95,
        phases: [
          { label: 'packaged', detail: 'darwin arm64 · electron 44.4.5', state: 'done' },
          { label: 'signed', detail: 'Zuhair Naqvi (GXB6ZZPDWJ)', state: 'running' },
        ],
      }]} />,
    );
    const frame = lastFrame() ?? '';
    // Both are on screen: the earlier one did not scroll away when the next began.
    expect(frame).toContain('packaged');
    expect(frame).toContain('darwin arm64 · electron 44.4.5');
    expect(frame).toContain('signed');
    expect(frame).toContain('Zuhair Naqvi (GXB6ZZPDWJ)');
    expect(frame).toContain('1m 35s');
  });

  /** The phase still running when a step fails is the phase that failed. Ticking it would put a
   *  green ✓ signed inside a red ✗ packaging step, pointing away from the cause. */
  /** The list is a record of what happened, and how long it took is part of that — it used to
   *  vanish the instant a step settled, so the finished screen could not show it. */
  it('keeps the duration on a step that has settled', () => {
    const { lastFrame } = render(<Steps steps={[{ label: 'Packaging the application', state: 'done', seconds: 242 }]} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('✓ Packaging the application');
    expect(frame).toContain('4m 02s');
  });

  it('marks the phase that was running when the step failed', () => {
    const { lastFrame } = render(
      <Steps steps={[{
        label: 'Packaging the application',
        state: 'failed',
        phases: [
          { label: 'packaged', detail: 'darwin arm64', state: 'done' },
          { label: 'signed', state: 'failed' },
        ],
      }]} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('✓ packaged');
    expect(frame).toContain('✗ signed');
    expect(frame).not.toContain('✓ signed');
  });

  it('says nothing about the clock until a step has run long enough to need one', () => {
    const { lastFrame } = render(<Steps steps={[{ label: 'Packaging', state: 'running', seconds: 1 }]} />);
    expect(lastFrame() ?? '').not.toContain('1s');
  });

  it('reads a duration without making anyone decode it', () => {
    expect(elapsed(9)).toBe('9s');
    expect(elapsed(59)).toBe('59s');
    expect(elapsed(60)).toBe('1m 00s');
    expect(elapsed(605)).toBe('10m 05s');
  });

  /**
   * Read from a real captured run of the pinned packager (26.15.3), not from invented samples.
   *
   * Only what the packager SAYS becomes a phase. Nothing is inferred from one marker about work
   * that no marker mentions — the packager announces signing and then says nothing at all while
   * Apple notarizes the application, and that silence stays silent rather than being narrated.
   */
  describe('the packager\'s own phases', () => {
    it('reads the markers it actually emits', () => {
      expect(packagerPhase('  • packaging       platform=darwin arch=arm64 electron=44.4.5 appOutDir=release/mac-arm64'))
        .toEqual({ label: 'packaged', detail: 'darwin arm64 · electron 44.4.5' });
      expect(packagerPhase('  • building        target=DMG arch=arm64 file=release/fieldnote-0.1.0-arm64.dmg'))
        .toEqual({ label: 'built the disk image' });
    });

    /** An identity has spaces in it, so splitting the tail on whitespace would keep one word. */
    it('keeps a value that contains spaces whole', () => {
      expect(packagerPhase('  • signing         file=fieldnote.app identity=Zuhair Naqvi (GXB6ZZPDWJ) provisioningProfile=none'))
        .toEqual({ label: 'signed', detail: 'Zuhair Naqvi (GXB6ZZPDWJ)' });
    });

    /** Additive by construction: an unrecognised line contributes nothing, so a format that moves
     *  loses detail and never truth. These are all real lines from the same run. */
    it('adds nothing for a line it does not recognise', () => {
      for (const line of [
        '  • electron-builder  version=26.15.3 os=25.3.0',
        '  • loaded configuration  file=/tmp/lloyal-ship-QJgBh8/electron-builder.json',
        '  • skipped dependencies rebuild  reason=npmRebuild is set to false',
        '  • skipped macOS code signing  reason=identity explicitly is set to null',
        '  • building block map  blockMapFile=release/fieldnote-0.1.0-arm64.dmg.blockmap',
        `  • duplicate dependency references  dependencies=["${'x'.repeat(6000)}"]`,
        'vite v7.1.5 building for production...',
        '',
      ]) {
        expect(packagerPhase(line)).toBeUndefined();
      }
    });
  });
});

/**
 * Guards on the shipping path that are about the SOURCE, not a value it computes — the same shape
 * as this repo's "no raw npm spawn outside npm-spawn" CI check.
 */
describe('what the shipping path pins and promises', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');

  /** The adapter's credential-safety and error shape were read from one exact release. Consumers
   *  install from the registry, not this lockfile, so a range would let a later 3.x replace the
   *  implementation that was audited — which is why the packager is pinned exactly too. */
  it('pins the notarization library exactly, like the packager', () => {
    const { dependencies } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(dependencies['@electron/notarize']).toMatch(/^\d+\.\d+\.\d+$/);
  });

  /** stderr is a pipe to the parent, so `process.exit()` truncates at one buffer — measured at
   *  65,536 of 200,007 characters. Apple's rejection log is the long message that would be lost,
   *  and it is the only reason this adapter runs a library instead of `xcrun`. */
  it('never exits the notarize adapter before its diagnostic drains', () => {
    const source = readFileSync(join(root, 'src/notarize-image.ts'), 'utf8');
    expect(source).toContain('process.exitCode');
    expect(source).not.toMatch(/process\.exit\(/);
  });
});
