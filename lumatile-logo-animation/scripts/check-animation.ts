import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  blockState,
  progress,
  slideProgress,
  timeline,
} from "../src/animation.ts";

assert.equal(
  createHash("sha256")
    .update(readFileSync(new URL("../public/lumatile.png", import.meta.url)))
    .digest("hex"),
  "33ee9a11a357bc4444905b7dd6e919bd9b1c50ee1ade2a098d7b5f7f5e1e89e4",
  "Final PNG must be an unmodified copy of the reference",
);

for (const name of [
  "topRight",
  "topLeft",
  "bottomLeft",
  "bottomRight",
] as const) {
  const range = timeline[name];
  assert.deepEqual(blockState(range[0], 30, range), {
    opacity: 0,
    scale: 0.85,
  });
  assert.deepEqual(blockState(range[1], 30, range), { opacity: 1, scale: 1 });
  let last = 0.85;
  for (let frame = range[0]; frame <= range[1]; frame++) {
    const state = blockState(frame, 30, range);
    assert(
      state.scale >= last && state.scale <= 1,
      `${name}: scale must settle without overshoot`,
    );
    last = state.scale;
  }
}
assert.equal(progress(38, timeline.shrink), 0);
assert.equal(progress(44, timeline.shrink), 1);
for (let frame = 36; frame <= 44; frame++) {
  assert.deepEqual(blockState(frame, 30, timeline.bottomRight), {
    opacity: 1,
    scale: 1,
  });
  assert.equal(
    slideProgress(frame),
    0,
    "Slide and color change must wait until shrinking finishes",
  );
}
assert.equal(slideProgress(44), 0);
assert.equal(slideProgress(52), 1);
assert(slideProgress(48) > 0 && slideProgress(48) < 1);
assert.equal(progress(75, timeline.originalPng), 0);
assert.equal(progress(79, timeline.originalPng), 1);
assert(
  progress(77, timeline.originalPng) > 0 &&
    progress(77, timeline.originalPng) < 1,
);
for (const frame of [79, 89]) {
  for (const range of Object.values(timeline).slice(0, -1))
    assert.equal(progress(frame, range), 1);
  assert.equal(slideProgress(frame), 1);
}
console.log(
  "Animation checks passed: tile hold, shrink before slide/wipe, original PNG handoff, final hold.",
);
