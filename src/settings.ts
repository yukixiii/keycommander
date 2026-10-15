import { App, PluginSettingTab, Setting, TextComponent } from "obsidian";
import { defaultImeOffCommand } from "./ime";
import type KeycommanderPlugin from "./main";
import {
	ACTIONS,
	ACTION_IDS,
	DEFAULT_KEYMAP,
	eventToString,
	findConflicts,
	mergeKeymap,
	parseSequence,
	splitNotations,
	type ActionId,
	type Keymap,
	type Mode,
} from "./ui/keymap";

export interface KeycommanderSettings {
	startMode: Mode;
	maxResults: number;
	showEnglish: boolean;
	replaceCorePalette: boolean;
	recentLimit: number;
	imeOffOnNormal: boolean;
	imeOffCommand: string;
	keymap: Keymap;
	/** Most recently run command ids, newest first. */
	recentCommands: string[];
}

export const DEFAULT_SETTINGS: KeycommanderSettings = {
	startMode: "insert",
	maxResults: 200,
	showEnglish: true,
	replaceCorePalette: true,
	recentLimit: 50,
	imeOffOnNormal: true,
	imeOffCommand: defaultImeOffCommand(),
	keymap: DEFAULT_KEYMAP,
	recentCommands: [],
};

const positive = (v: unknown, def: number) => (typeof v === "number" && v >= 0 ? Math.floor(v) : def);
const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);

export function loadSettings(data: unknown): KeycommanderSettings {
	const d = (data && typeof data === "object" ? data : {}) as Partial<KeycommanderSettings>;
	return {
		startMode: d.startMode === "normal" ? "normal" : "insert",
		maxResults: positive(d.maxResults, DEFAULT_SETTINGS.maxResults) || DEFAULT_SETTINGS.maxResults,
		showEnglish: bool(d.showEnglish, DEFAULT_SETTINGS.showEnglish),
		replaceCorePalette: bool(d.replaceCorePalette, DEFAULT_SETTINGS.replaceCorePalette),
		recentLimit: positive(d.recentLimit, DEFAULT_SETTINGS.recentLimit),
		imeOffOnNormal: bool(d.imeOffOnNormal, DEFAULT_SETTINGS.imeOffOnNormal),
		imeOffCommand: typeof d.imeOffCommand === "string" ? d.imeOffCommand : DEFAULT_SETTINGS.imeOffCommand,
		keymap: mergeKeymap(d.keymap),
		recentCommands: Array.isArray(d.recentCommands) ? d.recentCommands.filter((x) => typeof x === "string") : [],
	};
}

export class KeycommanderSettingTab extends PluginSettingTab {
	private conflictsEl: HTMLElement | null = null;
	private stopRecording: (() => void) | null = null;

	constructor(
		app: App,
		private plugin: KeycommanderPlugin,
	) {
		super(app, plugin);
	}

