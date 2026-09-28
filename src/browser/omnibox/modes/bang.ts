import type { OmniboxRow } from '../types';
import type { SearchEngineRegistry } from '@apis/searchEngines';
import { expandSearchTemplate, parseBang } from '@apis/searchEngines';

export interface BangModeDeps {
	rawInput: string;
	searchEngines: SearchEngineRegistry;
	onNavigate: (url: string) => void;
}

export interface BangModeResult {
	primaryRow?: OmniboxRow;
}

export function renderBangMode(deps: BangModeDeps): BangModeResult {
	const hit = parseBang(deps.rawInput, deps.searchEngines);
	if (!hit) return {};
	const { engine, query } = hit;
	return {
		primaryRow: {
			id: `bang-${engine.id}`,
			icon: 'zap',
			label: `Search ${engine.name} for: ${query || ''}`,
			sublabel: `!${engine.bang}`,
			onSelect: () => deps.onNavigate(expandSearchTemplate(engine.urlTemplate, query)),
		},
	};
}
