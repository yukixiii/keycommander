import { Plugin } from "obsidian";
import { loadDictionary } from "./i18n/obsidianI18n";
import { englishName, searchAliases, type Alias, type Dictionary } from "./i18n/translate";
import { turnImeOff } from "./ime";
import { KeycommanderSettingTab, loadSettings, type KeycommanderSettings } from "./settings";
import { CommandModal } from "./ui/CommandModal";

const CORE_PALETTE_COMMAND = "command-palette:open";

export default class KeycommanderPlugin extends Plugin {
	settings!: KeycommanderSettings;
	/** Built on first use: Obsidian's translations are complete by then. */
	private dictionary: Dictionary | null | undefined;
	private aliasCache = new Map<string, { aliases: Alias[]; english: string | null }>();
	private restoreCore: (() => void) | null = null;

	async onload(): Promise<void> {
		this.settings = loadSettings(await this.loadData());
		this.addSettingTab(new KeycommanderSettingTab(this.app, this));

		this.addCommand({
			id: "open",
			name: "Open command palette",
			callback: () => this.open(),
		});

		this.app.workspace.onLayoutReady(() => this.applyReplacement());
		this.register(() => {
			this.restoreCore?.();
			this.restoreCore = null;
		});
	}

	open(): void {
		new CommandModal(this).open();
	}

	/** Make the core "Open command palette" command open Keycommander (or undo that), per the setting. */
	applyReplacement(): void {
		this.restoreCore?.();
		this.restoreCore = null;
		if (!this.settings.replaceCorePalette) return;
		const cmd = this.app.commands.commands[CORE_PALETTE_COMMAND];
		if (!cmd) return; // core command palette disabled
		const { callback, checkCallback } = cmd;
		cmd.callback = () => this.open();
		cmd.checkCallback = undefined;
		this.restoreCore = () => {
			cmd.callback = callback;
			cmd.checkCallback = checkCallback;
		};
	}

	/** Search aliases and the English display name of a command name. */
	aliasesFor(name: string): { aliases: Alias[]; english: string | null } {
		let entry = this.aliasCache.get(name);
		if (!entry) {
			if (this.dictionary === undefined) this.dictionary = loadDictionary();
			const aliases = searchAliases(name, this.dictionary);
			entry = { aliases, english: englishName(aliases) };
			this.aliasCache.set(name, entry);
		}
		return entry;
	}

	/** Commands pinned in the core command palette's settings. */
	pinnedCommands(): string[] {
		try {
			const core = this.app.internalPlugins?.getPluginById("command-palette");
			const pinned = core?.enabled ? core.instance?.options?.pinned : undefined;
			return Array.isArray(pinned) ? pinned : [];
		} catch {
			return [];
		}
	}

	async recordRecent(id: string): Promise<void> {
		const s = this.settings;
		s.recentCommands = [id, ...s.recentCommands.filter((x) => x !== id)].slice(0, s.recentLimit);
		await this.saveSettings();
	}

	imeOff(): void {
		turnImeOff(this.settings.imeOffCommand);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
