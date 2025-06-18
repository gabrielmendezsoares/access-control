import { NextFunction, Request, Response } from "express";
import { HttpClientUtil, BasicAndBearerStrategy, BearerStrategy } from "../../expressium/src/index.js";
import { IReqBody, IResponse, IResponseData } from "../interfaces/index.js";

const EVENT_ID = '167618000';
const CODE = 'H417';
const PROTOCOL_TYPE = 'CONTACT_ID';

export const createOpening = async (
  req: Request, 
  _res: Response, 
  _next: NextFunction,
  timestamp: string
): Promise<IResponse.IResponse<IResponseData.ICreateOpeningResponseData | IResponseData.IResponseData>> => { 
  try {
    const { 
      account,
      companyId,
      complement,
      partition,
      server
    } = req.body as IReqBody.IcreateOpeningReqBody;

    if (!account || !companyId || !complement || !partition || !server) {
      return {
        status: 400,
        data: {
          timestamp,
          status: false,
          statusCode: 400,
          method: req.method,
          path: req.originalUrl || req.url,
          query: req.query,
          headers: req.headers,
          body: req.body,
          message: 'Missing required fields.',
          suggestion: 'Please provide all required fields: account, companyId, complement, partition and server.'
        }
      };
    }

    const httpClientInstance = new HttpClientUtil.HttpClient();

    const response = await httpClientInstance.get<unknown>(`${ process.env.BASE_URL as string }:${ server }/conversor_get_post/portao/open/${ account }/${ partition }`);

    httpClientInstance.setAuthenticationStrategy(new BearerStrategy.BearerStrategy(process.env.SIGMA_CLOUD_BEARER_TOKEN as string));
    
    await httpClientInstance.post<unknown>(
      'https://api.segware.com.br/v2/events/accessControl', 
      { 
        events: [
          {
            account,
            code: CODE,
            companyId,
            complement,
            eventId: EVENT_ID,
            partition,
            protocolType: PROTOCOL_TYPE
          }
        ] 
      }
    );

    return {
      status: 200,
      data: {    
        timestamp,
        status: true,
        statusCode: 200,
        method: req.method,
        path: req.originalUrl || req.url,
        query: req.query,
        headers: req.headers,
        body: req.body,
        data: response.data
      }
    };
  } catch (error: unknown) {
    console.log(`Error | Timestamp: ${ timestamp } | Path: src/services/createOpening.service.ts | Location: createOpening | Error: ${ error instanceof Error ? error.message : String(error) }`);

    return {
      status: 500,
      data: {
        timestamp,
        status: false,
        statusCode: 500,
        method: req.method,
        path: req.originalUrl || req.url,
        query: req.query,
        headers: req.headers,
        body: req.body,
        message: 'Something went wrong.',
        suggestion: 'Please try again later. If this issue persists, contact our support team for assistance.'
      }
    };
  }
};
