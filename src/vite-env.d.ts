/// <reference types="vite/client" />
/// <reference types="@mercuryworkshop/scramjet/types" />

// Virtual module emitted by `srv/vite/build-config-virtual.ts`. The default
// export is the frozen `BuildConfig` produced at build time — see
// `srv/vite/build-config.ts` for the source-of-truth shape.
declare module 'virtual:ddx-build-config' {
	const config: {
		readonly buildId: string;
		readonly workspace: string;
		readonly cover: {
			readonly provider: string;
			readonly assetPrefix: string;
			readonly worker: string;
			readonly identity: {
				readonly product: string;
				readonly title: string;
				readonly description: string;
			};
			readonly route: string;
		};
		readonly routes: Record<string, string>;
		readonly globals: Record<string, string>;
		readonly messages: Record<string, string>;
		readonly network: {
			readonly path: string;
			readonly handoffPath: string;
			readonly handoffParam: string;
			readonly frame: {
				readonly version: number;
				readonly key: string;
				readonly tag: string;
				readonly headerLength: number;
				readonly nonceLength: number;
				readonly metadataOffset: number;
				readonly paddingMinimum: number;
				readonly paddingMaximum: number;
				readonly paddingPlacement: 'prefix' | 'suffix' | 'split';
				readonly keyStride: number;
				readonly nonceStride: number;
			};
		};
		readonly rpc: Record<string, string>;
	};
	export default config;
}
