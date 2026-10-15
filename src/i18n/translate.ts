// Pure translation logic. Must not import from "obsidian" so it can be unit-tested.

/** A nested i18next resource object. */
export type Resources = { [key: string]: unknown };

interface Template {
	/** Matches a localized string built from the template; groups are the variables, in `vars` order. */
	re: RegExp;
	vars: string[];
	/** Length of the template's literal text; longer means more specific. */
	literal: number;
	/** The English template. */
	en: string;
}

export interface Dictionary {
	/** Localized string -> English strings with the same key. */
	exact: Map<string, Set<string>>;
	templates: Template[];
}

/** Maximum number of search aliases generated per command name. */
const MAX_ALIASES = 16;

const VAR_RE = /\{\{\s*([^,}\s]+)\s*(?:,\s*([^}]*?))?\s*\}\}/g;

function flatten(obj: Resources, prefix: string, out: Map<string, string>): Map<string, string> {
	for (const [k, v] of Object.entries(obj)) {
		if (typeof v === "string") out.set(prefix + k, v);
		else if (v && typeof v === "object") flatten(v as Resources, `${prefix}${k}.`, out);
	}
	return out;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Turn a localized template like "#{{n}} のタブに移動" into a regex capturing each variable. */
function templateRegExp(template: string): { re: RegExp; vars: string[]; literal: number } | null {
	const vars: string[] = [];
	let src = "";
	let pos = 0;
	let literal = 0;
	for (const m of template.matchAll(VAR_RE)) {
		literal += m.index - pos;
		src += escapeRegExp(template.slice(pos, m.index));
		src += "(.+?)";
		vars.push(m[1]);
		pos = m.index + m[0].length;
	}
	if (vars.length === 0) return null;
	literal += template.length - pos;
	src += escapeRegExp(template.slice(pos));
	// a template that is nothing but variables would match anything
	if (template.replace(VAR_RE, "").trim() === "") return null;
	return { re: new RegExp(`^${src}$`), vars, literal };
}

/** Pair every string of the current language with the English string of the same key. */
export function buildDictionary(current: Resources, en: Resources): Dictionary {
	const cur = flatten(current, "", new Map());
	const eng = flatten(en, "", new Map());
	const exact = new Map<string, Set<string>>();
	const templates: Template[] = [];
	for (const [key, local] of cur) {
		const english = eng.get(key);
		if (english === undefined || english === local) continue;
		if (local.includes("{{")) {
			const t = templateRegExp(local);
			if (t) templates.push({ ...t, en: english });
			continue;
		}
		let set = exact.get(local);
		if (!set) exact.set(local, (set = new Set()));
		set.add(english);
	}
	return { exact, templates };
}

/** Fill an English template with values, applying the `lowercase`/`uppercase` formats i18next supports. */
function interpolate(template: string, values: Map<string, string>): string | null {
	let ok = true;
	const out = template.replace(VAR_RE, (_m, name: string, format?: string) => {
		const v = values.get(name);
		if (v === undefined) {
			ok = false;
			return "";
		}
		if (format === "lowercase") return v.toLowerCase();
		if (format === "uppercase") return v.toUpperCase();
		return v;
	});
	return ok ? out : null;
}

/** English translations of one name part (no ": "), or an empty list if unknown. */
export function translatePart(part: string, dict: Dictionary): string[] {
	const exact = dict.exact.get(part);
	if (exact) return [...exact];
	// Only the most specific templates: "見出し {{level}}" also matches "見出し 2 に設定", which
	// "見出し {{level}} に設定" describes better.
	let best = 0;
	const out = new Set<string>();
	for (const t of dict.templates) {
		if (t.literal < best) continue;
		const m = t.re.exec(part);
		if (!m) continue;
		if (t.literal > best) {
			best = t.literal;
			out.clear();
		}
		// variables may themselves be translated words ("赤" in "赤のハイライト")
		const values = new Map<string, string>();
		t.vars.forEach((v, i) => {
			const raw = m[i + 1];
			values.set(v, dict.exact.get(raw)?.values().next().value ?? raw);
		});
		const s = interpolate(t.en, values);
		if (s !== null) out.add(s);
	}
	return [...out];
}

/** One variant of a command name: the text and, per part, whether it is the original or a translation. */
export interface Alias {
	text: string;
	/** True when every part is in the original language. */
	original: boolean;
	/** True when every part is in English (and at least one was translated). */
	english: boolean;
}

/**
 * Searchable variants of a command name ("Prefix: Name"): the original, fully English versions, and mixes of
 * original and English parts. The original always comes first.
 */
export function searchAliases(name: string, dict: Dictionary | null): Alias[] {
	const parts = name.split(": ");
	const options = parts.map((p) => {
		const tr = dict ? translatePart(p, dict).filter((t) => t !== p) : [];
		return [{ text: p, translated: false }, ...tr.map((t) => ({ text: t, translated: true }))];
	});
	let combos: { texts: string[]; translated: boolean[] }[] = [{ texts: [], translated: [] }];
	for (const opts of options) {
		const next: typeof combos = [];
		for (const c of combos) {
			for (const o of opts) {
				if (next.length >= MAX_ALIASES) break;
				next.push({ texts: [...c.texts, o.text], translated: [...c.translated, o.translated] });
			}
		}
		combos = next;
	}
	return combos.map((c) => ({
		text: c.texts.join(": "),
		original: c.translated.every((t) => !t),
		english: c.translated.some((t) => t) && c.translated.every((t, i) => t || options[i].length === 1),
	}));
}

/** The English name to display under the original, or null when there is none. */
export function englishName(aliases: Alias[]): string | null {
	return aliases.find((a) => a.english)?.text ?? null;
}

/**
 * Map match ranges in `alias` onto `target`, part by part (parts are separated by ": "). Ranges in parts whose
 * text differs between the two are dropped.
 */
export function projectMatches(alias: string, matches: [number, number][], target: string): [number, number][] {
	const a = alias.split(": ");
	const t = target.split(": ");
	if (a.length !== t.length) return alias === target ? matches : [];
	const out: [number, number][] = [];
	let aStart = 0;
	let tStart = 0;
	for (let i = 0; i < a.length; i++) {
		const aEnd = aStart + a[i].length;
		if (a[i] === t[i]) {
			for (const [s, e] of matches) {
				const cs = Math.max(s, aStart);
				const ce = Math.min(e, aEnd);
				if (cs < ce) out.push([cs - aStart + tStart, ce - aStart + tStart]);
			}
		}
		aStart = aEnd + 2;
		tStart += t[i].length + 2;
	}
	return out;
}
