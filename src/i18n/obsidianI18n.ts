import { buildDictionary, type Dictionary, type Resources } from "./translate";

/**
 * Build the dictionary from Obsidian's loaded i18next resources: the UI language paired with English.
 * Returns null when the UI is English or the resources are not where expected.
 */
export function loadDictionary(): Dictionary | null {
	try {
		const i18n = window.i18next;
		const lang = i18n?.language;
		const data = i18n?.store?.data;
		if (!lang || !data || lang === "en") return null;
		const current = firstNamespace(data[lang]);
		const en = firstNamespace(data.en);
		if (!current || !en) return null;
		return buildDictionary(current, en);
	} catch (e) {
		console.warn("Keycommander: could not read Obsidian translations", e);
		return null;
	}
}

/** Obsidian keeps everything in one namespace ("default"); fall back to the first one. */
function firstNamespace(bundle: Record<string, Resources> | undefined): Resources | null {
	if (!bundle || typeof bundle !== "object") return null;
	const ns = bundle.default ?? Object.values(bundle)[0];
	return ns && typeof ns === "object" ? ns : null;
}
