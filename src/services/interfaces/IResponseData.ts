export interface IResponseData {
  message: string;
  suggestion: string;
}

export interface ICreateAccessThroughWhatsAppResponseData {
  data: string;
}

export interface IGetHealthResponseData {
  monitor: {
    cpuUsage: {
      name: string;
      value: string;
    };
    memoryUsage: {
      name: string;
      value: string;
    };
    port: {
      name: string;
      value: string;
    };
    logLevel: {
      name: string;
      value: string;
    };
  };
}
