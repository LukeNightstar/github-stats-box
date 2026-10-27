'use strict';

class NonRetryableError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NonRetryableError';
        this.retryable = false;
    }
}

function numberOrZero(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function starCount(repo) {
    if (typeof repo.stargazerCount === 'number' && Number.isFinite(repo.stargazerCount)) {
        return repo.stargazerCount;
    }
    const nested = repo.stargazers && repo.stargazers.totalCount;
    if (typeof nested === 'number' && Number.isFinite(nested)) {
        return nested;
    }
    return 0;
}

function statsFromViewer(viewer) {
    if (!viewer || typeof viewer !== 'object') {
        throw new NonRetryableError('GraphQL viewer is missing');
    }

    const nodes =
        viewer.repositories && Array.isArray(viewer.repositories.nodes) ? viewer.repositories.nodes : [];

    let skippedRepos = 0;
    const totalStars = nodes.reduce((sum, repo) => {
        if (!repo || typeof repo !== 'object') {
            skippedRepos += 1;
            return sum;
        }
        return sum + starCount(repo);
    }, 0);

    return {
        login: typeof viewer.login === 'string' ? viewer.login : '',
        name: viewer.name || viewer.login || 'GitHub User',
        totalPRs: numberOrZero(viewer.pullRequests && viewer.pullRequests.totalCount),
        totalIssues: numberOrZero(viewer.issues && viewer.issues.totalCount),
        contributedTo: numberOrZero(
            viewer.repositoriesContributedTo && viewer.repositoriesContributedTo.totalCount
        ),
        totalStars,
        totalCommits: numberOrZero(
            viewer.contributionsCollection && viewer.contributionsCollection.totalCommitContributions
        ),
        skippedRepos,
    };
}

const TRANSIENT_GRAPHQL_TYPES = new Set(['RATE_LIMITED', 'INTERNAL', 'TIMEOUT']);

function isTransientGraphql(errors) {
    return (
        Array.isArray(errors) &&
        errors.some((err) => err && typeof err.type === 'string' && TRANSIENT_GRAPHQL_TYPES.has(err.type))
    );
}

function safeGraphqlMessage(message) {
    let text = typeof message === 'string' ? message : 'unknown';
    text = text.replace(/ghp_[A-Za-z0-9]+/g, 'ghp_[redacted]');
    text = text.replace(/github_pat_[A-Za-z0-9_]+/g, 'github_pat_[redacted]');
    text = text.replace(/gho_[A-Za-z0-9]+/g, 'gho_[redacted]');
    if (text.length > 200) {
        text = `${text.slice(0, 200)}…`;
    }
    return text;
}

function viewerFromPayload(payload) {
    const viewer = payload && payload.data && payload.data.viewer;
    if (viewer && typeof viewer === 'object') {
        return viewer;
    }
    if (isTransientGraphql(payload && payload.errors)) {
        const error = new Error('GraphQL viewer is missing');
        error.retryable = true;
        throw error;
    }
    throw new NonRetryableError('GraphQL viewer is missing');
}

function generalizePath(path) {
    if (!Array.isArray(path)) {
        return '';
    }
    return path
        .filter((part) => typeof part === 'string' || typeof part === 'number')
        .map((part) => (typeof part === 'number' ? 'N' : part))
        .join('.');
}

function formatGraphqlErrors(errors, { limit = 10 } = {}) {
    if (!Array.isArray(errors) || errors.length === 0) {
        return [];
    }

    const groups = new Map();
    for (const err of errors) {
        let key;
        if (!err || typeof err !== 'object') {
            key = 'unknown GraphQL error';
        } else {
            const type = typeof err.type === 'string' ? err.type : '';
            const message = safeGraphqlMessage(err.message);
            const path = generalizePath(err.path);
            key = [type, path, message].filter(Boolean).join(': ');
        }
        groups.set(key, (groups.get(key) || 0) + 1);
    }

    const entries = [...groups.entries()];
    const lines = entries.slice(0, limit).map(([key, count]) => (count > 1 ? `${key} (x${count})` : key));
    const remainingGroups = entries.length - lines.length;
    if (remainingGroups > 0) {
        const remainingErrors = entries.slice(limit).reduce((sum, [, count]) => sum + count, 0);
        lines.push(`… ${remainingGroups} more group(s) (${remainingErrors} error(s))`);
    }
    return lines;
}

module.exports = {
    NonRetryableError,
    statsFromViewer,
    formatGraphqlErrors,
    viewerFromPayload,
    isTransientGraphql,
};
