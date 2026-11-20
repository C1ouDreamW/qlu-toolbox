import { Easing, interpolate, spring } from "remotion";

// Global frame numbers at 30 FPS; end is the first fully settled frame.
export const timeline = {
  topRight: [0, 10],
  topLeft: [10, 20],
  bottomLeft: [20, 30],
  bottomRight: [30, 36],
  shrink: [38, 44],
  slideAndColor: [44, 52],
  lineTop: [52, 58],
  lineMiddle: [58, 64],
  lineBottom: [64, 70],
  bottomBar: [70, 75],
  originalPng: [75, 79],
  hold: [79, 90],
} as const;

export const progress = (frame: number, range: readonly [number, number]) =>
  interpolate(frame, [...range], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.22, 1, 0.36, 1),
  });

export const blockState = (
  frame: number,
  fps: number,
  range: readonly [number, number],
) => ({
  opacity: progress(frame, range),
  scale:
    frame >= range[1]
      ? 1
      : interpolate(
          spring({
            frame: Math.max(0, frame - range[0]),
            fps,
            durationInFrames: range[1] - range[0],
            config: {
              damping: 24,
              stiffness: 160,
              mass: 0.7,
              overshootClamping: true,
            },
          }),
          [0, 1],
          [0.85, 1],
        ),
});

export const slideProgress = (frame: number) =>
  interpolate(frame, [...timeline.slideAndColor], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.65, 0, 0.35, 1),
  });
