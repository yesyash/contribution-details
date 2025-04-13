// Import the node-fetch library
const fetch = require('node-fetch');

// --- Configuration ---
// REQUIRED: Replace with your actual GitHub username
const GITHUB_USERNAME = 'YOUR_GITHUB_USERNAME';
// REQUIRED: Replace with the target GitHub organization name
const GITHUB_ORG = 'YOUR_GITHUB_ORG';
// REQUIRED: Replace with your GitHub Personal Access Token (PAT)
const GITHUB_TOKEN = 'YOUR_GITHUB_PAT'; // Keep this secure!

const START_DATE = '2024-04-01';
const END_DATE = '2025-04-01'; // Note: GitHub search range includes the start date but might be exclusive of the end date depending on time, so this effectively covers up to March 31st, 2025 23:59:59 UTC.
// --- End Configuration ---

// Validate configuration
if (
    GITHUB_USERNAME === 'YOUR_GITHUB_USERNAME' ||
    GITHUB_ORG === 'YOUR_GITHUB_ORG' ||
    GITHUB_TOKEN === 'YOUR_GITHUB_PAT'
) {
    console.error(
        '❌ Error: Please replace placeholder values for GITHUB_USERNAME, GITHUB_ORG, and GITHUB_TOKEN in the script.'
    );
    process.exit(1);
}

const API_BASE_URL = 'https://api.github.com';

/**
 * Fetches all pages for a given GitHub search query.
 * @param {string} searchQuery - The GitHub search query string.
 * @returns {Promise<Array>} - A promise that resolves to an array of found items.
 */
async function fetchAllPages(searchQuery) {
    let allItems = [];
    let page = 1;
    let hasNextPage = true;
    const perPage = 100; // Max items per page allowed by GitHub API

    console.log(`🚀 Starting GitHub PR search...`);
    console.log(`   Query: ${searchQuery}`);

    while (hasNextPage) {
        const url = `${API_BASE_URL}/search/issues?q=${encodeURIComponent(
            searchQuery
        )}&per_page=${perPage}&page=${page}`;

        console.log(`   Fetching page ${page}...`);

        try {
            const response = await fetch(url, {
                headers: {
                    Accept: 'application/vnd.github.v3+json',
                    Authorization: `token ${GITHUB_TOKEN}`,
                },
            });

            // Check rate limit status (optional but good practice)
            // const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
            // const rateLimitReset = new Date(response.headers.get('x-ratelimit-reset') * 1000);
            // console.log(`   Rate limit remaining: ${rateLimitRemaining}, resets at: ${rateLimitReset.toLocaleTimeString()}`);

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(
                    `GitHub API Error: ${response.status} ${
                        response.statusText
                    }\nResponse: ${errorBody}`
                );
            }

            const data = await response.json();

            if (data.items && data.items.length > 0) {
                allItems = allItems.concat(data.items);
            } else {
                // No more items found on this page
                hasNextPage = false;
            }

            // Check for 'next' link in the Link header (most reliable way)
            const linkHeader = response.headers.get('Link');
            if (!linkHeader || !linkHeader.includes('rel="next"')) {
                hasNextPage = false;
            }

            // Safety break in case Link header logic fails or too many results
            if (page >= 30) { // Limit to 30 pages (3000 results) as a safeguard
                if (hasNextPage) {
                    console.warn("⚠️ Warning: Reached page limit (30). Stopping pagination early.");
                    hasNextPage = false;
                }
            }

            page++;

        } catch (error) {
            console.error(`❌ Error fetching page ${page}:`, error.message);
            hasNextPage = false; // Stop trying on error
            throw error; // Re-throw to stop the script
        }
    }

    console.log(`✅ Finished fetching. Found ${allItems.length} total items matching query.`);
    return allItems;
}

/**
 * Main function to get and process PRs.
 */
async function main() {
    // Construct the search query for GitHub API
    // is:pr - Search only for Pull Requests
    // author:{username} - Filter by the author
    // org:{orgname} - Filter by the organization
    // created:{startDate}..{endDate} - Filter by creation date range
    const searchQuery = `is:pr author:${GITHUB_USERNAME} org:${GITHUB_ORG} created:${START_DATE}..${END_DATE}`;

    try {
        const searchResults = await fetchAllPages(searchQuery);

        // Process the results to extract needed info and filter/format
        const prList = searchResults
            .map((item) => {
                // The search API returns issue-like objects, PR info is nested
                // Check if it has pull_request data and when it was merged
                const mergedAt = item.pull_request?.merged_at; // Use optional chaining

                return {
                    title: item.title,
                    createdAt: item.created_at,
                    mergedAt: mergedAt ? mergedAt : null, // Store null if not merged
                    url: item.html_url,
                };
            });

        // Sort the list by mergedAt date (ascending). Unmerged PRs (null) go last.
        prList.sort((a, b) => {
            const dateA = a.mergedAt ? new Date(a.mergedAt) : null;
            const dateB = b.mergedAt ? new Date(b.mergedAt) : null;

            if (dateA === null && dateB === null) return 0; // Both unmerged, keep original relative order
            if (dateA === null) return 1; // a is unmerged, sort after b
            if (dateB === null) return -1; // b is unmerged, sort after a
            return dateA - dateB; // Both merged, sort by date
        });

        // Print the results
        console.log(
            `\n--- Pull Requests created by ${GITHUB_USERNAME} in ${GITHUB_ORG} from ${START_DATE} to ${END_DATE} ---`
        );
        console.log(`Total found: ${prList.length}\n`);

        if (prList.length === 0) {
            console.log('No matching pull requests found.');
        } else {
            prList.forEach((pr, index) => {
                console.log(`[${index + 1}]`);
                console.log(`  Title:      ${pr.title}`);
                console.log(`  Created At: ${new Date(pr.createdAt).toLocaleString()}`);
                console.log(`  Merged On:  ${pr.mergedAt ? new Date(pr.mergedAt).toLocaleString() : 'Not Merged'}`);
                console.log(`  URL:        ${pr.url}`);
                console.log('---');
            });
        }
    } catch (error) {
        console.error('\n❌ An error occurred during the process:');
        console.error(error.message);
        process.exit(1);
    }
}

// Run the main function
main();