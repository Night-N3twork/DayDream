const p = self.location.pathname;
const workspaceMarker = '/app/';
const idx = p.indexOf(workspaceMarker);
const ddxBase = idx !== -1 ? p.substring(0, idx + workspaceMarker.length) : '/';
self.__ddxBase = ddxBase;

export const basePath = ddxBase;

export function stripBase(pathname: string): string {
	if (basePath !== '/' && pathname.startsWith(basePath)) {
		return '/' + pathname.slice(basePath.length);
	}

	return pathname;
}
