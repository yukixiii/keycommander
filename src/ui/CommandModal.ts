import { Modal, Scope, prepareFuzzySearch, type Command } from "obsidian";
import { projectMatches, type Alias } from "../i18n/translate";
import type KeycommanderPlugin from "../main";
import { renderHighlighted } from "./highlight";
import { compileKeymap, eventToString, resolve, type ActionId, type CompiledKeymap, type Mode } from "./keymap";

interface Item {
	cmd: Command;
	aliases: Alias[];
	/** English name shown under the original, if different. */
	english: string | null;
	hotkey: string;
}

interface Result {
	item: Item;
	/** Matched ranges in the original name and in the English name. */
	nameMatches: [number, number][];
	englishMatches: [number, number][];
}

/** Keyboard-driven command palette with vim-like Insert/Normal modes. */
export class CommandModal extends Modal {
	private mode: Mode;
	private items: Item[] = [];
	private results: Result[] = [];
	private cursor = 0;

	private inputEl!: HTMLInputElement;
	private modeEl!: HTMLElement;
	private listEl!: HTMLElement;
	private statusEl!: HTMLElement;

	private compiled: CompiledKeymap = { insert: [], normal: [] };
	private pending: string[] = [];

	constructor(private plugin: KeycommanderPlugin) {
		super(plugin.app);
		this.mode = plugin.settings.startMode;
		// Replace the default scope (whose Escape closes the modal) with one that routes every key
		// through our keymap. Handling all keys here also keeps global hotkeys (Ctrl+P, ...) from firing.
		this.scope = new Scope(this.app.scope);
		this.scope.register(null, null, (evt) => this.handleKey(evt));
	}

	// ---- lifecycle --------------------------------------------------------------

