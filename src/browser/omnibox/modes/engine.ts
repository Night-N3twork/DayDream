import type { OmniboxRow, OmniboxSection } from '../types';
import type { SearchEngineRegistry, SearchEngine } from '@apis/searchEngines';
import { expandSearchTemplate } from '@apis/searchEngines';

export interface EngineModeDeps {
	query: string;
	searchEngines: Pick<SearchEngineRegistry, 'list' | 'findByAt'>;
	onNavigate: (url: string) => void;
	onSelectEngine: (atKey: string) => void;
}

export interface EngineModeResult {
	primaryRow?: OmniboxRow;
	sections: OmniboxSection[];
}

export function renderEngineMode(deps: EngineModeDeps): EngineModeResult {
	const { query } = deps;
	const m = query.match(/^([A-Za-z0-9._-]+)(?:\s+(.*))?$/);
	if (m) {
		const key = m[1];
		const rest = m[2];
		const engine = deps.searchEngines.findByAt(key);
		if (engine && rest !== undefined && rest.length > 0) {
			return {
				primaryRow: {
					id: `eng-preview-${engine.id}`,
					icon: 'search',
					label: `Search ${engine.name} for: ${rest}`,
					onSelect: () => deps.onNavigate(expandSearchTemplate(engine.urlTemplate, rest)),
				},
				sections: [],
			};
		}
		if (engine && (rest === undefined || rest.length === 0)) {
			return {
				primaryRow: {
					id: `eng-key-${engine.id}`,
					icon: 'search',
					label: `Search ${engine.name} for: `,
					sublabel: 'Type your query and press Enter',
					onSelect: () => deps.onSelectEngine(engine.at!),
				},
				sections: [],
			};
		}
	}
	const engines = deps.searchEngines.list().filter((e: SearchEngine) => !!e.at);
	const filtered = query
		? engines.filter((e) => (e.at ?? '').toLowerCase().startsWith(query.toLowerCase()))
		: engines;
	if (filtered.length === 0) return { sections: [] };
	const rows: OmniboxRow[] = filtered.map((e) => ({
		id: `eng-pick-${e.id}`,
		icon: 'at-sign',
		label: `@${e.at} — ${e.name}`,
		sublabel: e.urlTemplate,
		onSelect: () => deps.onSelectEngine(e.at!),
	}));
	return {
		sections: [{ id: 'engines', title: 'Search engines', icon: 'at-sign', rows }],
	};
}
