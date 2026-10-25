/**
 * Accuracy check for a reel hook against its article (pure, unit-tested). A hook is the most-read line, and the prompt's
 * own rules were not enough: a recap of a 17-14 overtime loss came back as "historic upset" although the article never
 * says upset. A hook fails if it contains
 *  - a number that is not in the article,
 *  - a hype word (upset, shock, stun, furious...) that the article does not itself use,
 *  - a quotation that is not word for word in the article,
 *  - a capitalised name that appears nowhere in the headline or text.
 */

const HYPE = ["upset", "shock", "stun", "stunning", "furious", "outrage", "outraged", "destroy", "destroyed", "humiliat", "meltdown", "disaster", "crisis", "nightmare", "epic", "insane", "unbelievable", "incredible", "massive", "bombshell", "explosive", "brutal", "savage", "embarrass", "collapse", "chaos"];

const norm = (s: string) => s.toLowerCase().replace(/[’‘']/g, "'").replace(/[^\p{L}\p{N}'\s-]/gu, " ").replace(/\s+/g, " ").trim();

export interface HookCheck { ok: boolean; problems: string[] }

export function checkHook(hook: string, title: string, body: string): HookCheck {
  const problems: string[] = [];
  const source = norm(`${title} ${body}`);
  // The article may write a number as a word ("five sacks"), so number words count as their digits too.
  const WORD_NUMBERS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };
  const sourceDigits = (`${title} ${body}`).replace(/(\d),(\d)/g, "$1$2")
    .replace(new RegExp(`\\b(${Object.keys(WORD_NUMBERS).join("|")})\\b`, "gi"), (w) => ` ${WORD_NUMBERS[w.toLowerCase()]} `);

  // Numbers: every number in the hook (a 19-second knockout: 19) must be in the article.
  for (const n of hook.replace(/(\d),(\d)/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? []) {
    if (!new RegExp(`(^|[^\\d.])${n.replace(".", "\\.")}([^\\d]|$)`).test(sourceDigits)) problems.push(`number ${n} is not in the article`);
  }

  // Hype words only if the article uses them itself.
  const hookNorm = norm(hook);
  for (const w of HYPE) {
    if (new RegExp(`(^|[^\\p{L}])${w}`, "u").test(hookNorm) && !new RegExp(`(^|[^\\p{L}])${w}`, "u").test(source)) problems.push(`"${w}" is not in the article`);
  }

  // Quotations must appear word for word.
  for (const m of hook.matchAll(/["“]([^"”]{4,})["”]/g)) {
    if (!source.includes(norm(m[1]))) problems.push(`quote "${m[1].slice(0, 40)}" is not word for word in the article`);
  }

  // Capitalised names (not the first word) must be somewhere in the headline or text.
  const tokens = hook.split(/\s+/);
  tokens.forEach((t, i) => {
    const core = t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").replace(/['’]s$/i, "");
    // A capital after a full stop or colon starts a new fragment ("168 yards. One win."), it is not a name.
    if (i === 0 || core.length < 3 || !/^\p{Lu}\p{Ll}/u.test(core) || /[.!?:]$/.test(tokens[i - 1])) return;
    if (!source.includes(norm(core))) problems.push(`name "${core}" is not in the article`);
  });

  return { ok: problems.length === 0, problems };
}

// A plain fallback hook when no styled hook passes: the headline cut to at most 10 words.
export function safeHookFromTitle(title: string): string {
  const words = title.replace(/\s+/g, " ").trim().split(" ");
  return words.length <= 10 ? words.join(" ") : words.slice(0, 10).join(" ").replace(/[,:;–—-]+$/, "");
}
