// OpenTelemetry bootstrap. Imported as the FIRST line of main.ts so the SDK
// registers global providers before any other module loads — required for
// auto-instrumentation to monkey-patch the imports it cares about.
//
// No-op when OTEL_EXPORTER_OTLP_ENDPOINT is unset, so the bootstrap is safe
// in dev / test / CI without any extra config. Set the endpoint to a local
// collector or to LangSmith's OTLP/HTTP URL to receive traces.

import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
let sdk: NodeSDK | undefined

if (endpoint) {
  // LangSmith OTLP endpoint accepts the trace via x-api-key header. For
  // generic OTLP collectors (Tempo, Jaeger, etc.) the headers are usually
  // unnecessary. We set them only when LANGSMITH_API_KEY is present.
  const headers: Record<string, string> = {}
  const lsKey = process.env.LANGSMITH_API_KEY
  if (lsKey) {
    headers['x-api-key'] = lsKey
    headers['Langsmith-Project'] =
      process.env.LANGSMITH_PROJECT ?? 'cardioplace-backend'
  }

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'cardioplace-backend',
      [ATTR_SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION ?? 'dev',
    }),
    traceExporter: new OTLPTraceExporter({ url: endpoint, headers }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable fs auto-instrumentation — every Prisma query reads the
        // .prisma client directory, which would flood traces.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  })

  try {
    sdk.start()
    // eslint-disable-next-line no-console
    console.log(`[otel] tracing enabled → ${endpoint}`)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[otel] failed to start', err)
  }

  process.on('SIGTERM', () => {
    void sdk
      ?.shutdown()
      .catch((err) => console.warn('[otel] shutdown failed', err))
  })
}
