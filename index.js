#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { userInfoFetcher, totalCommitsFetcher, githubRequest, isRetryableFailure, describeError } = require('./fetch');
const { statsFromViewer, formatGraphqlErrors, viewerFromPayload, NonRetryableError } = require('./stats');
const numeral = require('numeral');

const gistId = process.env.GIST_ID;
const githubToken = process.env.GH_TOKEN;
const countAllCommits = String(process.env.ALL_COMMITS) === 'true';
const kFormat = String(process.env.K_FORMAT) === 'true';

async function main() {
    if (!githubToken) {
        throw new Error('GH_TOKEN is not defined');
    }
    let stats;
    try {
        stats = await getStats();
        console.info('Successfully fetched statistics from GitHub');
        console.info(JSON.stringify(stats, null, 2));
    } catch (e) {
        const wrapped = new Error(`cannot retrieve statistics: ${e.message}`);
        wrapped.cause = e;
        throw wrapped;
    }
    try {
        await updateGist(stats);
    } catch (e) {
        const wrapped = new Error(`cannot update gist: ${e.message}`);
        wrapped.cause = e;
        throw wrapped;
    }
}

async function getStats() {
    const response = await userInfoFetcher(githubToken);
    const payload = response && response.data;
    const graphqlErrors = formatGraphqlErrors(payload && payload.errors);
    if (graphqlErrors.length) {
        console.info('GraphQL returned partial errors:');
        for (const line of graphqlErrors) {
            console.info(`- ${line}`);
        }
    }

    const viewer = viewerFromPayload(payload);
    const stats = statsFromViewer(viewer);
    if (stats.skippedRepos > 0) {
        console.info(`Skipped ${stats.skippedRepos} inaccessible repository node(s) when summing stars`);
    }

    let commitsAreAllTime = false;
    if (countAllCommits) {
        if (!stats.login) {
            console.info('commit search skipped: viewer login is missing');
        } else {
            try {
                stats.totalCommits = await totalCommitsFetcher(stats.login, githubToken);
                commitsAreAllTime = true;
            } catch (error) {
                if (isRetryableFailure(error)) {
                    throw error;
                }
                console.info(
                    `commit search unavailable (${describeError(error)}); using contributionsCollection total`
                );
            }
        }
    }

    return {
        name: stats.name,
        totalPRs: stats.totalPRs,
        totalCommits: stats.totalCommits,
        totalIssues: stats.totalIssues,
        totalStars: stats.totalStars,
        contributedTo: stats.contributedTo,
        skippedRepos: stats.skippedRepos,
        commitsAreAllTime,
    };
}

async function updateGist(stats) {
    const humanize = (n) => (n >= 1000 ? numeral(n).format(kFormat ? '0.0a' : '0,0') : n);

    const gistContent =
        [
            ['⭐', `Total Stars`, humanize(stats.totalStars)],
            ['➕', stats.commitsAreAllTime ? 'Total Commits' : 'Past Year Commits', humanize(stats.totalCommits)],
            ['🔀', `Total PRs`, humanize(stats.totalPRs)],
            ['🚩', `Total Issues`, humanize(stats.totalIssues)],
            ['📦', `Contributed to`, humanize(stats.contributedTo)],
        ]
            .map((content) => {
                let line = `${content[1]}:${content[2]}`;
                line = line.replace(':', ':' + ' '.repeat(45 - line.length));
                line = `${content[0]}    ${line}`;
                return line;
            })
            .join('\n') + '\n';

    const gist = await githubRequest(
        {
            method: 'get',
            url: `https://api.github.com/gists/${gistId}`,
            headers: { Accept: 'application/vnd.github+json' },
        },
        githubToken
    );
    const files = gist.data && gist.data.files;
    if (!files || typeof files !== 'object') {
        throw new NonRetryableError('gist has no files');
    }
    const filename = Object.keys(files)[0];
    const gistFile = filename && files[filename];
    if (!gistFile) {
        throw new NonRetryableError('gist has no files');
    }

    if (gistFile.content === gistContent) {
        console.info('Nothing to update');
        return;
    }

    return githubRequest(
        {
            method: 'patch',
            url: `https://api.github.com/gists/${gistId}`,
            headers: { Accept: 'application/vnd.github+json' },
            data: {
                files: {
                    [filename]: {
                        filename: `${stats.name}'s GitHub Stats`,
                        content: gistContent,
                    },
                },
            },
        },
        githubToken
    ).then(() => {
        console.info(`Updated Gist ${gistId} with the following content:\n${gistContent}`);
    });
}

main().catch((err) => {
    console.error(err.message);
    process.exit(isRetryableFailure(err) ? 2 : 1);
});
