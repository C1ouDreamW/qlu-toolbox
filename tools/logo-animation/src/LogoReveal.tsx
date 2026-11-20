import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { blockState, progress, slideProgress, timeline } from "./animation";
import { shapes, type ShapeName } from "./logoGeometry";

const Shape = ({ name }: { name: ShapeName }) => (
  <path d={shapes[name].path} fill={`url(#${name})`} />
);

const Block = ({ name }: { name: "topRight" | "topLeft" | "bottomLeft" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { opacity, scale } = blockState(frame, fps, timeline[name]);
  const [cx, cy] = shapes[name].center;
  return (
    <g
      opacity={opacity}
      style={{
        scale,
        transformOrigin: `${cx}px ${cy}px`,
        transformBox: "view-box",
      }}
    >
      <Shape name={name} />
    </g>
  );
};

export const TopRightBlock = () => <Block name="topRight" />;
export const TopLeftBlock = () => <Block name="topLeft" />;
export const BottomLeftBlock = () => <Block name="bottomLeft" />;

export const BottomRightBlock = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { opacity, scale } = blockState(frame, fps, timeline.bottomRight);
  const [x, y, width, height] = shapes.bottomRight.bounds;
  const [startX, , startWidth] = shapes.topRight.bounds;
  const [, startY, , startHeight] = shapes.bottomLeft.bounds;
  const shrink = progress(frame, timeline.shrink);
  return (
    <g
      style={{
        translate: `${interpolate(slideProgress(frame), [0, 1], [startX - x, 0])}px ${interpolate(shrink, [0, 1], [startY - y, 0])}px`,
      }}
    >
      <g
        opacity={opacity}
        style={{
          // Initial tile shares the right column and bottom row of the other blocks.
          scale: `${scale * interpolate(shrink, [0, 1], [startWidth / width, 1])} ${scale * interpolate(shrink, [0, 1], [startHeight / height, 1])}`,
          transformOrigin: `${x}px ${y}px`,
          transformBox: "view-box",
        }}
      >
        <path d={shapes.bottomRight.path} fill="url(#topLeft)" />
        <g mask="url(#yellowReveal)">
          <Shape name="bottomRight" />
        </g>
      </g>
    </g>
  );
};

const Line = ({ name }: { name: "lineTop" | "lineMiddle" | "lineBottom" }) => {
  const frame = useCurrentFrame();
  return (
    <g
      opacity={progress(frame, timeline[name])}
      style={{
        translate: `${interpolate(progress(frame, timeline[name]), [0, 1], [-10, 0])}px 0`,
      }}
    >
      <Shape name={name} />
    </g>
  );
};

export const CenterLines = () => (
  <>
    <Line name="lineTop" />
    <Line name="lineMiddle" />
    <Line name="lineBottom" />
  </>
);

export const BottomBar = () => {
  const frame = useCurrentFrame();
  return (
    <g opacity={progress(frame, timeline.bottomBar)} clipPath="url(#barReveal)">
      <Shape name="bottomBar" />
    </g>
  );
};

export type LogoRevealProps = { background: "transparent" | "white" };

export const LogoReveal = ({ background }: LogoRevealProps) => {
  const frame = useCurrentFrame();
  const originalOpacity = progress(frame, timeline.originalPng);
  const [yellowX, , yellowWidth] = shapes.bottomRight.bounds;
  const wipeEdge = interpolate(
    slideProgress(frame),
    [0, 1],
    [yellowX - 16, yellowX + yellowWidth + 16],
  );
  return (
    <AbsoluteFill
      style={{ backgroundColor: background === "white" ? "#fff" : undefined }}
    >
      <AbsoluteFill style={{ isolation: "isolate" }}>
        {originalOpacity < 1 && (
          <svg
            width="1080"
            height="1080"
            viewBox="0 0 512 512"
            aria-label="LumaTile Logo"
            style={{ opacity: 1 - originalOpacity }}
          >
            <defs>
              {(Object.keys(shapes) as ShapeName[]).map((name) => (
                <linearGradient
                  id={name}
                  key={name}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  {shapes[name].colors.map((color, i) => (
                    <stop key={i} offset={`${i * 50}%`} stopColor={color} />
                  ))}
                </linearGradient>
              ))}
              <linearGradient
                id="yellowWipe"
                gradientUnits="userSpaceOnUse"
                x1={wipeEdge - 8}
                x2={wipeEdge + 8}
                y1="0"
                y2="0"
              >
                <stop offset="0%" stopColor="white" />
                <stop offset="100%" stopColor="black" />
              </linearGradient>
              <mask
                id="yellowReveal"
                maskUnits="userSpaceOnUse"
                x="0"
                y="0"
                width="512"
                height="512"
              >
                <rect width="512" height="512" fill="url(#yellowWipe)" />
              </mask>
              <clipPath id="barReveal" clipPathUnits="userSpaceOnUse">
                <rect
                  x="205"
                  y="401"
                  width={172 * progress(frame, timeline.bottomBar)}
                  height="44"
                />
              </clipPath>
            </defs>
            <TopRightBlock />
            <TopLeftBlock />
            <BottomLeftBlock />
            <BottomRightBlock />
            <CenterLines />
            <BottomBar />
          </svg>
        )}
        {originalOpacity > 0 && (
          <Img
            src={staticFile("lumatile.png")}
            alt="LumaTile 原始 Logo"
            style={{
              position: "absolute",
              width: 1080,
              height: 1080,
              opacity: originalOpacity,
              mixBlendMode: "plus-lighter",
            }}
          />
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
