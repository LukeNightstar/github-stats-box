const axios = require('axios');
const { NonRetryableError } = require('./stats');

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 30000;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'ENOTFOUND',
    'ECONNABORTED',
    'ERR_NETWORK',
    'ERR_BAD_RESPONSE',
]);

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeError(error) {
    const status = error.response && error.response.status;
    if (status) {
        return `HTTP ${status}`;
    }
    return error.code || 'error';
}

function isRetryable(error) {
    if (!error) {
        return false;
    }
    const status = error.response && error.response.status;
    if (status && RETRYABLE_STATUS.has(status)) {
        return true;
    }
    return Boolean(error.code && RETRYABLE_CODES.has(error.code));
}

function isRetryableFailure(error) {
    const seen = new Set();
    let current = error;
    while (current && typeof current === 'object' && !seen.has(current)) {
        seen.add(current);
        if (current instanceof NonRetryableError || current.retryable === false) {
            return false;
        }
        if (current.retryable === true || isRetryable(current)) {
            return true;
        }
        current = current.cause;
    }
    return false;
}

async function withRetry(task, label) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            return await task();
        } catch (error) {
            lastError = error;
            if (!isRetryableFailure(error) || attempt === MAX_ATTEMPTS) {
                throw error;
            }
            const delayMs = 15000 * attempt;
            console.info(
                `${label}: transient failure (${describeError(error)}); retrying in ${delayMs / 1000}s (attempt ${attempt}/${MAX_ATTEMPTS})`
            );
            await sleep(delayMs);
        }
    }
    throw lastError;
}

function redactAuthHeaders(error) {
    const headerSets = [];
    if (error.config && error.config.headers) {
        headerSets.push(error.config.headers);
    }
    if (error.response && error.response.config && error.response.config.headers) {
        headerSets.push(error.response.config.headers);
    }
    for (const headers of headerSets) {
        if (headers.Authorization) {
            headers.Authorization = '[redacted]';
        }
        if (headers.authorization) {
            headers.authorization = '[redacted]';
        }
    }
    if (error.request && typeof error.request._header === 'string') {
        error.request._header = error.request._header.replace(/^Authorization:.*$/gim, 'Authorization: [redacted]');
    }
}

function githubRequest(config, token) {
    const method = (config.method || 'get').toString().toUpperCase();
    return withRetry(async () => {
        try {
            return await axios({
                timeout: TIMEOUT_MS,
                ...config,
                redact: ['Authorization'],
                headers: {
                    'User-Agent': 'github-stats-box',
                    ...(config.headers || {}),
                    Authorization: `Bearer ${token}`,
                },
            });
        } catch (error) {
            redactAuthHeaders(error);
            throw error;
        }
    }, `${method} ${config.url}`);
}

const userInfoFetcher = (token) => {
    return githubRequest(
        {
            url: 'https://api.github.com/graphql',
            method: 'post',
            data: {
                query: `
              query userInfo {
                viewer {
                  name
                  login
                  contributionsCollection {
                    totalCommitContributions
                  }
                  repositoriesContributedTo(first: 1, contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]) {
                    totalCount
                  }
                  pullRequests(first: 1) {
                    totalCount
                  }
                  issues(first: 1) {
                    totalCount
                  }
                  repositories(first: 100, ownerAffiliations: OWNER, isFork: false, orderBy: {direction: DESC, field: STARGAZERS}) {
                    totalCount
                    nodes {
                      stargazerCount
                      stargazers {
                        totalCount
                      }
                    }
                  }
                }
              }`,
            },
        },
        token
    );
};

// Experimental API
const totalCommitsFetcher = async (login, token) => {
    return githubRequest(
        {
            method: 'get',
            url: `https://api.github.com/search/commits?q=author:${login}`,
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/vnd.github.cloak-preview',
            },
        },
        token
    ).then((res) => res.data.total_count);
};

module.exports = {
    userInfoFetcher,
    totalCommitsFetcher,
    githubRequest,
    describeError,
    isRetryableFailure,
};
