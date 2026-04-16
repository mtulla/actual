import express from 'express';

import { errorMiddleware, requestLoggerMiddleware } from './util/middlewares';
import { validateSession } from './util/validate-user';

const app = express();
app.use(express.json());
app.use(errorMiddleware);
app.use(requestLoggerMiddleware);

// Initialize dd-trace with LLM Observability in-code (not via --require)
let llmobs = null;
let tracer = null;
try {
  const ddTrace = await import('dd-trace');
  tracer = ddTrace.default;

  if (process.env.DD_API_KEY && process.env.DD_LLMOBS_ENABLED === '1') {
    tracer.init({
      llmobs: {
        mlApp: process.env.DD_LLMOBS_ML_APP ?? 'actual-ai',
        agentlessEnabled: true,
      },
      site: process.env.DD_SITE ?? 'datadoghq.com',
      env: process.env.DD_ENV ?? 'dev',
    });
    llmobs = tracer.llmobs;
    console.log('Datadog LLM Observability initialized for suggestions');
  }
} catch (err) {
  console.error('Failed to initialize dd-trace LLM Observability:', err);
}

/**
 * POST /suggestions/outcome
 *
 * Called by the client when a user accepts or dismisses a suggestion.
 * Emits a Datadog LLM Observability Task span linked to the original
 * trace that created the suggestion.
 */
app.post('/outcome', async (req, res) => {
  const session = validateSession(req, res);
  if (!session) return;

  const {
    suggestion_id,
    transaction_id,
    suggestion,
    transaction_before,
    outcome,
  } = req.body;

  if (!suggestion_id || !outcome) {
    res.status(400).json({
      status: 'error',
      reason: 'missing-fields',
      details: 'suggestion_id and outcome are required',
    });
    return;
  }

  if (outcome !== 'accepted' && outcome !== 'dismissed') {
    res.status(400).json({
      status: 'error',
      reason: 'invalid-outcome',
      details: 'outcome must be "accepted" or "dismissed"',
    });
    return;
  }

  if (!llmobs) {
    res.json({ status: 'ok', observability: 'unavailable' });
    return;
  }

  try {
    const traceContext = await findTraceContext(suggestion_id);

    const spanOptions = {
      kind: 'task',
      name: 'suggestion_outcome',
    };

    if (traceContext) {
      // Build a parent SpanContext from the trace/span IDs so the new
      // span lands on the same trace as the original suggestion generation.
      const parentContext = tracer.extract('text_map', {
        'x-datadog-trace-id': hexToDecimal(
          traceContext.traceId.slice(-16),
        ),
        'x-datadog-parent-id': hexToDecimal(traceContext.spanId),
        'x-datadog-tags': `_dd.p.tid=${traceContext.traceId.slice(0, -16)}`,
      });
      spanOptions.childOf = parentContext;
    }

    const emitSpan = () => {
      llmobs.annotate({
        inputData: transaction_before ?? { new_transaction: true },
        outputData: { suggestion, outcome },
        metadata: {
          transaction_id: transaction_id ?? 'new',
          suggestion_id,
        },
        tags: {
          suggestion_outcome: outcome,
        },
      });
    };

    const wrappedFn = llmobs.wrap(spanOptions, emitSpan);
    wrappedFn();

    res.json({ status: 'ok', observability: 'emitted' });
  } catch (err) {
    console.error('Error emitting suggestion outcome span:', err);
    res.json({ status: 'ok', observability: 'error' });
  }
});

/**
 * Convert a hex string to a decimal string.
 * Uses BigInt to handle 64-bit values that exceed Number.MAX_SAFE_INTEGER.
 */
function hexToDecimal(hex) {
  return BigInt('0x' + hex).toString();
}

/**
 * Look up the trace_id and span_id for a suggestion by querying the
 * Datadog LLM Observability Search Spans API.
 */
async function findTraceContext(suggestionId) {
  const apiKey = process.env.DD_API_KEY;
  const appKey = process.env.DD_APP_KEY;
  const site = process.env.DD_SITE ?? 'datadoghq.com';

  if (!apiKey || !appKey) {
    console.log('findTraceContext: missing DD_API_KEY or DD_APP_KEY');
    return null;
  }

  try {
    const query = `@meta.metadata.suggestion_id:${suggestionId}`;
    const response = await fetch(
      `https://api.${site}/api/v2/llm-obs/v1/spans/events/search`,
      {
        method: 'POST',
        headers: {
          'DD-API-KEY': apiKey,
          'DD-APPLICATION-KEY': appKey,
          'Content-Type': 'application/vnd.api+json',
        },
        body: JSON.stringify({
          data: {
            type: 'spans',
            attributes: {
              filter: {
                query,
                from: 'now-30d',
                to: 'now',
              },
              page: { limit: 1 },
              sort: '-timestamp',
            },
          },
        }),
      },
    );

    if (!response.ok) {
      console.error(
        'findTraceContext: search API returned',
        response.status,
        await response.text(),
      );
      return null;
    }

    const result = await response.json();
    const span = result.data?.[0]?.attributes;
    if (!span?.trace_id || !span?.span_id) {
      console.log(
        'findTraceContext: no matching span found for suggestion',
        suggestionId,
      );
      return null;
    }

    console.log(
      'findTraceContext: found trace',
      span.trace_id,
      'span',
      span.span_id,
    );
    return { traceId: span.trace_id, spanId: span.span_id };
  } catch (err) {
    console.error('findTraceContext: error searching spans', err);
    return null;
  }
}

export { app as handlers };
