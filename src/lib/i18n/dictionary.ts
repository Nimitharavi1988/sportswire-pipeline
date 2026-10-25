import { EN } from "./en";
import { ES } from "./es";

// All language-specific UI strings live in one Dict per language (en.ts is the
// reference). To add a language: copy en.ts, translate it, register it in DICTS
// below and add a LOCALES entry (locales.ts: host, sports, glossary). TypeScript
// then forces every key to be translated. Components never hold Spanish (or any
// other language) text — they take a `locale` and read it from here.

export interface Dict {
  htmlLang: string;
  ogLocale: string;
  /** Intl locale for dates, e.g. "en-US", "es-US". */
  dateLocale: string;
  siteName: string;
  tagline: string;
  metaTitle: string;
  metaDescription: string;
  /** Link to the English edition, shown on non-English sites. */
  otherSiteLabel: string;
  /** How the English site offers this edition: its own name, the 'read in' link, and the one-time suggestion banner (shown in this language). */
  switchTo: { name: string; readIn: string; acceptLang: string; question: string; go: string; dismiss: string };
  nav: {
    home: string;
    searchPlaceholder: string;
    searchButton: string;
    sections: string;
    moreSports: string;
    openMenu: string;
    /** Non-sport pages this edition has (href -> label); others are hidden from its menu until built. */
    pages: Record<string, string>;
    /** Hrefs shown in the main bar, in order; everything else goes under the "more" menu. Empty = all in the main bar. */
    primary: string[];
  };
  /** Sports shown in this edition's navigation, in order (keys = Article.category). */
  sports: { category: string; label: string }[];
  /** Display name per category; a missing key falls back to the English label. */
  categoryLabels: Record<string, string>;
  time: { justNow: string; minutes: (n: number) => string; hours: (n: number) => string; days: (n: number) => string };
  home: {
    topStory: string;
    h1: string;
    h1Sport: (sportLabel: string) => string;
    justIn: string;
    byCategory: string;
    byCompetition: string;
    transfers: string;
    matchResults: string;
    nflScores: string;
    playerNews: string;
    alsoInNews: string;
    alsoInNewsCaption: string;
    moreHeadlines: string;
    editorsPick: string;
    latest: string;
    bySport: string;
    empty: string;
    emptyCategory: string;
    emptyAdmin: string;
    noWorldCup: string;
    noWorldCupHint: string;
  };
  hero: { topStory: string; previous: string; next: string; goTo: (i: number, n: number) => string };
  article: {
    published: string;
    machineTranslated: string;
    readOriginal: string;
    reportIssue: string;
    originalSource: string;
    related: string;
    share: string;
    by: string;
    upNext: string;
    relatedStories: string;
    trending: string;
    watch: string;
  };
  engagement: {
    question: string; hype: string; panic: string; neutral: string; votes: (n: number) => string;
    // Match predictions ("Who will win?"), closed at kickoff, resolved at full time.
    closed: string; correct: string; wrong: string; noWinner: string; result: string;
    // Match rating after full time.
    rateQuestion: string; ratingSummary: (average: string, n: number) => string;
  };
  section: { moreIn: string; empty: string };
  scores: {
    title: string;
    allScores: string;
    sportScores: (sportLabel: string) => string;
    scrollLeft: string;
    scrollRight: string;
    live: string;
    liveCount: (n: number) => string;
    final: string;
    upcoming: string;
    inProgress: string;
    startDelayed: string;
    paused: string;
    breakLabel: string;
    all: string;
    filterBySport: string;
    noGames: string;
    matchCentre: string;
    preview: string;
    matchScore: string;
    filterPlaceholder: string;
    filterAria: string;
    clearFilter: string;
    chooseDay: string;
    today: string;
    yesterday: string;
    tomorrow: string;
    noMatch: (query: string, otherDays: boolean) => string;
    emptyDay: (sportLabel: string | null) => string;
    source: string;
    updated: (ago: string) => string;
    ago: { justNow: string; min: (n: number) => string; h: (n: number) => string; d: (n: number) => string };
    tv: string;
    standingsLink: string;
    metaTitle: string;
    metaDescription: string;
  };
  standings: {
    title: string;
    subtitle: string;
    team: string;
    club: string;
    previous: (what: string) => string;
    next: (what: string) => string;
    loading: string;
    unavailable: string;
    sectionAria: (title: string) => string;
    of: (i: number, n: number) => string;
    switchLabels: Record<string, string>;
    cols: Record<string, string>;
    zones: Record<string, string>;
    leagueTitle: (name: string) => string;
    metaTitle: string;
    metaDescription: string;
  };
  boxScore: {
    heading: string;
    lineScore: string;
    teamStats: string;
    matchEvents: string;
    team: string;
    total: string;
    playerStats: string;
    playerStatsByTeam: string;
    lineups: string;
    lineupsByTeam: string;
    lineup: string;
    bench: string;
    events: { goal: string; yellow: string; red: string; sub: string };
  };
  search: { title: string; results: string; none: string; prompt: string };
  footer: { rights: string; about: string; contact: string; privacy: string; terms: string; englishNote: string; players: string; clubs: string };
  forYou: {
    title: string;
    metaTitle: string;
    metaDescription: string;
    subtitleHas: string;
    subtitleEmpty: string;
    showingOnly: (name: string) => string;
    goToPage: (name: string) => string;
    noneActive: (name: string) => string;
    noneAll: string;
    storiesAria: string;
    showAll: string;
    showOnly: (name: string) => string;
    unfollow: (name: string) => string;
    done: string;
    hide: string;
    followMore: string;
    followTeams: string;
    searchPlaceholder: string;
    searchAria: string;
    results: string;
    popular: string;
    nothingMatches: (q: string) => string;
    stripBefore: string;
    stripBold: string;
    stripAfter: string;
    getStarted: string;
    dismiss: string;
    // One-tap favourites on the strip and at the top of For You (kind is a FollowKind).
    quickTitle: string;
    quickSports: { kind: string; slug: string; label: string }[];
    quickTeams: { kind: string; slug: string; label: string }[];
    quickDone: (label: string) => string;
    seeFeed: string;
    // Label before the follow chips under an article's tags.
    followLabel: string;
  };
  entity: {
    players: string;
    clubs: string;
    playersSubtitle: string;
    clubsSubtitle: string;
    stories: (n: number) => string;
    noStories: (name: string) => string;
    coach: string;
    official: string;
    follow: string;
    following: string;
    followAria: (name: string) => string;
    unfollowAria: (name: string) => string;
    crestAlt: (name: string) => string;
    playerTitle: (name: string, role: string, sport: string) => string;
    playerDescription: (name: string, sport: string) => string;
    clubTitle: (name: string, sport: string) => string;
    clubDescription: (name: string) => string;
  };
  notFound: { title: string; body: string; back: string };
  error: { title: string; body: string; retry: string };
}

const DICTS: Record<string, Dict> = { en: EN, es: ES };

/** The dictionary for a locale code; unknown or missing = English. */
export function getDict(locale?: string | null): Dict {
  return (locale && DICTS[locale]) || EN;
}
