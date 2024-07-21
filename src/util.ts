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

// This is the minified maintenance page HTML from Ghost
// @See: https://github.com/TryGhost/Ghost/blob/v5.88.1/ghost/core/core/server/views/maintenance.html
export const errorHtml = `<!doctypehtml><meta charset=utf-8><meta content="IE=edge"http-equiv=X-UA-Compatible><meta content="width=device-width,initial-scale=1"name=viewport><title>We'll be right back</title><style>*{box-sizing:border-box}html{font-size:62.5%;background:#f1f2f3;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent}body{display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;width:100vw;margin:0;padding:4vmin;color:#15171a;font-size:2rem;line-height:1.4em;font-family:sans-serif;background:#f1f2f3;scroll-behavior:smooth;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}::selection{text-shadow:none;background:#cbeafb}.content{display:flex;flex-direction:column;justify-content:center;max-width:500px;min-height:360px;margin:0 0 4vmin;padding:40px;text-align:center;background:#fff;border-radius:20px;box-shadow:0 50px 100px -20px rgb(50 50 93 / 8%),0 30px 60px -30px rgb(0 0 0 / 13%),0 10px 20px -10px rgb(0 0 0 / 8%)}h1{margin:0 0 .3em;font-size:4rem;line-height:1em;font-weight:700;letter-spacing:-.02em}p{margin:0;opacity:.7;font-weight:400}img{display:block;margin:0 auto 40px}@media (max-width:500px){body{font-size:1.8rem}h1{font-size:3.4rem}}</style><div class=content><h1>We'll be right back.</h1><p>We're busy updating our site to give you the best experience, and will be back soon.</div>`;

export interface FileDetail {
    Guid: string,
    StorageZoneName: string,
    Path: string,
    ObjectName: string,
    Length: number,
    LastChanged: string,
    ServerId: number,
    ArrayNumber: number,
    IsDirectory: boolean,
    UserId: string,
    ContentType: string,
    DateCreated: string,
    StorageZoneId: number,
    Checksum: string | null,
    ReplicatedZones: string[] | null,
  }