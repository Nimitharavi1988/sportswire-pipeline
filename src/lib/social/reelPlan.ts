// Which reel version each destination gets (2026-11-07, set by the owner):
//  - A story with no photo of its own (only our branded card) gets the graphic reel on every destination: drawn sport art behind the
//    animated hook, instead of the card dropped in as a photo.
//  - A story with a photo keeps the photo reel, and its hook is animated (words build one by one) on Instagram, on the topic ("sub")
//    Pages and on YouTube. The main Facebook Page keeps the classic photo reel.
// Instagram and Facebook share one render per version, so a call renders at most one motion version and one classic version.

export interface ReelPlanInput {
  noPhoto: boolean;
  isTopicPage: boolean;
  needInstagram: boolean;
  needFacebook: boolean;
  needYouTube: boolean;
  // Switches (GRAPHIC_REELS=off / MOTION_HOOK=off): the graphic reel and the motion hook on photo reels, each on by default.
  graphicsOn?: boolean;
  motionOn?: boolean;
}

export interface ReelPlan {
  graphic: boolean;
  instagramMotion: boolean;
  facebookMotion: boolean;
  youtubeMotion: boolean;
  renderMotion: boolean;
  renderClassic: boolean;
}

export function planReels(i: ReelPlanInput): ReelPlan {
  const graphic = i.noPhoto && (i.graphicsOn ?? true);
  const motionOn = i.motionOn ?? true;
  const instagramMotion = graphic || motionOn;
  const facebookMotion = graphic || (motionOn && i.isTopicPage);
  const youtubeMotion = graphic || motionOn;
  return {
    graphic,
    instagramMotion,
    facebookMotion,
    youtubeMotion,
    renderMotion: (i.needInstagram && instagramMotion) || (i.needFacebook && facebookMotion),
    renderClassic: (i.needInstagram && !instagramMotion) || (i.needFacebook && !facebookMotion),
  };
}

// Reads the two switches from the environment: anything but "off" leaves them on.
export function reelSwitches(env: Record<string, string | undefined>): { graphicsOn: boolean; motionOn: boolean } {
  return { graphicsOn: env.GRAPHIC_REELS?.toLowerCase() !== "off", motionOn: env.MOTION_HOOK?.toLowerCase() !== "off" };
}
