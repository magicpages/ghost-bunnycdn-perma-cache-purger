import fetch from 'node-fetch';

// This is a partial interface for the PullZone object,
// given that we only need the Name property.
interface IPullZone {
  Name: string;
}

export const getPullZone = async (pullZoneId: string, apiKey: string): Promise<IPullZone> => {
  const url = `https://api.bunny.net/pullzone/${pullZoneId}/`;
  const options = {
    method: 'GET',
    headers: {
      accept: 'application/json',
      AccessKey: apiKey,
    },
  };

  const response = await fetch(url, options);
  return await response.json() as IPullZone;
};

export const getPullZoneName = async (pullZoneId: string, apiKey: string) => {
  const pullZone = await getPullZone(pullZoneId, apiKey);

  return pullZone.Name;
};

export const listStorageZoneFiles = async (storageZoneName: string, path: string, apiKey: string) => {
  const url = `https://storage.bunnycdn.com/${storageZoneName}/${path || ''}/`;
  const options = {
    method: 'GET',
    headers: {
      accept: 'application/json',
      AccessKey: apiKey,
    },
  };

  const response = await fetch(url, options);
  return await response.json();
};

export const deleteStorageZoneFile = async (storageZoneName: string, path: string, fileName: string, apiKey: string) => {
  const url = `https://storage.bunnycdn.com/${storageZoneName}/${path}/${fileName}/`;
  const options = {
    method: 'DELETE',
    headers: {
      accept: 'application/json',
      AccessKey: apiKey,
    },
  };

  const response = await fetch(url, options);
  return await response.json();
};