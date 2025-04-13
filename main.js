// --- Setup ---
require('dotenv').config(); // Load environment variables from .env file FIRST
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// --- Configuration from Environment Variables ---
const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
const GITHUB_ORG = process.env.GITHUB_ORG;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const START_DATE = '2024-04-01';
const END_DATE = '2025-04-01';
// Directory where repository-specific files will be created
const OUTPUT_DIR = 'github_prs_by_repo';
const API_BASE_URL = 'https://api.github.com';
const DETAIL_FETCH_DELAY_MS = 50; // Delay between fetching PR details
// --- End Configuration ---

// --- Validate Environment Variables ---
const requiredEnvVars = { GITHUB_USERNAME, GITHUB_ORG, GITHUB_TOKEN };
const missingEnvVars = Object.entries(requiredEnvVars)
    .filter(([key, value]) => !value)
    .map(([key]) => key);

if (missingEnvVars.length > 0) {
    console.error(
        `❌ Error: Missing required environment variables: ${missingEnvVars.join(', ')}.`
    );
    console.error('   Please ensure they are set in your .env file or environment.');
    process.exit(1);
}
// --- End Validation ---

// Helper function for adding delays
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetches all pages for a given GitHub search query.
 * (Keep the fetchAllPages function from the previous version)
 * @param {string} searchQuery
 * @returns {Promise<Array>}
 */
async function fetchAllPages(searchQuery) {
    let allItems = [];
    let page = 1;
    let hasNextPage = true;
    const perPage = 100;

    console.log(`🚀 Starting GitHub PR search...`);
    console.log(`   Query: ${searchQuery}`);

    while (hasNextPage) {
        const url = `${API_BASE_URL}/search/issues?q=${encodeURIComponent(
            searchQuery
        )}&per_page=${perPage}&page=${page}`;

        console.log(`   Fetching search results page ${page}...`);

        try {
            const response = await fetch(url, {
                headers: {
                    Accept: 'application/vnd.github.v3+json',
                    Authorization: `token ${GITHUB_TOKEN}`,
                    'User-Agent': 'Node.js PR Repo Grouper Script',
                },
            });

            if (!response.ok) {
                const errorBody = await response.text();
                 if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
                     const rateLimitReset = new Date(response.headers.get('x-ratelimit-reset') * 1000);
                     console.error(`❌ Rate limit exceeded during search. Try again after ${rateLimitReset.toLocaleTimeString()}.`);
                 }
                throw new Error(
                    `GitHub API Error (Search): ${response.status} ${
                        response.statusText
                    }\nResponse: ${errorBody}`
                );
            }

            const data = await response.json();

            if (data.items && data.items.length > 0) {
                allItems = allItems.concat(data.items);
                 console.log(`   Found ${data.items.length} items on page ${page}. Total so far: ${allItems.length}`);
            } else {
                hasNextPage = false;
            }

            const linkHeader = response.headers.get('Link');
            if (!linkHeader || !linkHeader.includes('rel="next"')) {
                hasNextPage = false;
            }

            if (page >= 30) { // Safety break
                if (hasNextPage) {
                    console.warn("⚠️ Warning: Reached page limit (30) for search results. Stopping pagination early.");
                    hasNextPage = false;
                }
            }
            page++;

        } catch (error) {
            console.error(`❌ Error fetching search page ${page}:`, error.message);
            hasNextPage = false;
            throw error;
        }
    }
    console.log(`✅ Finished search. Found ${allItems.length} total PRs matching query.`);
    return allItems;
}


/**
 * Fetches detailed information for a single PR, including its body.
 * (Keep the fetchPrDetails function from the previous version)
 * @param {string} owner
 * @param {string} repo
 * @param {number} pullNumber
 * @returns {Promise<object|null>}
 */
