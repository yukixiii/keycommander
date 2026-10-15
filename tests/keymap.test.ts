import { describe, expect, it } from "vitest";
import {
	DEFAULT_KEYMAP,
	compileKeymap,
	eventToString,
	findConflicts,
	mergeKeymap,
	parseSequence,
	resolve,
	splitNotations,
	type Keymap,
} from "../src/ui/keymap";

const ev = (key: string, mods: Partial<{ ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }> = {}, code?: string) => ({
	key,
	code,
	ctrlKey: !!mods.ctrl,
	altKey: !!mods.alt,
	shiftKey: !!mods.shift,
	metaKey: !!mods.meta,
});

describe("notation", () => {
	it("parses plain, special and modified keys", () => {
		expect(parseSequence("j")).toEqual(["j"]);
		expect(parseSequence("gg")).toEqual(["g", "g"]);
		expect(parseSequence("G")).toEqual(["G"]);
		expect(parseSequence("<C-n>")).toEqual(["<C-n>"]);
		expect(parseSequence("<c-N>")).toEqual(["<C-n>"]);
		expect(parseSequence("<M-c>")).toEqual(["<A-c>"]);
		expect(parseSequence("<S-Tab>")).toEqual(["<S-Tab>"]);
		expect(parseSequence("<Enter>")).toEqual(["<CR>"]);
		expect(parseSequence("<space>")).toEqual(["<Space>"]);
		expect(parseSequence("<lt>")).toEqual(["<lt>"]);
		expect(parseSequence("<comma>")).toEqual(["<comma>"]);
		expect(parseSequence("<C-S-v>")).toEqual(["<C-S-v>"]);
	});

	it("rejects invalid notation", () => {
		expect(parseSequence("")).toBeNull();
		expect(parseSequence("<C-n")).toBeNull();
		expect(parseSequence("<Foo>")).toBeNull();
		expect(parseSequence("a b")).toBeNull();
	});

	it("normalizes keyboard events to the same canonical form", () => {
		expect(eventToString(ev("j"))).toBe("j");
		expect(eventToString(ev("G", { shift: true }))).toBe("G");
		expect(eventToString(ev("n", { ctrl: true }, "KeyN"))).toBe("<C-n>");
		expect(eventToString(ev("V", { ctrl: true, shift: true }, "KeyV"))).toBe("<C-S-v>");
		expect(eventToString(ev("ç", { alt: true }, "KeyC"))).toBe("<A-c>");
		expect(eventToString(ev("Tab", { shift: true }))).toBe("<S-Tab>");
		expect(eventToString(ev("Escape"))).toBe("<Esc>");
		expect(eventToString(ev(" "))).toBe("<Space>");
		expect(eventToString(ev(","))).toBe("<comma>");
		expect(eventToString(ev("<", { shift: true }))).toBe("<lt>");
		expect(eventToString(ev("あ"))).toBe("あ");
		expect(eventToString(ev("Control", { ctrl: true }))).toBeNull();
		expect(eventToString(ev("Process"))).toBeNull();
		expect(eventToString(ev("F5"))).toBeNull();
	});

	it("round-trips event strings through the parser", () => {
		for (const s of ["j", "G", "<C-n>", "<C-S-v>", "<A-c>", "<S-Tab>", "<Esc>", "<Space>", "<comma>", "<lt>"]) {
			expect(parseSequence(s)).toEqual([s]);
		}
	});

	it("splits settings text", () => {
		expect(splitNotations("<C-n>, <Down> ,j,,")).toEqual(["<C-n>", "<Down>", "j"]);
		expect(splitNotations("  ")).toEqual([]);
	});
});

describe("resolve", () => {
	const km = compileKeymap(DEFAULT_KEYMAP);

	it("resolves per mode", () => {
		expect(resolve(km, "normal", [], "j").action).toBe("moveDown");
		expect(resolve(km, "insert", [], "j")).toEqual({ action: null, pending: [], consumed: false });
		expect(resolve(km, "insert", [], "<C-n>").action).toBe("moveDown");
		expect(resolve(km, "insert", [], "<CR>").action).toBe("run");
		expect(resolve(km, "insert", [], "<Esc>").action).toBe("toNormal");
		expect(resolve(km, "normal", [], "<Esc>").action).toBe("close");
	});

	it("handles gg sequences", () => {
		const r1 = resolve(km, "normal", [], "g");
		expect(r1).toEqual({ action: null, pending: ["g"], consumed: true });
		expect(resolve(km, "normal", r1.pending, "g").action).toBe("first");
		// broken sequence falls back to the new stroke alone
		expect(resolve(km, "normal", ["g"], "j")).toEqual({ action: "moveDown", pending: [], consumed: true });
	});

	it("uses user overrides", () => {
		const c = compileKeymap(mergeKeymap({ moveDown: { insert: ["<C-e>"], normal: ["j"] }, run: { normal: ["o"] } }));
		expect(resolve(c, "insert", [], "<C-e>").action).toBe("moveDown");
		expect(resolve(c, "insert", [], "<C-n>").action).toBeNull();
		expect(resolve(c, "normal", [], "o").action).toBe("run");
		expect(resolve(c, "normal", [], "l").action).toBeNull();
	});
});

describe("conflicts and merge", () => {
	it("default keymap has no conflicts", () => {
		expect(findConflicts(DEFAULT_KEYMAP)).toEqual([]);
	});

	it("detects duplicates and prefix conflicts", () => {
		const km = mergeKeymap({ run: { insert: ["<CR>"], normal: ["j"] }, close: { insert: ["<C-c>"], normal: ["g"] } });
		const c = findConflicts(km);
		expect(c).toContainEqual({ mode: "normal", kind: "duplicate", keys: "j", actions: ["moveDown", "run"] });
		expect(c).toContainEqual({ mode: "normal", kind: "prefix", keys: "g / gg", actions: ["close", "first"] });
	});

	it("merges partial / invalid saved data with defaults", () => {
		const km = mergeKeymap({ moveDown: { insert: ["<C-e>"] }, run: "bogus", unknownAction: { insert: ["x"] } });
		expect(km.moveDown).toEqual({ insert: ["<C-e>"], normal: DEFAULT_KEYMAP.moveDown.normal });
		expect(km.run).toEqual(DEFAULT_KEYMAP.run);
		expect("unknownAction" in km).toBe(false);
		expect(mergeKeymap(undefined)).toEqual(DEFAULT_KEYMAP);
	});
});
