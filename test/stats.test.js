'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { statsFromViewer, formatGraphqlErrors, viewerFromPayload, NonRetryableError } = require('../stats');

describe('statsFromViewer', () => {
    it('documents the production TypeError when a repository node is null', () => {
        const nodes = [{ stargazers: { totalCount: 10 } }, null];
        assert.throws(() => {
            nodes.reduce((prev, curr) => prev + curr.stargazers.totalCount, 0);
        }, TypeError);
    });

    it('skips null repository nodes instead of crashing on stargazers', () => {
        const viewer = {
            login: 'octocat',
            name: 'The Octocat',
            pullRequests: { totalCount: 8 },
            issues: { totalCount: 3 },
            repositoriesContributedTo: { totalCount: 4 },
            contributionsCollection: { totalCommitContributions: 12 },
            repositories: {
                totalCount: 3,
                nodes: [
                    { stargazerCount: 10, stargazers: { totalCount: 10 } },
                    null,
                    { stargazers: { totalCount: 5 } },
                ],
            },
        };

        const stats = statsFromViewer(viewer);

        assert.equal(stats.totalStars, 15);
        assert.equal(stats.skippedRepos, 1);
        assert.equal(stats.name, 'The Octocat');
        assert.equal(stats.totalPRs, 8);
        assert.equal(stats.totalIssues, 3);
        assert.equal(stats.contributedTo, 4);
        assert.equal(stats.totalCommits, 12);
        assert.equal(stats.login, 'octocat');
    });

    it('guards null nested fields on an otherwise present repo node', () => {
        const stats = statsFromViewer({
            login: 'octocat',
            repositories: {
                nodes: [
                    { stargazerCount: 7, stargazers: null },
                    { stargazers: { totalCount: 2 } },
                    { stargazerCount: null, stargazers: {} },
                ],
            },
        });

        assert.equal(stats.totalStars, 9);
        assert.equal(stats.skippedRepos, 0);
    });

    it('treats missing viewer collections as zero rather than throwing', () => {
        const stats = statsFromViewer({ login: 'octocat', name: null });

        assert.equal(stats.name, 'octocat');
        assert.equal(stats.totalPRs, 0);
        assert.equal(stats.totalIssues, 0);
        assert.equal(stats.contributedTo, 0);
        assert.equal(stats.totalStars, 0);
        assert.equal(stats.totalCommits, 0);
        assert.equal(stats.skippedRepos, 0);
    });

    it('throws a non-retryable error when viewer is missing', () => {
        assert.throws(() => statsFromViewer(null), NonRetryableError);
        assert.throws(() => statsFromViewer(undefined), NonRetryableError);
    });
});

describe('formatGraphqlErrors', () => {
    it('summarizes message, type, and path only', () => {
        const lines = formatGraphqlErrors([
            {
                type: 'FORBIDDEN',
                path: ['viewer', 'repositories', 'nodes', 1],
                message: 'Resource not accessible by personal access token',
                extensions: { saml_failure: false, authorization: 'Bearer SECRETVALUE' },
                config: { headers: { Authorization: 'Bearer SECRETVALUE' } },
            },
        ]);

        assert.equal(lines.length, 1);
        assert.match(lines[0], /FORBIDDEN/);
        assert.match(lines[0], /viewer\.repositories\.nodes\.1/);
        assert.match(lines[0], /Resource not accessible by personal access token/);
        assert.equal(lines[0].includes('SECRETVALUE'), false);
        assert.equal(lines[0].includes('Bearer'), false);
        assert.equal(lines[0].includes('authorization'), false);
    });

    it('returns an empty list when errors are missing', () => {
        assert.deepEqual(formatGraphqlErrors(undefined), []);
        assert.deepEqual(formatGraphqlErrors(null), []);
        assert.deepEqual(formatGraphqlErrors([]), []);
    });

    it('redacts token-like prefixes in GraphQL messages', () => {
        const marker = 'ghp_' + 'REDACTMEINTESTONLY12345';
        const lines = formatGraphqlErrors([{ type: 'FORBIDDEN', message: `denied ${marker}` }]);
        assert.equal(lines[0].includes(marker), false);
        assert.match(lines[0], /ghp_\[redacted\]/);
    });
});

describe('viewerFromPayload', () => {
    it('returns the viewer when present even if some repo nodes are null', () => {
        const viewer = viewerFromPayload({
            data: { viewer: { login: 'octocat', repositories: { nodes: [null] } } },
            errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by personal access token' }],
        });
        assert.equal(viewer.login, 'octocat');
    });

    it('throws non-retryable when viewer is missing', () => {
        assert.throws(
            () => viewerFromPayload({ data: { viewer: null }, errors: [{ type: 'FORBIDDEN', message: 'nope' }] }),
            NonRetryableError
        );
    });

    it('throws retryable when viewer is missing due to RATE_LIMITED', () => {
        try {
            viewerFromPayload({ data: { viewer: null }, errors: [{ type: 'RATE_LIMITED', message: 'wait' }] });
            assert.fail('expected throw');
        } catch (error) {
            assert.equal(error.retryable, true);
            assert.equal(error instanceof NonRetryableError, false);
        }
    });
});
