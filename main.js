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
const OUTPUT_FILENAME = 'github_prs_detailed_output.txt';
const API_BASE_URL = 'https://api.github.com';
// Delay between fetching PR details (in milliseconds) to help avoid rate limits
const DETAIL_FETCH_DELAY_MS = 50;
// --- End Configuration ---

// --- Validate Environment Variables ---
// (Keep the validation block from the previous version)
const requiredEnvVars = { GITHUB_USERNAME, GITHUB_ORG, GITHUB_TOKEN };
const missingEnvVars = Object.entries(requiredEnvVars)
    .filter(([key, value]) => !value)
    .map(([key]) => key);

if (missingEnvVars.length > 0) {
    console.error(
        `❌ Error: Missing required environment variables: ${missingEnvVars.join(', ')}.`
    );
    console.error(
        '   Please ensure they are set in your .env file or environment.'
    );
    console.error('   Example .env file contents:');
    console.error('   GITHUB_USERNAME=your_user');
    console.error('   GITHUB_ORG=your_org');
    console.error('   GITHUB_TOKEN=your_pat');
    process.exit(1);
}
// --- End Validation ---

// Helper function for adding delays
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetches all pages for a given GitHub search query.
 * (Keep the fetchAllPages function from the previous version - no changes needed here)
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
                    'User-Agent': 'Node.js PR Detail Fetcher Script',
                },
            });

            if (!response.ok) {
                const errorBody = await response.text();
                // Check for rate limit specific error
                if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
                     const rateLimitReset = new Date(response.headers.get('x-ratelimit-reset') * 1000);
                     console.error(`❌ Rate limit exceeded. Try again after ${rateLimitReset.toLocaleTimeString()}.`);
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

             // Safety break
            if (page >= 30) {
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
 * @param {string} owner - The repository owner (user or org).
 * @param {string} repo - The repository name.
 * @param {number} pullNumber - The PR number.
 * @returns {Promise<object|null>} - A promise resolving to the PR detail object or null on error.
 */
async function fetchPrDetails(owner, repo, pullNumber) {
    const url = `${API_BASE_URL}/repos/${owner}/${repo}/pulls/${pullNumber}`;
    // console.log(`      Fetching details for PR #${pullNumber} in ${owner}/${repo}...`); // Uncomment for verbose logging

    try {
        const response = await fetch(url, {
            headers: {
                Accept: 'application/vnd.github.v3+json',
                Authorization: `token ${GITHUB_TOKEN}`,
                'User-Agent': 'Node.js PR Detail Fetcher Script',
            },
        });

        if (!response.ok) {
             if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
                 const rateLimitReset = new Date(response.headers.get('x-ratelimit-reset') * 1000);
                 console.error(`❌ Rate limit exceeded while fetching details for PR #${pullNumber}. Try again after ${rateLimitReset.toLocaleTimeString()}.`);
             } else if (response.status === 404) {
                 console.warn(`⚠️ Could not find PR #${pullNumber} at ${url} (perhaps deleted or permissions issue).`);
                 return null; // Return null for not found
             }
            throw new Error(
                `GitHub API Error (PR Detail ${pullNumber}): ${response.status} ${response.statusText}`
            );
        }

        const prData = await response.json();
        return prData; // Return the full PR detail object

    } catch (error) {
        console.error(`❌ Error fetching details for PR #${pullNumber} in ${owner}/${repo}:`, error.message);
        return null; // Return null indicating failure
    }
}

/**
 * Formats the PR list into a string for file output.
 * @param {Array} prList - The sorted list of PR objects.
 * @returns {string} - The formatted string.
 */
function formatPrListForFile(prList) {
    let outputString = `--- Pull Requests created by ${GITHUB_USERNAME} in ${GITHUB_ORG} from ${START_DATE} to ${END_DATE} ---\n`;
    outputString += `Total found and processed: ${prList.length}\n`;
    outputString += `Generated on: ${new Date().toLocaleString()}\n\n`;
    outputString += `==================================================\n`;

    if (prList.length === 0) {
        outputString += 'No matching pull requests found or processed.\n';
    } else {
        prList.forEach((pr, index) => {
            outputString += `[${index + 1}]\n`;
            outputString += `  Title:        ${pr.title}\n`;
            outputString += `  Created At:   ${new Date(pr.createdAt).toLocaleString()}\n`;
            outputString += `  Merged On:    ${pr.mergedAt ? new Date(pr.mergedAt).toLocaleString() : 'Not Merged'}\n`;
            outputString += `  URL:          ${pr.url}\n`;
            outputString += `  Description:\n${pr.description ? pr.description.split('\n').map(line => `    ${line}`).join('\n') : '    (No description provided or failed to fetch)'}\n`; // Indent description
            outputString += `--------------------------------------------------\n`;
        });
    }
    return outputString;
}


/**
 * Main function to get and process PRs.
 */
async function main() {
    const searchQuery = `is:pr author:${GITHUB_USERNAME} org:${GITHUB_ORG} created:${START_DATE}..${END_DATE}`;
    let prList = [];

    try {
        const searchResults = await fetchAllPages(searchQuery);

        if (searchResults.length === 0) {
            console.log("No PRs found matching the search criteria.");
        } else {
            console.log(`\n🔍 Fetching details for ${searchResults.length} PRs... (This may take a while due to rate limits and delays)`);

            let processedCount = 0;
            // Fetch details for each PR sequentially with a delay
            for (const item of searchResults) {
                processedCount++;
                const repoUrlParts = item.repository_url.split('/');
                const owner = repoUrlParts[repoUrlParts.length - 2];
                const repo = repoUrlParts[repoUrlParts.length - 1];
                const pullNumber = item.number;

                // Optional: Log progress
                if (processedCount % 10 === 0 || processedCount === searchResults.length) {
                    console.log(`   Processing PR ${processedCount} of ${searchResults.length} (#${pullNumber} in ${owner}/${repo})...`);
                }

                const prDetails = await fetchPrDetails(owner, repo, pullNumber);

                prList.push({
                    title: item.title,
                    createdAt: item.created_at,
                    // Use merged_at from the detail fetch if available, otherwise fallback to search result
                    mergedAt: prDetails?.merged_at || item.pull_request?.merged_at || null,
                    url: item.html_url,
                    // Get the body (description) from the detailed fetch
                    description: prDetails?.body || null, // Store null if no body or detail fetch failed
                });

                // Add a delay to avoid hitting rate limits when fetching details
                if (DETAIL_FETCH_DELAY_MS > 0) {
                   await delay(DETAIL_FETCH_DELAY_MS);
                }
            }
             console.log(`✅ Finished fetching details for ${prList.length} PRs.`);
        }


        // Sort the list by mergedAt date (ascending). Unmerged PRs (null) go last.
        prList.sort((a, b) => {
            const dateA = a.mergedAt ? new Date(a.mergedAt) : null;
            const dateB = b.mergedAt ? new Date(b.mergedAt) : null;

            if (dateA === null && dateB === null) return 0;
            if (dateA === null) return 1;
            if (dateB === null) return -1;
            return dateA - dateB;
        });

        // Format the output for the file
        const fileContent = formatPrListForFile(prList);

        // Write the output to a file
        const outputFilePath = path.join(__dirname, OUTPUT_FILENAME);
        console.log(`\n💾 Writing output to: ${outputFilePath}`);
        try {
            fs.writeFileSync(outputFilePath, fileContent, 'utf8');
            console.log(`✅ Successfully wrote PR list to ${OUTPUT_FILENAME}`);
        } catch (writeError) {
            console.error(`❌ Error writing to file ${outputFilePath}:`, writeError);
        }

    } catch (error) {
        console.error('\n❌ An critical error occurred during the process:');
        // Don't log the full error object if it might contain sensitive info like the token in URLs
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