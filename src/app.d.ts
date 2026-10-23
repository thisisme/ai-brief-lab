// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** Set in hooks.server.ts from the signed session cookie; undefined = internal usage. */
			tenant: string | undefined;
			/** A session cookie was sent but did not verify. */
			badSession: boolean;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
