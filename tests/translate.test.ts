import { describe, expect, it } from "vitest";
import { buildDictionary, englishName, projectMatches, searchAliases, translatePart } from "../src/i18n/translate";

const en = {
	plugins: {
		"file-explorer": { name: "Files", "action-new-note": "Create new note" },
		workspace: { "split-right": "Split right" },
	},
	commands: {
		"go-to-nth-tab": "Go to tab #{{n}}",
		"toggle-heading": "Set as heading {{level}}",
		"toggle-highlight-color": "Toggle {{color, lowercase}} highlight",
		"same-in-both": "PDF",
	},
	interface: {
		view: "View",
		heading: "Heading {{level}}",
		display: "Display",
		visible: "Visible",
		"highlight-color": { red: "Red" },
		"only-var": "{{name}}",
	},
	setting: { "only-in-en": "Only English" },
};

const ja = {
	plugins: {
		"file-explorer": { name: "ファイルエクスプローラー", "action-new-note": "新規ノートを作成" },
		workspace: { "split-right": "右に分割" },
	},
	commands: {
		"go-to-nth-tab": "#{{n}} のタブに移動",
		"toggle-heading": "見出し {{level}} に設定",
		"toggle-highlight-color": "{{color, lowercase}}のハイライトを切り替える",
		"same-in-both": "PDF",
	},
	interface: {
		view: "表示",
		heading: "見出し {{level}}",
		display: "表示",
		visible: "表示",
		"highlight-color": { red: "赤" },
		"only-var": "{{name}}",
	},
};

const dict = buildDictionary(ja, en);

describe("translatePart", () => {
	it("translates exact strings", () => {
		expect(translatePart("右に分割", dict)).toEqual(["Split right"]);
		expect(translatePart("知らない", dict)).toEqual([]);
	});

	it("keeps every translation of an ambiguous string", () => {
		expect(translatePart("表示", dict).sort()).toEqual(["Display", "View", "Visible"]);
	});

	it("fills templates", () => {
		expect(translatePart("#3 のタブに移動", dict)).toEqual(["Go to tab #3"]);
		expect(translatePart("見出し 2 に設定", dict)).toEqual(["Set as heading 2"]);
		expect(translatePart("見出し 2", dict)).toEqual(["Heading 2"]);
	});

	it("translates template values and applies formats", () => {
		expect(translatePart("赤のハイライトを切り替える", dict)).toEqual(["Toggle red highlight"]);
		expect(translatePart("ピンクのハイライトを切り替える", dict)).toEqual(["Toggle ピンク highlight"]);
	});

	it("skips identical strings and variable-only templates", () => {
		expect(dict.exact.has("PDF")).toBe(false);
		expect(dict.templates.some((t) => t.en === "{{name}}")).toBe(false);
	});
});

describe("searchAliases", () => {
	it("returns the original first, then English and mixed variants", () => {
		const aliases = searchAliases("ファイルエクスプローラー: 新規ノートを作成", dict);
		expect(aliases.map((a) => a.text)).toEqual([
			"ファイルエクスプローラー: 新規ノートを作成",
			"ファイルエクスプローラー: Create new note",
			"Files: 新規ノートを作成",
			"Files: Create new note",
		]);
		expect(aliases[0].original).toBe(true);
		expect(englishName(aliases)).toBe("Files: Create new note");
	});

	it("treats untranslatable parts as already English", () => {
		const aliases = searchAliases("Keyfiler: 右に分割", dict);
		expect(englishName(aliases)).toBe("Keyfiler: Split right");
	});

	it("has no English name for untranslatable or English names", () => {
		expect(englishName(searchAliases("Keyfiler: Find files", dict))).toBeNull();
		expect(searchAliases("右に分割", null)).toEqual([{ text: "右に分割", original: true, english: false }]);
	});

	it("caps the number of aliases", () => {
		expect(searchAliases("表示: 表示: 表示", dict).length).toBeLessThanOrEqual(16);
	});
});

describe("projectMatches", () => {
	it("maps ranges of shared parts onto the target", () => {
		const alias = "ファイルエクスプローラー: Create new note";
		// "ファイル" in part 0 and "Create" in part 1
		const m: [number, number][] = [[0, 4], [14, 20]];
		expect(projectMatches(alias, m, "ファイルエクスプローラー: 新規ノートを作成")).toEqual([[0, 4]]);
		expect(projectMatches(alias, m, "Files: Create new note")).toEqual([[7, 13]]);
	});

	it("passes ranges through for identical single-part text", () => {
		expect(projectMatches("Split right", [[0, 5]], "Split right")).toEqual([[0, 5]]);
	});
});
