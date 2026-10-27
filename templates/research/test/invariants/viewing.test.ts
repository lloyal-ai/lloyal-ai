/**
 * What the enlarged view shows, and the hold a video puts on the run: a video opened while the run works holds it,
 * closing lets go of that hold and no other, and a video the run is not yet held for stays covered. Pure — the run's
 * facts in, the commands out, no DOM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closing, covered, opening, type RunFacts } from '../../src/ui/viewing.js';

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

test('an image or a document is never covered', () => {
  for (const opened of [IMAGE, PDF]) assert.equal(covered(opening(opened, WORKING).viewing, WORKING), false);
});