async function fetchPrDetails(owner, repo, pullNumber) {
    const url = `${API_BASE_URL}/repos/${owner}/${repo}/pulls/${pullNumber}`;
    // console.log(`      Fetching details for PR #${pullNumber} in ${owner}/${repo}...`);

    try {
        const response = await fetch(url, {
            headers: {
                Accept: 'application/vnd.github.v3+json',
                Authorization: `token ${GITHUB_TOKEN}`,
                'User-Agent': 'Node.js PR Repo Grouper Script',
            },
        });

        if (!response.ok) {
            if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
                const rateLimitReset = new Date(response.headers.get('x-ratelimit-reset') * 1000);
                console.error(`❌ Rate limit exceeded while fetching details for PR #${pullNumber}. Try again after ${rateLimitReset.toLocaleTimeString()}.`);
            } else if (response.status === 404) {
                console.warn(`⚠️ Could not find PR #${pullNumber} at ${url}. Skipping.`);
                return null;
            }
            throw new Error(
                `GitHub API Error (PR Detail ${pullNumber}): ${response.status} ${response.statusText}`
            );
        }
        return await response.json();

    } catch (error) {
        console.error(`❌ Error fetching details for PR #${pullNumber} in ${owner}/${repo}:`, error.message);
        return null;
    }
}

/**
 * Formats the PR list for a specific repository into a string for file output.
 * @param {string} repoName - The name of the repository.
 * @param {Array} prList - The sorted list of PR objects for this repo.
 * @returns {string} - The formatted string.
 */
function formatRepoPrListForFile(repoName, prList) {
    let outputString = `--- Pull Requests by ${GITHUB_USERNAME} in Repository: ${repoName} ---\n`;
    outputString += `--- Period: ${START_DATE} to ${END_DATE} ---\n`;
    outputString += `Total in this repo: ${prList.length}\n`;
    outputString += `Generated on: ${new Date().toLocaleString()}\n\n`;
    outputString += `==================================================\n`;

    if (prList.length === 0) {
        outputString += 'No matching pull requests found in this repository for the period.\n'; // Should not happen if called correctly, but good practice
    } else {
        prList.forEach((pr, index) => {
            outputString += `[${index + 1}]\n`;
            outputString += `  Title:        ${pr.title}\n`;
            outputString += `  Created At:   ${new Date(pr.createdAt).toLocaleString()}\n`;
            outputString += `  Merged On:    ${pr.mergedAt ? new Date(pr.mergedAt).toLocaleString() : 'Not Merged'}\n`;
            outputString += `  URL:          ${pr.url}\n`;
            outputString += `  Description:\n${pr.description ? pr.description.split('\n').map(line => `    ${line}`).join('\n') : '    (No description provided or failed to fetch)'}\n`;
            outputString += `--------------------------------------------------\n`;
        });
    }
    return outputString;
}

/**
 * Parses owner and repo name from a GitHub repository URL.
 * @param {string} repoUrl - The repository URL (e.g., https://api.github.com/repos/owner/repo-name)
 * @returns {{owner: string|null, repoName: string|null}}
 */
function parseRepoUrl(repoUrl) {
    try {
        const url = new URL(repoUrl);
        const pathParts = url.pathname.split('/').filter(Boolean); // Filter removes empty strings from leading/trailing slashes
        if (pathParts.length >= 3 && pathParts[0] === 'repos') {
            return { owner: pathParts[1], repoName: pathParts[2] };
        }
    } catch (e) {
        console.error(`Error parsing repository URL: ${repoUrl}`, e);
    }
    return { owner: null, repoName: null };
}


/**
 * Main function to get, process, group, and write PRs.
 */
