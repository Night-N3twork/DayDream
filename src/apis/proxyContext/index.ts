import { installScramjetProxyContext } from './generated/proxy-context-host.js';
import adapterSource from './generated/proxy-context-adapter.js?raw';

export function installProxyContext(controller: unknown): () => void {
	return installScramjetProxyContext(controller, adapterSource);
}
