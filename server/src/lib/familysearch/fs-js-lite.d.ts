declare module 'fs-js-lite' {
  interface FamilySearchOptions {
    environment: string;
    appKey: string;
    accessToken: string;
    saveAccessToken: boolean;
    tokenCookie: string;
    tokenCookiePath: string;
    maxThrottledRetries: number;
  }

  interface FamilySearchResponse {
    statusCode: number;
    data: unknown;
  }

  type FamilySearchCallback = (
    error: Error | null,
    response: FamilySearchResponse
  ) => void;

  class FamilySearch {
    constructor(options: FamilySearchOptions);
    get(url: string, callback: FamilySearchCallback): void;
  }

  export = FamilySearch;
}
