import fetch from 'node-fetch';

export const handleResponse = response => {
  if (response.ok) {
    return response.json();
  }
  throw new Error(response.status);
};

export default (token, path = '', options = {}) => {
  // Build the query string for pagination if options are provided
  const queryParams = new URLSearchParams();
  
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) {
      queryParams.append(key, value);
    }
  }
  
  // Append query params to path if they exist
  const queryString = queryParams.toString();
  const fullPath = queryString ? `${path}${path.includes('?') ? '&' : '?'}${queryString}` : path;
  
  const url = `https://api.groupme.com/v3/${fullPath}`;
  const requestOptions = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/47.0.2526.106 Safari/537.36',
      'Referer': 'https://app.groupme.com/chats',
      'X-Access-Token': token
    }
  };

  return fetch(url, requestOptions);
};