	onOpen(): void {
		this.compiled = compileKeymap(this.plugin.settings.keymap);
		this.modalEl.addClass("keycommander-modal");
		this.titleEl.remove();
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("keycommander-root");

		const promptEl = contentEl.createDiv({ cls: "keycommander-prompt" });
		this.modeEl = promptEl.createSpan({ cls: "keycommander-mode" });
		this.inputEl = promptEl.createEl("input", {
			cls: "keycommander-input",
			attr: { type: "text", spellcheck: "false", autocomplete: "off", placeholder: "Command…" },
		});
		this.inputEl.addEventListener("input", () => this.updateResults());

		this.listEl = contentEl.createDiv({ cls: "keycommander-list" });
		this.statusEl = contentEl.createDiv({ cls: "keycommander-status" });

		this.items = this.loadItems();
		this.updateResults();
		this.setMode(this.mode);
		this.inputEl.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	// ---- items and filtering ---------------------------------------------------------

	private loadItems(): Item[] {
		const hotkeys = this.app.hotkeyManager;
		return this.app.commands.listCommands().map((cmd) => {
			const { aliases, english } = this.plugin.aliasesFor(cmd.name);
			let hotkey = "";
			try {
				hotkey = hotkeys?.printHotkeyForCommand(cmd.id) ?? "";
			} catch {
				// private API; just show no hotkey
			}
			return { cmd, aliases, english, hotkey };
		});
	}

	private updateResults(): void {
		const q = this.inputEl.value.trim();
		const recent = this.plugin.settings.recentCommands;
		const rank = (id: string) => {
			const i = recent.indexOf(id);
			return i < 0 ? Infinity : i;
		};
		if (!q) {
			const pinned = this.plugin.pinnedCommands();
			const pinRank = (id: string) => {
				const i = pinned.indexOf(id);
				return i < 0 ? Infinity : i;
			};
			const sorted = [...this.items].sort(
				(a, b) =>
					pinRank(a.cmd.id) - pinRank(b.cmd.id) ||
					rank(a.cmd.id) - rank(b.cmd.id) ||
					a.cmd.name.localeCompare(b.cmd.name),
			);
			this.results = sorted.map((item) => ({ item, nameMatches: [], englishMatches: [] }));
		} else {
			const fuzzy = prepareFuzzySearch(q);
			const scored: (Result & { score: number })[] = [];
			for (const item of this.items) {
				let best: { alias: Alias; score: number; matches: [number, number][] } | null = null;
				for (const alias of item.aliases) {
					const m = fuzzy(alias.text);
					if (m && (!best || m.score > best.score)) best = { alias, score: m.score, matches: m.matches as [number, number][] };
				}
				if (!best) continue;
				const { alias, matches } = best;
				scored.push({
					item,
					score: best.score,
					nameMatches: projectMatches(alias.text, matches, item.cmd.name),
					englishMatches: item.english ? projectMatches(alias.text, matches, item.english) : [],
				});
			}
			scored.sort((a, b) => b.score - a.score || rank(a.item.cmd.id) - rank(b.item.cmd.id));
			this.results = scored;
		}
		this.cursor = 0;
		this.renderList();
	}

	// ---- rendering ------------------------------------------------------------------

	private setMode(mode: Mode): void {
		this.mode = mode;
		this.pending = [];
		this.modalEl.toggleClass("keycommander-mode-normal", mode === "normal");
		this.modalEl.toggleClass("keycommander-mode-insert", mode === "insert");
		if (mode === "normal" && this.plugin.settings.imeOffOnNormal) this.plugin.imeOff();
		this.modeEl.setText(mode === "insert" ? "I" : "N");
		this.modeEl.className = `keycommander-mode keycommander-mode-${mode}`;
		this.renderStatus();
	}

	private renderList(): void {
		this.listEl.empty();
		const shown = this.results.slice(0, this.plugin.settings.maxResults);
		if (shown.length === 0) {
			this.listEl.createDiv({ cls: "keycommander-empty", text: "No matching commands" });
		}
		const showEnglish = this.plugin.settings.showEnglish;
		shown.forEach((result, i) => {
			const { item } = result;
			const row = this.listEl.createDiv({ cls: "keycommander-row" });
			const text = row.createDiv({ cls: "keycommander-text" });
			renderHighlighted(text.createDiv({ cls: "keycommander-name" }), item.cmd.name, result.nameMatches);
			if (showEnglish && item.english) {
				renderHighlighted(text.createDiv({ cls: "keycommander-english" }), item.english, result.englishMatches);
			}
			if (item.hotkey) row.createSpan({ cls: "keycommander-hotkey", text: item.hotkey });
			row.addEventListener("mousedown", (e) => e.preventDefault()); // keep input focus
			row.addEventListener("click", () => {
				this.cursor = i;
				this.run();
			});
		});
		this.updateSelection();
	}

	private updateSelection(): void {
		const rows = this.listEl.querySelectorAll<HTMLElement>(".keycommander-row");
		rows.forEach((row, i) => row.toggleClass("is-selected", i === this.cursor));
		rows[this.cursor]?.scrollIntoView({ block: "nearest" });
		this.renderStatus();
	}

	private renderStatus(): void {
		if (!this.statusEl) return;
		this.statusEl.empty();
		const total = this.results.length;
		const count = this.statusEl.createSpan({ cls: "keycommander-count" });
		count.setText(total > 0 ? `${this.cursor + 1}/${total}` : "0/0");
		if (total > this.plugin.settings.maxResults) count.appendText(` (showing ${this.plugin.settings.maxResults})`);
		const parts: string[] = [];
		for (const a of HINT_ACTIONS) {
			const key = this.compiled[this.mode].find((b) => b.action === a)?.seq.join("");
			if (key) parts.push(`${key} ${HINT_NAMES[a]}`);
		}
		this.statusEl.createSpan({ cls: "keycommander-hints", text: parts.join(" · ") });
	}

	// ---- key handling ---------------------------------------------------------------

	private handleKey(evt: KeyboardEvent): boolean {
		// Never interpret keys while an IME is composing (e.g. Japanese input confirming with Enter).
		if (evt.isComposing || evt.keyCode === 229) return true;
		// Only handle keys aimed at this modal (not at e.g. a notice or another window).
		if (!this.modalEl.isConnected) return true;

		const stroke = eventToString(evt);
		if (!stroke) return true;
		const r = resolve(this.compiled, this.mode, this.pending, stroke);
		this.pending = r.pending;
		if (r.action) {
			this.execute(r.action);
			return false;
		}
		if (r.consumed) return false; // prefix of a sequence
		// Unbound key: in Normal mode swallow printable keys so they don't edit the query.
		if (this.mode === "normal" && !evt.ctrlKey && !evt.metaKey && !evt.altKey) {
			if (evt.key.length === 1 || evt.key === "Backspace" || evt.key === "Delete" || evt.key === "Enter") return false;
		}
		return true; // let the input handle it; returning true also keeps parent (global) hotkeys from running
	}

	private execute(action: ActionId): void {
		switch (action) {
			case "moveDown":
				return this.setCursor(this.cursor + 1);
			case "moveUp":
				return this.setCursor(this.cursor - 1);
			case "halfPageDown":
				return this.setCursor(this.cursor + this.halfPage());
			case "halfPageUp":
				return this.setCursor(this.cursor - this.halfPage());
			case "first":
				return this.setCursor(0);
			case "last":
				return this.setCursor(this.visibleCount() - 1);
			case "run":
				return this.run();
			case "toNormal":
				return this.setMode("normal");
			case "toInsert":
				return this.setMode("insert");
			case "close":
				return this.close();
		}
	}

	private visibleCount(): number {
		return Math.min(this.results.length, this.plugin.settings.maxResults);
	}

	private halfPage(): number {
		const row = this.listEl.querySelector<HTMLElement>(".keycommander-row");
		const h = row?.offsetHeight || 28;
		return Math.max(1, Math.floor(this.listEl.clientHeight / h / 2));
	}

	private setCursor(i: number): void {
		const n = this.visibleCount();
		if (n === 0) return;
		this.cursor = Math.max(0, Math.min(n - 1, i));
		this.updateSelection();
	}

	/** Close, then run the selected command once focus is back where it was (editor commands need it). */
	private run(): void {
		const cmd = this.results[this.cursor]?.item.cmd;
		if (!cmd) return;
		this.close();
		void this.plugin.recordRecent(cmd.id);
		window.setTimeout(() => this.app.commands.executeCommandById(cmd.id), 0);
	}
}

const HINT_ACTIONS: ActionId[] = ["run", "toNormal", "toInsert", "close"];

const HINT_NAMES: Record<ActionId, string> = {
	moveDown: "down",
	moveUp: "up",
	halfPageDown: "half page down",
	halfPageUp: "half page up",
	first: "first",
	last: "last",
	run: "run",
	toNormal: "normal",
	toInsert: "insert",
	close: "close",
};
