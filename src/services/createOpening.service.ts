import { NextFunction, Request, Response } from "express";
import { HttpClientUtil, BearerStrategy } from "../../expressium/src/index.js";
import { IAccountMap, IPartitionMap, IReqBody, IResponse, IResponseData } from "./interfaces/index.js";

const EVENT_ID = '167618000';
const PROTOCOL_TYPE = 'CONTACT_ID';

export const createOpening = async (
  req: Request, 
  _res: Response, 
  _next: NextFunction,
  timestamp: string
): Promise<IResponse.IResponse<IResponseData.ICreateOpeningResponseData | IResponseData.IResponseData>> => { 
  try {
    const { 
      accountId,
      code,
      complement,
      partitionId,
      receiverDescription,
      server
    } = req.body as IReqBody.IcreateOpeningReqBody;

    if (!accountId || !code || !complement || !partitionId || !receiverDescription || !server) {
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
          suggestion: 'Please provide all required fields: accountId, code, complement, partitionId, receiverDescription and server.'
        }
      };
    }

    const httpClientInstance = new HttpClientUtil.HttpClient();

    httpClientInstance.setAuthenticationStrategy(new BearerStrategy.BearerStrategy(process.env.SIGMA_CLOUD_BEARER_TOKEN as string));

    const accountMap = (await httpClientInstance.get<IAccountMap.IAccountMap>(`https://api.segware.com.br/v5/accounts/${ accountId }`)).data;

    if (!accountMap) {
      return {
        status: 404,
        data: {
          timestamp,
          status: false,
          statusCode: 404,
          method: req.method,
          path: req.originalUrl || req.url,
          query: req.query,
          headers: req.headers,
          body: req.body,
          message: 'Account not found.',
          suggestion: 'Please check the accountId and try again.'
        }
      };
    }

    const partitionMap = accountMap.partitions.find((partitionMap: IPartitionMap.IPartitionMap): boolean => partitionMap.id === partitionId);

    if (!partitionMap) {
      return {
        status: 404,
        data: {
          timestamp,
          status: false,
          statusCode: 404,
          method: req.method,
          path: req.originalUrl || req.url,
          query: req.query,
          headers: req.headers,
          body: req.body,
          message: 'Partition not found.',
          suggestion: 'Please check the partitionId and try again.'
        }
      };
    }
    
    httpClientInstance.clearAuthenticationStrategy();
    
    const response = await httpClientInstance.get<unknown>(`${ process.env.BASE_URL as string }:${ server }/conversor_get_post/portao/open/${ accountMap.accountCode }/${ parseInt(partitionMap.number, 10) }`);
    
    httpClientInstance.setAuthenticationStrategy(new BearerStrategy.BearerStrategy(process.env.SIGMA_CLOUD_BEARER_TOKEN as string));
    
    await httpClientInstance.post<unknown>(
      'https://api.segware.com.br/v2/events/accessControl', 
      { 
        events: [
          {
            account: accountMap.accountCode,
            code,
            companyId: accountMap.companyId,
            complement: `Nome da Partição: ${ partitionMap.description }, Complemento: ${ complement }`,
            eventId: EVENT_ID,
            partition: partitionMap.number,
            protocolType: PROTOCOL_TYPE,
            receiverDescription
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
