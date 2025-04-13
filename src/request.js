import fetch from 'node-fetch';

export const handleResponse = response => {
  if (response.ok || response.status === 304) {
    return response.json();
  }
  throw new Error(`HTTP ${response.status}: ${response.statusText}`);
};

export default async function apiRequest(token, endpoint, options = {}) {
  const response = await fetch(`https://api.groupme.com/v3/${endpoint}`, {
    headers: {
      'X-Access-Token': token,
      'Accept': 'application/json'
    },
    ...options
  });

  // Consider both 200 and 304 as successful responses
  if (response.status !== 200 && response.status !== 304) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response;
}