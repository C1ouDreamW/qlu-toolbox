import { Composition } from "remotion";
import { LogoReveal } from "./LogoReveal";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="LogoReveal"
        component={LogoReveal}
        durationInFrames={90}
        fps={30}
        width={1080}
        height={1080}
        defaultProps={{ background: "transparent" }}
      />
      <Composition
        id="LogoRevealWhite"
        component={LogoReveal}
        durationInFrames={90}
        fps={30}
        width={1080}
        height={1080}
        defaultProps={{ background: "white" }}
      />
    </>
  );
};
