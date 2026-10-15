// Undocumented Obsidian internals used by this plugin. Every access is guarded at runtime.
import "obsidian";
import type { Command } from "obsidian";
import type { Resources } from "./i18n/translate";

declare module "obsidian" {
	interface App {
		commands: {
			commands: Record<string, Command>;
			/** Commands that can run right now (check callbacks pass). */
			listCommands(): Command[];
			executeCommandById(id: string): boolean;
		};
		hotkeyManager?: {
			printHotkeyForCommand(id: string): string;
		};
		internalPlugins?: {
			getPluginById(id: string): {
				enabled: boolean;
				instance?: { options?: { pinned?: string[] } };
			} | null;
		};
	}
}

declare global {
	interface Window {
		i18next?: {
			language?: string;
			store?: { data?: Record<string, Record<string, Resources>> };
		};
	}
}
