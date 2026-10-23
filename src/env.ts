import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	PRODUCTS_API_URL: {
		description: 'URL of the PHP JSON endpoint that lists products'
	},
	ANTHROPIC_API_KEY: {
		description: 'Claude API key. Never public.'
	},
	ANTHROPIC_BASE_URL: {
		description: 'Optional: a gateway or a local fake for tests.',
		schema: (value) => value || undefined
	},
	LAB_SESSION_SECRET: {
		description: 'Key for signing the lab_session cookie (HMAC-SHA256). At least 32 characters. Never public.',
		schema: (value) => {
			if (!value || value.length < 32) throw new Error('LAB_SESSION_SECRET must be at least 32 characters');
			return value;
		}
	},
	CLAUDE_MODEL: {
		description: 'Model for /api/summary.',
		schema: (value) => value || 'claude-haiku-5-5'
	}
});
