// Loaded by SvelteKit before any app code (it needs an adapter that supports it, e.g. adapter-node).
// Registers a global tracer provider, so SvelteKit's own spans and the Claude SDK's spans
// (@anthropic-ai/sdk 0.134+) end up in one trace.
import { NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';

const url = process.env.TRACE_SINK_URL ?? 'http://127.0.0.1:4319/v1/traces';

const provider = new NodeTracerProvider({
	resource: resourceFromAttributes({ 'service.name': process.env.OTEL_SERVICE_NAME ?? 'ai-brief-lab' }),
	// Simple = export each span as it ends. Fine for a lab; use BatchSpanProcessor in production.
	spanProcessors: [new SimpleSpanProcessor(new OTLPTraceExporter({ url }))]
});

// Sets the global provider, the W3C traceparent propagator and the async context manager.
provider.register();
