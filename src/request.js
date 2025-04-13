import fetch from 'node-fetch';

export const handleResponse = response => {
  if (response.ok || response.status === 304) {
    return response.json();
  }
  throw new Error(`HTTP ${response.status}: ${response.statusText}`);
};

export default async function apiRequest(token, endpoint, options = {}) {
  const maxRetries = 3;
  const baseDelay = 1000;
  let attempt = 0;

  // Add pagination parameters to URL if they exist
  const url = new URL(`https://api.groupme.com/v3/${endpoint}`);
  if (options.page) {
    url.searchParams.append('page', options.page);
  }
  if (options.per_page) {
    url.searchParams.append('per_page', options.per_page);
  }

  while (attempt < maxRetries) {
    const response = await fetch(url.toString(), {
      headers: {
        'X-Access-Token': token,
        'Accept': 'application/json'
      },
      ...options
    });

    if (response.status === 429) {
      attempt++;
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`Rate limited, waiting ${delay/1000} seconds before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
    }

    // Check if the response is empty or invalid
    if (response.status === 304 || response.status === 404) {
      return { status: response.status, response: { messages: [] } };
    }

    return response;
  }

  throw new Error('Max retries exceeded');
}