async function main() {
    const searchQuery = `is:pr author:${GITHUB_USERNAME} org:${GITHUB_ORG} created:${START_DATE}..${END_DATE}`;
    // Use an object to group PRs by repository name
    const groupedPrs = {};

    try {
        const searchResults = await fetchAllPages(searchQuery);

        if (searchResults.length === 0) {
            console.log("No PRs found matching the search criteria.");
            return; // Exit early if nothing found
        }

        console.log(`\n🔍 Fetching details for ${searchResults.length} PRs... (May take time)`);
        let processedCount = 0;

        // Fetch details and populate the groupedPrs object
        for (const item of searchResults) {
            processedCount++;
            const { owner, repoName } = parseRepoUrl(item.repository_url);

            if (!owner || !repoName) {
                console.warn(`⚠️ Could not parse owner/repo from URL: ${item.repository_url}. Skipping PR #${item.number}.`);
                continue; // Skip this PR if we can't identify the repo
            }

            // Log progress
            if (processedCount % 10 === 0 || processedCount === searchResults.length) {
                console.log(`   Processing PR ${processedCount} of ${searchResults.length} (#${item.number} in ${owner}/${repoName})...`);
            }

            const prDetails = await fetchPrDetails(owner, repoName, item.number);

            // Prepare the PR data object
            const prData = {
                title: item.title,
                repoName: repoName, // Store the repo name
                createdAt: item.created_at,
                mergedAt: prDetails?.merged_at || item.pull_request?.merged_at || null,
                url: item.html_url,
                description: prDetails?.body || null,
            };

            // Add the PR data to the correct group
            if (!groupedPrs[repoName]) {
                groupedPrs[repoName] = []; // Initialize array if repo seen for the first time
            }
            groupedPrs[repoName].push(prData);

            // Delay
            if (DETAIL_FETCH_DELAY_MS > 0) {
                await delay(DETAIL_FETCH_DELAY_MS);
            }
        }
        console.log(`✅ Finished fetching details and grouping PRs.`);

        // --- Process and Write Files ---
        console.log(`\n💾 Writing PR lists to separate files in '${OUTPUT_DIR}' directory...`);

        // Ensure the output directory exists
        const outputDirPath = path.join(__dirname, OUTPUT_DIR);
        try {
            if (!fs.existsSync(outputDirPath)) {
                fs.mkdirSync(outputDirPath, { recursive: true });
                console.log(`   Created output directory: ${outputDirPath}`);
            }
        } catch (mkdirError) {
            console.error(`❌ Error creating output directory '${outputDirPath}':`, mkdirError);
            throw mkdirError; // Stop if we can't create the directory
        }


        let filesWritten = 0;
        // Iterate over each repository group
        for (const [repoName, prList] of Object.entries(groupedPrs)) {
            if (prList.length === 0) continue; // Skip if a repo somehow ended up with no PRs

            // 1. Sort PRs within this repository group by mergedAt date
            prList.sort((a, b) => {
                const dateA = a.mergedAt ? new Date(a.mergedAt) : null;
                const dateB = b.mergedAt ? new Date(b.mergedAt) : null;
                if (dateA === null && dateB === null) return 0;
                if (dateA === null) return 1;
                if (dateB === null) return -1;
                return dateA - dateB;
            });

            // 2. Format the content for this repository's file
            const fileContent = formatRepoPrListForFile(repoName, prList);

            // 3. Determine the filename (sanitize if needed, though repo names are usually safe)
            const safeRepoName = repoName.replace(/[/\\?%*:|"<>]/g, '-'); // Basic sanitization
            const outputFilename = `${safeRepoName}_prs_${START_DATE}_to_${END_DATE}.txt`;
            const outputFilePath = path.join(outputDirPath, outputFilename);

            // 4. Write the file
            try {
                fs.writeFileSync(outputFilePath, fileContent, 'utf8');
                console.log(`   ✅ Successfully wrote: ${outputFilename} (${prList.length} PRs)`);
                filesWritten++;
            } catch (writeError) {
                console.error(`   ❌ Error writing file ${outputFilename}:`, writeError);
            }
        }

        console.log(`\n✨ Process complete. ${filesWritten} repository file(s) written to '${OUTPUT_DIR}'.`);

    } catch (error) {
        console.error('\n❌ An critical error occurred during the process:');
        if (error.message) {
            console.error(error.message);
        } else {
            console.error(error);
        }
        process.exit(1);
    }
}

// Run the main function
main();