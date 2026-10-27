<p align="center">
  <a href="https://gist.github.com/bokub/1cc900d92b9acc15786d7553b46a2cdf">
    <img src="https://raw.githubusercontent.com/bokub/github-stats-box/images/screenshot.png">
  </a>
  <h3 align="center">github-stats-box</h3>
  <p align="center">⚡️📌 Update a pinned gist to contain your GitHub stats</p>
</p>

---

## Prep work

1. Create a new public GitHub Gist (https://gist.github.com/new)
2. Create a GitHub token with an expiration date and copy it (https://github.com/settings/tokens)

    - **Classic PAT:** `gist` is required. Add `repo` only if you need stats from private repositories (`ALL_COMMITS=true` uses `GET /search/commits`).
    - **Fine-grained PAT:** Resource owner = your user. Repository access = **All repositories**.
      Every fine-grained token includes read-only access to **public** repositories. Extra repository permissions are required only for **private** resources ([permissions required for fine-grained personal access tokens](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens); [managing personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)).

      Always required:

      | Permission | Access | Used for |
      | --- | --- | --- |
      | **Metadata** (repository) | Read-only | Mandatory. Stars use GraphQL `stargazerCount` (REST equivalent: `GET /repos/{owner}/{repo}/stargazers/count`). |
      | **Gists** (account) | Read and write | Update the pinned gist (`PATCH /gists/{gist_id}`). The token form only offers Gists as write (`gists=write`), which includes read. |

      Add these **read-only** repository permissions to include **private** commits, PRs, and issues (public counts work without them):

      | Permission | Access | Private data it includes |
      | --- | --- | --- |
      | **Contents** | Read-only | Private commits (`GET /repos/{owner}/{repo}/commits`). Needed so GraphQL `contributionsCollection` and `ALL_COMMITS` search can see commits in private repos. |
      | **Pull requests** | Read-only | Private pull requests (`GET /repos/{owner}/{repo}/pulls`; GraphQL `viewer.pullRequests`). |
      | **Issues** | Read-only | Private issues (`GET /repos/{owner}/{repo}/issues`). GraphQL uses the same `issues:read` permission to read issues in repositories the token can access ([forming GraphQL calls](https://docs.github.com/en/graphql/guides/forming-calls-with-graphql)). |

      Without Contents / Pull requests / Issues, the gist still updates, but those three totals are public-only.

      Other notes:

      - Stars come from GraphQL `stargazerCount` (metadata). The `stargazers` connection is not queried: GitHub restricts that list, and because the field is non-null, a FORBIDDEN on it would null the whole repository node and drop the star count.
      - Remaining GraphQL errors are logged as a compact count per type/message (no tokens, headers, env, or repository names). Null nodes, if any, are still skipped.
      - A user-owned token cannot count organization-owned repositories (this query uses `ownerAffiliations: OWNER`). One fine-grained token can target only a single resource owner.
      - `GET /search/commits` is [available to fine-grained tokens](https://docs.github.com/en/rest/authentication/endpoints-available-for-fine-grained-personal-access-tokens) but is **not** listed under Contents in the permissions table. Search [returns only repositories the token can access](https://docs.github.com/en/rest/search/search#access-errors-or-missing-search-results). If `ALL_COMMITS=true` and search is forbidden, the gist uses last-year GraphQL totals and labels the line **Past Year Commits** instead of failing.

## Project setup

1. Fork this repository
2. From your new fork, go to **Settings > Secrets**
3. Add the following secret using the **New secret** button:

    - **GH_TOKEN:** The GitHub token generated above.

4. Go to the **Actions** tab of your fork and click the "enable" button
5. Edit the environment variables in `.github/workflows/run.yml` (the `Update gist` step)

    - **GIST_ID:** The ID portion from your gist url: `https://gist.github.com/bokub/`**`1cc900d92b9acc15786d7553b46a2cdf`**.
    - **ALL_COMMITS:** Boolean value, If `true` it will count all commits instead of last year commits
    - **K_FORMAT:** Boolean value, If `true`, large numbers values will be formatted with a "k", for example `1.5k`

That's it! You gist will be updated immediately, and every 12 hours after that