	hide(): void {
		this.stopRecording?.();
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		this.stopRecording?.();
		containerEl.empty();

		new Setting(containerEl)
			.setName("Replace core command palette")
			.setDesc("Open Keycommander whenever the core \"Command palette: Open command palette\" command runs (Ctrl+P, other plugins, vimrc). Turn off to get the core palette back.")
			.addToggle((t) =>
				t.setValue(s.replaceCorePalette).onChange(async (v) => {
					s.replaceCorePalette = v;
					await this.plugin.saveSettings();
					this.plugin.applyReplacement();
				}),
			);

		new Setting(containerEl)
			.setName("Start mode")
			.setDesc("Mode the palette starts in.")
			.addDropdown((d) =>
				d
					.addOptions({ insert: "Insert", normal: "Normal" })
					.setValue(s.startMode)
					.onChange(async (v) => {
						s.startMode = v as Mode;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Show English names")
			.setDesc("Show each command's English name under its localized name. English names are searchable either way.")
			.addToggle((t) =>
				t.setValue(s.showEnglish).onChange(async (v) => {
					s.showEnglish = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Max results")
			.setDesc("Maximum number of commands rendered in the list.")
			.addText((t) =>
				t.setValue(String(s.maxResults)).onChange(async (v) => {
					const n = Number.parseInt(v, 10);
					if (Number.isFinite(n) && n > 0) {
						s.maxResults = n;
						await this.plugin.saveSettings();
					}
				}),
			);

		new Setting(containerEl)
			.setName("Recent commands to remember")
			.setDesc("Recently run commands are listed first. 0 disables the history.")
			.addText((t) =>
				t.setValue(String(s.recentLimit)).onChange(async (v) => {
					const n = Number.parseInt(v, 10);
					if (Number.isFinite(n) && n >= 0) {
						s.recentLimit = n;
						s.recentCommands = s.recentCommands.slice(0, n);
						await this.plugin.saveSettings();
					}
				}),
			);

		this.displayIme(containerEl);
		this.displayKeymap(containerEl);
	}

	private displayIme(containerEl: HTMLElement): void {
		const s = this.plugin.settings;
		new Setting(containerEl).setName("IME").setHeading();

		new Setting(containerEl)
			.setName("Turn IME off in Normal mode")
			.setDesc("Switch the IME off when the palette enters Normal mode (e.g. Esc after typing Japanese), like vim's im-select.")
			.addToggle((t) =>
				t.setValue(s.imeOffOnNormal).onChange(async (v) => {
					s.imeOffOnNormal = v;
					await this.plugin.saveSettings();
				}),
			);

		const desc = createFragment((f) => {
			f.appendText("Shell command that switches the IME off. Examples: ");
			f.createEl("code", { text: "fcitx5-remote -c" });
			f.appendText(" (fcitx5), ");
			f.createEl("code", { text: "ibus engine xkb:us::eng" });
			f.appendText(" (IBus), ");
			f.createEl("code", { text: "im-select com.apple.keylayout.ABC" });
			f.appendText(" (macOS). Leave empty to disable. Desktop only.");
		});
		new Setting(containerEl)
			.setName("IME off command")
			.setDesc(desc)
			.addText((t) =>
				t
					.setPlaceholder("fcitx5-remote -c")
					.setValue(s.imeOffCommand)
					.onChange(async (v) => {
						s.imeOffCommand = v.trim();
						await this.plugin.saveSettings();
					}),
			);
	}

	private displayKeymap(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Keymap").setHeading();

		const help = containerEl.createDiv({ cls: "setting-item-description keycommander-keymap-help" });
		help.appendText("Vim-style notation, comma separated: ");
		help.createEl("code", { text: "j" });
		help.appendText(", ");
		help.createEl("code", { text: "gg" });
		help.appendText(", ");
		help.createEl("code", { text: "<C-n>" });
		help.appendText(" (Ctrl), ");
		help.createEl("code", { text: "<A-c>" });
		help.appendText(" (Alt), ");
		help.createEl("code", { text: "<S-Tab>" });
		help.appendText(" (Shift), ");
		help.createEl("code", { text: "<D-k>" });
		help.appendText(" (Cmd). Special keys: ");
		help.createEl("code", { text: "<CR> <Esc> <Tab> <Space> <BS> <Del> <Up> <Down> <Left> <Right> <Home> <End> <PageUp> <PageDown> <lt> <comma>" });
		help.appendText(". The keyboard button next to a field records a single key press. Changes apply the next time the palette is opened.");

		new Setting(containerEl).setName("Reset all key bindings").addButton((b) =>
			b
				.setButtonText("Reset all")
				.setWarning()
				.onClick(async () => {
					this.plugin.settings.keymap = mergeKeymap(undefined);
					await this.plugin.saveSettings();
					this.display();
				}),
		);

		this.conflictsEl = containerEl.createDiv({ cls: "keycommander-conflicts" });
		this.renderConflicts();

		const header = containerEl.createDiv({ cls: "keycommander-keymap-header" });
		header.createSpan({ text: "Action" });
		header.createSpan({ text: "Insert mode" });
		header.createSpan({ text: "Normal mode" });
		for (const id of ACTION_IDS) {
			this.renderActionRow(containerEl, id);
		}
	}

	private renderActionRow(containerEl: HTMLElement, id: ActionId): void {
		const setting = new Setting(containerEl).setName(ACTIONS[id].desc).setClass("keycommander-keymap-row");
		const fields: Partial<Record<Mode, TextComponent>> = {};
		for (const mode of ["insert", "normal"] as Mode[]) {
			setting.addText((t) => {
				fields[mode] = t;
				t.setPlaceholder("(none)")
					.setValue(this.plugin.settings.keymap[id][mode].join(", "))
					.onChange(async (v) => {
						await this.updateBinding(id, mode, t, v);
					});
				t.inputEl.addClass("keycommander-keymap-input");
				t.inputEl.dataset.mode = mode;
			});
			setting.addExtraButton((b) =>
				b
					.setIcon("keyboard")
					.setTooltip(`Record a key for ${mode} mode`)
					.onClick(() => {
						const field = fields[mode];
						if (field) this.record(b.extraSettingsEl, id, mode, field);
					}),
			);
		}
		setting.addExtraButton((b) =>
			b
				.setIcon("rotate-ccw")
				.setTooltip("Reset to default")
				.onClick(async () => {
					const def = DEFAULT_KEYMAP[id];
					this.plugin.settings.keymap[id] = { insert: [...def.insert], normal: [...def.normal] };
					fields.insert?.setValue(def.insert.join(", "));
					fields.normal?.setValue(def.normal.join(", "));
					fields.insert?.inputEl.removeClass("keycommander-invalid");
					fields.normal?.inputEl.removeClass("keycommander-invalid");
					await this.plugin.saveSettings();
					this.renderConflicts();
				}),
		);
	}

	private async updateBinding(id: ActionId, mode: Mode, field: TextComponent, value: string): Promise<void> {
		const notations = splitNotations(value);
		const invalid = notations.filter((n) => parseSequence(n) === null);
		field.inputEl.toggleClass("keycommander-invalid", invalid.length > 0);
		field.inputEl.title = invalid.length > 0 ? `Invalid: ${invalid.join(", ")}` : "";
		if (invalid.length > 0) return;
		this.plugin.settings.keymap[id][mode] = notations;
		await this.plugin.saveSettings();
		this.renderConflicts();
	}

	/** Capture the next key press (bypassing Obsidian hotkeys) and append it to the field. */
	private record(buttonEl: HTMLElement, id: ActionId, mode: Mode, field: TextComponent): void {
		const sameButton = buttonEl.hasClass("keycommander-recording");
		this.stopRecording?.();
		if (sameButton) return; // second click on the same button cancels

		buttonEl.addClass("keycommander-recording");
		field.inputEl.addClass("keycommander-recording");
		const onKey = (e: KeyboardEvent) => {
			if (e.isComposing) return;
			const stroke = eventToString(e);
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();
			if (!stroke) return; // modifier only: keep waiting
			stop();
			const current = splitNotations(field.getValue());
			if (!current.includes(stroke)) current.push(stroke);
			const value = current.join(", ");
			field.setValue(value);
			void this.updateBinding(id, mode, field, value);
		};
		const stop = () => {
			window.removeEventListener("keydown", onKey, true);
			buttonEl.removeClass("keycommander-recording");
			field.inputEl.removeClass("keycommander-recording");
			this.stopRecording = null;
		};
		window.addEventListener("keydown", onKey, true);
		this.stopRecording = stop;
	}

	private renderConflicts(): void {
		const el = this.conflictsEl;
		if (!el) return;
		el.empty();
		const conflicts = findConflicts(this.plugin.settings.keymap);
		if (conflicts.length === 0) return;
		el.createDiv({ cls: "keycommander-conflicts-title", text: "⚠ Key binding conflicts" });
		const list = el.createEl("ul");
		for (const c of conflicts) {
			const names = c.actions.map((a) => `"${ACTIONS[a].desc}"`).join(" and ");
			const what =
				c.kind === "duplicate"
					? `${c.keys} is bound to both ${names}`
					: `${c.keys}: the shorter key shadows the longer sequence (${names})`;
			list.createEl("li", { text: `[${c.mode}] ${what}` });
		}
	}
}
