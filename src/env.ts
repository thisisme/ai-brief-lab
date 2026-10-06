import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	PRODUCTS_API_URL: {
		description: 'URL of the PHP JSON endpoint that lists products'
	}
});
