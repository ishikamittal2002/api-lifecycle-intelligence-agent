export interface ExtractedEndpoint {
  method: string;
  path: string;
  filePath: string;
  lineNumber: number;
  handlerName: string | null;
}

export interface ScanResult {
  repositoryPath: string;
  filesScanned: number;
  endpoints: ExtractedEndpoint[];
}
