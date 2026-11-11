// Shape Messages API params for the model they are sent to, so switching a route
// to Claude Fable 5.2 or Mythos 5.2 doesn't turn into 400s. Rules come from
// platform.claude.com/docs/en/models/fable-5-2/whats-new-fable-5-2 (Nov 9 2026).
// Other models pass through unchanged. Only erasable TypeScript, so Node runs it directly.

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type Params = Record<string, unknown> & { model: string };
export type Shaped = { params: Params; changes: string[] };
export type ShapeOptions = {
	/** Set when the request has none. Fable 5.2's API default is high; Opus 5.5's is medium. */
	defaultEffort?: Effort;
	/** Throw instead of rewriting, for CI and tests that must see the raw request. */
	strict?: boolean;
};

// Adaptive thinking always on, no forced tool use, no sampling parameters.
const ADAPTIVE_ONLY = /^claude-(fable|mythos)-5-2(\b|-)/;
// Fable and Mythos 5.x: omit temperature, top_p and top_k (migration guide, baseline settings).
const NO_SAMPLING = /^claude-(fable|mythos)-5(-\d+)?(\b|-|$)/;

export function modelRules(model: string) {
	return { adaptiveOnly: ADAPTIVE_ONLY.test(model), noSampling: NO_SAMPLING.test(model) };
}

export function shapeRequest(input: Params, opts: ShapeOptions = {}): Shaped {
	const params: Params = structuredClone(input);
	const changes: string[] = [];
	const rules = modelRules(params.model);
	const change = (what: string) => {
		if (opts.strict) throw new Error(`model-shape: ${params.model}: ${what}`);
		changes.push(what);
	};

	if (rules.noSampling) {
		for (const key of ['temperature', 'top_p', 'top_k']) {
			if (key in params) {
				delete params[key];
				change(`removed ${key}`);
			}
		}
	}

	if (rules.adaptiveOnly) {
		const thinking = params.thinking as { type?: string } | undefined;
		const output = { ...((params.output_config as Record<string, unknown> | undefined) ?? {}) };
		if (thinking?.type === 'enabled') {
			params.thinking = { type: 'adaptive' };
			change('thinking enabled with budget_tokens -> adaptive (use effort for depth)');
		} else if (thinking?.type === 'disabled') {
			delete params.thinking;
			if (!output.effort) output.effort = 'low';
			change('thinking disabled -> omitted, effort low');
		}

		const choice = params.tool_choice as { type?: string; name?: string } | undefined;
		if (choice?.type === 'any' || choice?.type === 'tool') {
			params.tool_choice = { type: 'auto' };
			const tools = (params.tools as Array<Record<string, unknown>> | undefined) ?? [];
			params.tools = tools.map((t) =>
				choice.type === 'any' || t.name === choice.name ? { ...t, strict: true } : t
			);
			change(`tool_choice ${choice.type}${choice.name ? ` (${choice.name})` : ''} -> auto with strict tools`);
		}

		if (!output.effort && opts.defaultEffort) {
			output.effort = opts.defaultEffort;
			change(`effort set to ${opts.defaultEffort} (API default is high)`);
		}
		if (Object.keys(output).length) params.output_config = output;
	}

	return { params, changes };
}
