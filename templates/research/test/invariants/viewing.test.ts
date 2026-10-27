/**
 * What the enlarged view shows, and the hold a video puts on the run: a video opened while the run works holds it,
 * closing lets go of that hold and no other, and a video the run is not yet held for stays covered. Pure — the run's
 * facts in, the commands out, no DOM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closing, covered, holding, opening, type RunFacts } from '../../src/ui/viewing.js';

const WORKING: RunFacts = { live: true, paused: false };
const HELD: RunFacts = { live: true, paused: true };
const IDLE: RunFacts = { live: false, paused: false };

const VIDEO = { video: { frames: [], durationMs: 615_955, atMs: 86_600, src: 'http://host/v1/media/v/source' }, label: 'the attached video' } as const;
const IMAGE = { digest: 'sha256:image' } as const;
const PDF = { pdf: 'http://host/v1/media/d/source', label: 'A paper' } as const;

test('a video opened while the run works holds the run', () => {
  const { viewing, command } = opening(VIDEO, WORKING);
  assert.deepEqual(command, { type: 'pause' });
  assert.equal(viewing.holds, true);
});

test('a video opened while the run is idle, or already held by the reader, sends nothing', () => {
  for (const run of [IDLE, HELD]) {
    const { viewing, command } = opening(VIDEO, run);
    assert.equal(command, null);
    assert.equal(viewing.holds, false);
  }
});

test('an image or a document never holds the run: only a video needs the GPU to play', () => {
  for (const opened of [IMAGE, PDF]) {
    const { viewing, command } = opening(opened, WORKING);
    assert.equal(command, null);
    assert.equal(viewing.holds, false);
  }
});

test('closing lets go of the hold the video put on the run, and of no other', () => {
  assert.deepEqual(closing(opening(VIDEO, WORKING).viewing), { type: 'resume' });
  assert.equal(closing(opening(VIDEO, HELD).viewing), null, "the reader's own hold stays");
  assert.equal(closing(opening(VIDEO, IDLE).viewing), null);
  assert.equal(closing(opening(IMAGE, WORKING).viewing), null);
});

test('a video is covered while the run works and is not held, and plays once it is held or settles', () => {
  const { viewing } = opening(VIDEO, WORKING);
  assert.equal(covered(viewing, WORKING), true, 'the hold has not taken yet, or cannot');
  assert.equal(covered(viewing, HELD), false);
  assert.equal(covered(viewing, IDLE), false);
});

test('a hold that never took leaves the video covered, and closing still lets go of it', () => {
  // The run went on (it was between steps, or closing): the view still sent the pause, so it still sends the resume
  // that clears it.
  const { viewing } = opening(VIDEO, WORKING);
  assert.equal(covered(viewing, WORKING), true);
  assert.deepEqual(closing(viewing), { type: 'resume' });
});

test('a run that starts under an open video is held by it then, and closing lets go of that hold', () => {
  // Opened during plan review, before the countdown starts the research: without the hold it would wait for the
  // run to settle.
  const opened = opening(VIDEO, IDLE).viewing;
  const { viewing, command } = holding(opened, WORKING);
  assert.deepEqual(command, { type: 'pause' });
  assert.equal(viewing.holds, true);
  assert.deepEqual(closing(viewing), { type: 'resume' });
});

test('a video that holds the run already sends nothing more while the run works', () => {
  const { viewing } = opening(VIDEO, WORKING);
  assert.deepEqual(holding(viewing, WORKING), { viewing, command: null });
});

test("a video open on the reader's own hold takes no hold of its own until the run works again", () => {
  const opened = opening(VIDEO, HELD).viewing;
  assert.equal(holding(opened, HELD).command, null);
  assert.deepEqual(holding(opened, WORKING).command, { type: 'pause' });
});

test('an image or a document takes no hold when a run starts under it', () => {
  for (const opened of [IMAGE, PDF]) assert.equal(holding(opening(opened, IDLE).viewing, WORKING).command, null);
});

test('an image or a document is never covered', () => {
  for (const opened of [IMAGE, PDF]) assert.equal(covered(opening(opened, WORKING).viewing, WORKING), false);
});
