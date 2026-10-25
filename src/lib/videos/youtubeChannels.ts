/**
 * Official YouTube channels whose videos we show. Channel ids were read from
 * each channel's own page and checked against its RSS feed title on
 * 2026-09-25 — never guessed: @F1 and @BCCI resolve to impostor channels
 * ("F1111" with no videos; a Shorts channel last active 2023), so neither is
 * listed. Add a channel only after the same check.
 *
 * `category` is the site's own sport category, used to match highlights to
 * match stories and to filter the Videos section on sport pages.
 */
export interface YouTubeChannel {
  id: string;
  title: string;
  category: string;
  // For a broadcaster covering several sports: only titles matching this
  // are stored, so its football clips don't land under cricket.
  include?: RegExp;
}

// Cricket titles on a multi-sport channel: a fixture tag (#INDvWI), the
// word cricket, or a format.
// League names as plain words (#CPL 2026, WBBL) and sponsor-prefixed hashtags
// (#TATAWPL, #TATAIPL — no word boundary inside those, so the plain \bWPL\b
// missed them: a Star Sports WPL video was filtered out 2026-09-30).
export const CRICKET_TITLE =
  /#[A-Z]{2,3}v[A-Z]{2,3}\b|cricket|\b(ODIs?|T20Is?|T20|IPL|WPL|CPL|BBL|WBBL|PSL|SA20|ILT20|MLC|Test match)\b|#TATA(IPL|WPL)\b/i;

export const YOUTUBE_CHANNELS: YouTubeChannel[] = [
  { id: "UCDVYQ4Zhbm3S2dlz7P1GBDg", title: "NFL", category: "american-football" },
  { id: "UCWJ2lWNubArHWmf3FIHbfcQ", title: "NBA", category: "basketball" },
  { id: "UCoLrcjPV5PbUrUyXq5mjc_A", title: "MLB", category: "baseball" },
  { id: "UCqFMzb-4AUf6WAIbl132QKA", title: "NHL", category: "hockey" },
  { id: "UCG5qGWdu8nIRZqJ_GgDwQ-w", title: "Premier League", category: "football" },
  { id: "UCTv-XvfzLX3i4IGWAm4sbmA", title: "LALIGA EA SPORTS", category: "football" },
  { id: "UC6UL29enLNe4mqwTfAyeNuw", title: "Bundesliga", category: "football" },
  { id: "UCBJeMCIeLQos7wacox4hmLQ", title: "Serie A", category: "football" },
  { id: "UCSZbXT5TLLW_i-5W8FZpFsg", title: "Major League Soccer", category: "football" },
  { id: "UCZ7wY7MRDSygp63HIEfdQZA", title: "Sky Sports Football", category: "football" },
  { id: "UCt2JXOLNxqry7B_4rRZME3Q", title: "ICC", category: "cricket" },
  { id: "UCkd4takjjF1EGD1TKIK2QiA", title: "Sky Sports Cricket", category: "cricket" },
  // India's home broadcaster: India's home series (IND v WI, 2026-09) are
  // here, not on ICC. Checked 2026-09-27 (@StarSports page + RSS title
  // "Star Sports", daily uploads, embeddable). It also posts football and
  // other sports, hence the filter.
  { id: "UCmqfX0S3x0I3uwLkPdpX03w", title: "Star Sports", category: "cricket", include: CRICKET_TITLE },
  // Star Sports posts reactions and shows for India's home series, but not the
  // match highlights (those are on JioHotstar), so the Videos page had no
  // India v West Indies highlights at all. The West Indies' own channel has
  // them: "Legends Do Battle | West Indies v India ODI" (1.2M views) and the
  // full match. Channel page read 2026-09-30: "The Official channel of the
  // WINDIES international cricket teams", @WindiesCricket, 4.46M subscribers.
  { id: "UC2MHTOXktfTK26aDKyQs3cQ", title: "Windies Cricket", category: "cricket" },
  // Cricket Australia's video channel: Australia's internationals (the South
  // Africa tour) and the BBL/WBBL. Channel page read 2026-09-30: "The official
  // YouTube channel of cricket.com.au", @cricketcomau, 10.5M subscribers.
  { id: "UCkBY0aHJP9BwjZLDYxAQrKg", title: "cricket.com.au", category: "cricket" },
  // Formula 1. The sport's own channel (@Formula1, UCB_qr75-ydFVKSF9Dmo6izg,
  // 15.2M subscribers — not the @F1 impostor noted above) is NOT listed:
  // checked 2026-09-30, every recent upload — race highlights included —
  // returns "Video unavailable" in an embedded player whatever the referrer,
  // so none could play here. Sky Sports F1 embeds fine (6 of 6 checked): race
  // weekend shows, driver interviews and the F1 Show podcast, not race
  // highlights (Sky doesn't put those on YouTube). Channel page read
  // 2026-09-30: @SkySportsF1, 1.03M subscribers.
  { id: "UC3kxJQ9RfaS5CKeYbbFMi4Q", title: "Sky Sports F1", category: "formula-1" },
  // Rugby. Each channel page was read 2026-09-30 and 8 of 8 recent uploads
  // played in an embedded player on every one. Not listed on purpose: Rugby
  // Australia (@rugbyaustralia: 6 subscribers) is not the real channel; Super
  // Rugby Pacific (off-season, "classic" re-uploads) and All Blacks (mostly
  // archive full games) can be added when they carry current matches.
  // World Rugby: Rugby Championship and Pacific Nations Cup highlights, 2.05M.
  { id: "UCE28rwYoaV7jvU6GVzdu_GQ", title: "World Rugby", category: "rugby" },
  // "The official home of the URC on YouTube" (the SMULE-named URC account is
  // not it): match highlights every round, 259K.
  { id: "UC-S6cXyil4qbIPfb2hrcH4w", title: "United Rugby Championship", category: "rugby" },
  // "The official rugby channel of the Six Nations", 320K.
  { id: "UCL5bAcVfbxSAs-UM5f5ncWg", title: "Six Nations Rugby", category: "rugby" },
  // England Rugby: Red Roses and Championship highlights, 338K.
  { id: "UCmi7CahP3G3YySOAFOfSnkw", title: "England Rugby", category: "rugby" },
  // Athletics. Same checks, 8 of 8 embeddable on each. Not listed: "athletics
  // India" (@AthleticsIndia: 4 subscribers) is not an official channel;
  // European Athletics is mostly age-group championships.
  // World Athletics: championship finals and the Sydney Marathon, 2.52M.
  { id: "UCQk7fWv15ChjMJLCRVmtApw", title: "World Athletics", category: "athletics" },
  // Wanda Diamond League: meeting and final highlights, 1.08M.
  { id: "UC6PZm2HZT3uOL1Z9F203K4g", title: "Wanda Diamond League", category: "athletics" },
];
