import { randomUUID } from 'node:crypto';

import express from 'express';

import { errorMiddleware, requestLoggerMiddleware } from './util/middlewares';
import { validateSession } from './util/validate-user';

const app = express();
app.use(express.json());
app.use(errorMiddleware);
app.use(requestLoggerMiddleware);

const DD_API_KEY = process.env.DD_API_KEY;
const DD_APP_KEY = process.env.DD_APP_KEY;
const DD_SITE = process.env.DD_SITE ?? 'datadoghq.com';
const DD_LLMOBS_ML_APP = process.env.DD_LLMOBS_ML_APP ?? 'actual-ai';
const DD_ENV = process.env.DD_ENV ?? 'dev';
const OBSERVABILITY_ENABLED =
  !!DD_API_KEY && process.env.DD_LLMOBS_ENABLED === '1';

if (OBSERVABILITY_ENABLED) {
  console.log('Datadog LLM Observability enabled for suggestions');
} else {
  console.log(
    'Datadog LLM Observability disabled (set DD_API_KEY and DD_LLMOBS_ENABLED=1)',
  );
}

/**
 * POST /suggestions/outcome
 *
 * Called by the client when a user accepts or dismisses a suggestion.
 * Emits a Datadog LLM Observability Task span linked to the original
 * trace that created the suggestion via the HTTP intake API.
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

  if (!OBSERVABILITY_ENABLED) {
    res.json({ status: 'ok', observability: 'unavailable' });
    return;
  }

  try {
    const traceContext = await findTraceContext(suggestion_id);

    const nowNs = BigInt(Date.now()) * 1_000_000n;
    const spanId = randomUUID().replace(/-/g, '').slice(0, 16);

    const span = {
      span_id: spanId,
      trace_id: traceContext?.traceId ?? randomUUID().replace(/-/g, ''),
      parent_id: traceContext?.spanId ?? 'undefined',
      name: 'suggestion_outcome',
      start_ns: Number(nowNs),
      duration: 1,
      status: 'ok',
      meta: {
        kind: 'task',
        input: {
          value: JSON.stringify(
            transaction_before ?? { new_transaction: true },
          ),
        },
        output: {
          value: JSON.stringify({ suggestion, outcome }),
        },
        metadata: {
          transaction_id: transaction_id ?? 'new',
          suggestion_id,
        },
      },
      tags: [
        `suggestion_outcome:${outcome}`,
        `env:${DD_ENV}`,
      ],
    };

    console.log(
      'Emitting suggestion outcome span:',
      JSON.stringify(span, null, 2),
    );

    const intakeResponse = await fetch(
      `https://api.${DD_SITE}/api/intake/llm-obs/v1/trace/spans`,
      {
        method: 'POST',
        headers: {
          'DD-API-KEY': DD_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: {
            type: 'span',
            attributes: {
              ml_app: DD_LLMOBS_ML_APP,
              tags: [`env:${DD_ENV}`],
              spans: [span],
            },
          },
        }),
      },
    );

    if (!intakeResponse.ok) {
      const body = await intakeResponse.text();
      console.error(
        'Span intake API returned',
        intakeResponse.status,
        body,
      );
      res.json({ status: 'ok', observability: 'error' });
      return;
    }

    console.log('Span intake API accepted');
    res.json({ status: 'ok', observability: 'emitted' });
  } catch (err) {
    console.error('Error emitting suggestion outcome span:', err);
    res.json({ status: 'ok', observability: 'error' });
  }
});

/**
 * Look up the trace_id and span_id for a suggestion by querying the
 * Datadog LLM Observability Search Spans API.
 */
async function findTraceContext(suggestionId) {
  if (!DD_API_KEY || !DD_APP_KEY) {
    console.log('findTraceContext: missing DD_API_KEY or DD_APP_KEY');
    return null;
  }

  try {
    const query = `@meta.metadata.suggestion_id:${suggestionId}`;
    const response = await fetch(
      `https://api.${DD_SITE}/api/v2/llm-obs/v1/spans/events/search`,
      {
        method: 'POST',
        headers: {
          'DD-API-KEY': DD_API_KEY,
          'DD-APPLICATION-KEY': DD_APP_KEY,
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
    console.log(
      'findTraceContext: search API response',
      JSON.stringify(result, null, 2),
    );
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
