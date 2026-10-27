'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { USER_INFO_QUERY } = require('../fetch');

describe('USER_INFO_QUERY', () => {
    it('requests stargazerCount and does not select the stargazers connection', () => {
        assert.match(USER_INFO_QUERY, /stargazerCount/);
        assert.equal(/\bstargazers\s*\{/.test(USER_INFO_QUERY), false);
    });
});
