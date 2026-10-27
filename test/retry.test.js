'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isRetryableFailure } = require('../fetch');
const { NonRetryableError } = require('../stats');

describe('isRetryableFailure', () => {
    it('retries transient HTTP 5xx and network errors', () => {
        assert.equal(isRetryableFailure({ response: { status: 504 } }), true);
        assert.equal(isRetryableFailure({ response: { status: 502 } }), true);
        assert.equal(isRetryableFailure({ code: 'ECONNRESET' }), true);
        assert.equal(isRetryableFailure({ cause: { response: { status: 504 } } }), true);
    });

    it('does not retry 401/403, GraphQL permission, or data-shape errors', () => {
        assert.equal(isRetryableFailure({ response: { status: 401 } }), false);
        assert.equal(isRetryableFailure({ response: { status: 403 } }), false);
        assert.equal(isRetryableFailure({ response: { status: 404 } }), false);
        assert.equal(isRetryableFailure(new NonRetryableError('GraphQL viewer is missing')), false);
        assert.equal(
            isRetryableFailure(new TypeError("Cannot read properties of null (reading 'stargazers')")),
            false
        );
        const wrapped = new Error("cannot retrieve statistics: Cannot read properties of null (reading 'stargazers')");
        wrapped.cause = new TypeError("Cannot read properties of null (reading 'stargazers')");
        assert.equal(isRetryableFailure(wrapped), false);

        const wrappedFatal = new Error('cannot retrieve statistics: GraphQL viewer is missing');
        wrappedFatal.cause = new NonRetryableError('GraphQL viewer is missing');
        assert.equal(isRetryableFailure(wrappedFatal), false);

        const wrappedTransient = new Error('cannot retrieve statistics: GraphQL viewer is missing');
        wrappedTransient.cause = Object.assign(new Error('GraphQL viewer is missing'), { retryable: true });
        assert.equal(isRetryableFailure(wrappedTransient), true);
    });
});
