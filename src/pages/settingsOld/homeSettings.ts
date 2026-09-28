import { normalizeCustomHomePage } from '@utils/homePage';

type PersistHomePage = (homePage: string) => Promise<unknown>;
type UpdateHomeProtocol = (homePage: string) => Promise<void> | void;

export async function persistHomePage(
	selection: string,
	customUrl: string,
	persist: PersistHomePage,
	updateHomeProtocol: UpdateHomeProtocol,
): Promise<void> {
	const homePage = selection === 'custom' ? normalizeCustomHomePage(customUrl) : '';
	if (homePage === null) return;
	await persist(homePage);
	await updateHomeProtocol(homePage);
}
