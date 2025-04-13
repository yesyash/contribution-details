# Contribution details
- A script to get details of all the prs created by you in a github organization.

## Steps to setup repository locally
1. `npm i` to install packages.
2. `cp .env.sample .env` to create a env file.
    2.1 Add your github username, pat token and the organization you want to fetch pr details from

### Running the script
1. Run `npm main.js` in your temrinal to run the script.
    Once completed list of prs for each repo will be available in the `github_prs_by_repo` folder.

### Steps to get a GitHub Personal Access Token (PAT):
1. Go to your GitHub Settings -> Developer settings -> Personal access tokens -> Tokens (classic).
2. Click "Generate new token" (or "Generate new token (classic)").
3. Give it a descriptive name (e.g., "PR Script").
4. Set an expiration date.
5. Under "Select scopes", check the repo scope (or at least public_repo if you only need public repositories within the org).
6. Click "Generate token".
7. Copy the token immediately! You won't be able to see it again. Treat it like a password.