import { Request } from 'express';
import { PrismaClient } from '@prisma/client/storage/client.js';
import { cryptographyUtil, HttpClientUtil, loggerUtil, BasicAndBearerStrategy, BearerStrategy } from '../../expressium/index.js';
import { IAccountMap, IDecryptedMap, IDwellerMap, IPhoneMap, IReceiverMap, IReqBody, IResponse, IResponseData } from './interfaces/index.js';

class WhatsAppService {
  private httpClientInstance: HttpClientUtil.HttpClient;

  constructor() {
    this.httpClientInstance = new HttpClientUtil.HttpClient();
  }

  async sendMessage(
    jid: string, 
    message: string
  ): Promise<void> {
    try {
      await this.httpClientInstance.post(
        `https://v5.chatpro.com.br/${ process.env.CHAT_PRO_INSTANCE_ID }/api/v1/send_message`,
        {
          number: jid,
          message
        },
        {
          headers: { Authorization: process.env.CHAT_PRO_BEARER_TOKEN },
          params: { instance_id: process.env.CHAT_PRO_INSTANCE_ID }
        }
      );
    } catch (error: unknown) {
      loggerUtil.error(error instanceof Error ? error.message : String(error));  
    }
  }
}

const CONTACT = '0800-062-1800';
const SUPPORTED_MESSAGE_TYPE = 'receveid_message';
const TEXT_REGEX = /AC:[a-zA-Z0-9]+(-[a-zA-Z0-9]+)?/;
const DWELLER_PAGE_SIZE = '10000';
const PHONE_REGEX = /\D/g;
const DWELLER_ACCESS_TYPE_EVENT_CODE = 'W417';
const DWELLER_ACCESS_TYPE_EVENT_ID = '167618000';
const WHITELIST_ACCESS_TYPE_EVENT_CODE = 'W417';
const WHITELIST_ACCESS_TYPE_EVENT_ID = '167618000';
const PROTOCOL_TYPE = 'CONTACT_ID';

const TEXT_MAP = {
  SERVICE_UNAVAILABLE: `⚠️ *Serviço Indisponível*\n\nTente novamente em alguns instantes ou entre em contato: ${ CONTACT }`,
  ACCESS_DENIED: `❎ *Acesso Negado*\n\nEste recurso requer autorização prévia para ser acessado.\n\nEntre em contato: ${ CONTACT }`,
  ACCESS_GRANTED: '✅ *Acesso Concedido*'
} as const;

const ACCESS_TYPE_MAP = { 
  DWELLER: 'wd',
  WHITELIST: 'ww' 
} as const;

const whatsAppServiceInstance = new WhatsAppService();
const prisma = new PrismaClient();

const createAccess = async (
  accountId: string,
  readerId: string,
  commandId: string,
  jid: string,
  receiverId: string,
  code: string,
  complement: string,
  eventId: string
): Promise<IResponse.IResponse<IResponseData.ICreateAccessThroughWhatsAppResponseData | IResponseData.IResponseData>> => { 
  const httpClientBasicAndBearerInstance = new HttpClientUtil.HttpClient();

  httpClientBasicAndBearerInstance.setAuthenticationStrategy(
    new BasicAndBearerStrategy.BasicAndBearerStrategy(
      'post',
      'https://cloud.segware.com.br/server/v2/auth',
      process.env.SIGMA_CLOUD_USERNAME as string, 
      process.env.SIGMA_CLOUD_PASSWORD as string,
      undefined,
      undefined,
      { type: 'WEB' },
      (response: Axios.AxiosXHR<string>): string => response.data
    )
  );

  await httpClientBasicAndBearerInstance.post<unknown>(`https://api.segware.com.br/v1/accounts/${ accountId }/readers/${ readerId }/commands/${ commandId }`);
  await whatsAppServiceInstance.sendMessage(jid, TEXT_MAP.ACCESS_GRANTED);

  loggerUtil.info(`Access granted — phone = "${ jid.split('@')[0] }", accountId = "${ accountId }", commandId = "${ commandId }", readerId = "${ readerId }", receiverId = "${ receiverId }"`);

  const httpClientBearerInstance = new HttpClientUtil.HttpClient();

  httpClientBearerInstance.setAuthenticationStrategy(new BearerStrategy.BearerStrategy(process.env.SIGMA_CLOUD_BEARER_TOKEN as string));
  
  try {
    const [accountMapResult, receiverMapResult] = await Promise.allSettled(
      [
        httpClientBearerInstance.get<IAccountMap.IAccountMap>(`https://api.segware.com.br/v5/accounts/${ accountId }`),
        httpClientBasicAndBearerInstance.get<IReceiverMap.IReceiverMap>(`https://api.segware.com.br/v1/accounts/${ accountId }/receivers/${ receiverId }`)
      ]
    );
  
    if (accountMapResult.status !== 'rejected' && accountMapResult.value.data) {
      if (receiverMapResult.status !== 'rejected' && receiverMapResult.value.data) {
        const accountMap = accountMapResult.value.data;
        const receiverMap = receiverMapResult.value.data;
    
        try {
          await httpClientBearerInstance.post<unknown>(
            'https://api.segware.com.br/v2/events/accessControl', 
            { 
              events: [
                {
                  account: accountMap.accountCode,
                  code,
                  companyId: accountMap.companyId,
                  complement,
                  eventId,
                  protocolType: PROTOCOL_TYPE,
                  receiverDescription: receiverMap.name
                }
              ] 
            }
          );
          
          await prisma.access_control_whatsapp_events.create(
            {
              data: {
                account: accountMap.accountCode,
                code,
                company_id: String(accountMap.companyId),
                complement,
                event_id: eventId,
                protocol_type: PROTOCOL_TYPE,
                receiver_description: receiverMap.name,
                status: 'sent'
              }
            }
          );
        } catch (error: unknown) {
          loggerUtil.error(error instanceof Error ? error.message : String(error)); 

          await prisma.access_control_whatsapp_events.create(
            {
              data: {
                account: accountMap.accountCode,
                code,
                company_id: String(accountMap.companyId),
                complement,
                event_id: eventId,
                protocol_type: PROTOCOL_TYPE,
                receiver_description: receiverMap.name,
                status: 'failed'
              }
            }
          );
        }
      } else {
        loggerUtil.warn(`Receiver map not found — phone = "${ jid.split('@')[0] }", accountId = "${ accountId }", receiverId = "${ receiverId }"`);
      }
    } else {
      loggerUtil.warn(`Account map not found — phone = "${ jid.split('@')[0] }", accountId = "${ accountId }"`);
    }
  } catch (error: unknown) {
    loggerUtil.error(error instanceof Error ? error.message : String(error)); 
  }

  return {
    status: 200,
    data: { data: 'OK' }
  };
};

const validateAccessThroughWhitelist = async (
  jid: string,
  name: string,
  accountId?: string,
  commandId?: string,
  readerId?: string,
  receiverId?: string
): Promise<IResponse.IResponse<IResponseData.ICreateAccessThroughWhatsAppResponseData | IResponseData.IResponseData>> => {
  if (!accountId || !commandId || !readerId || !receiverId) {
    await whatsAppServiceInstance.sendMessage(jid, TEXT_MAP.SERVICE_UNAVAILABLE);
    
    loggerUtil.warn(`Invalid or unexpected fields — phone = "${ jid.split('@')[0] }", accountId = "${ accountId }", commandId = "${ commandId }", readerId = "${ readerId }", receiverId = "${ receiverId }"`);

    return {
      status: 400,
      data: {
        message: 'Service Unavailable.',
        suggestion: `Please try again in a few moments or contact: ${ CONTACT }`
      }
    };
  }

  const accessControlWhitelistedTarget = await prisma.access_control_whitelisted_targets.findUnique(
    {
      select: { id: true },
      where: {
        account_id_command_id_reader_id_receiver_id: {
          account_id: accountId,
          command_id: commandId,
          reader_id: readerId,
          receiver_id: receiverId
        },
        is_access_control_whitelisted_target_active: true
      }
    }
  );

  if (!accessControlWhitelistedTarget) {
    await whatsAppServiceInstance.sendMessage(jid, TEXT_MAP.ACCESS_DENIED);
    
    loggerUtil.warn(`Access denied for whitelist validation — phone = "${ jid.split('@')[0] }", accountId = "${ accountId }", commandId = "${ commandId }", readerId = "${ readerId }", receiverId = "${ receiverId }"`);

    return {
      status: 401,
      data: {
        message: 'Access denied.',
        suggestion: `This feature requires prior authorization to be accessed. Contact us: ${ CONTACT }`
      }
    };
  }

  return await createAccess(
    accountId,
    readerId,
    commandId,
    jid, 
    receiverId,
    WHITELIST_ACCESS_TYPE_EVENT_CODE, 
    `Nome: ${ name }, Telefone: ${ jid.split('@')[0] }`,
    WHITELIST_ACCESS_TYPE_EVENT_ID
  );
};

const normalizeBrazilianPhone = (phone: string): string | null => {
  const cleanPhone = phone.slice(-11);
  const areaCodeInt = parseInt(cleanPhone.slice(0, 2));
  
  if (areaCodeInt < 11 && areaCodeInt > 99) {
    return null;
  }

  switch (cleanPhone.length) {
    case 11:
      if (cleanPhone[2] === '9') {
        return cleanPhone.slice(0, 2) + cleanPhone.slice(3);
      }

      return null;

    case 10:
      return cleanPhone;

    default:
      return null;
  }
};

const validateAccessThroughDweller = async (
  jid: string,
  name: string,
  accountId?: string,
  commandId?: string,
  readerId?: string,
  receiverId?: string
): Promise<IResponse.IResponse<IResponseData.ICreateAccessThroughWhatsAppResponseData | IResponseData.IResponseData>> => {
  if (!accountId || !commandId || !readerId || !receiverId) {
    await whatsAppServiceInstance.sendMessage(jid, TEXT_MAP.SERVICE_UNAVAILABLE);
    
    loggerUtil.warn(`Invalid or unexpected fields — phone = "${ jid.split('@')[0] }", accountId = "${ accountId }", commandId = "${ commandId }", readerId = "${ readerId }", receiverId = "${ receiverId }"`);

    return {
      status: 400,
      data: {
        message: 'Service Unavailable.',
        suggestion: `Please try again in a few moments or contact: ${ CONTACT }`
      }
    };
  }

  const httpClientInstance = new HttpClientUtil.HttpClient();
  const cleanJidCountryCode = jid.split('@')[0].replace(PHONE_REGEX, '').slice(0, 2);
  const cleanJidWithoutContryCode = jid.split('@')[0].replace(PHONE_REGEX, '').slice(2);

  let page = 0;

  httpClientInstance.setAuthenticationStrategy(new BearerStrategy.BearerStrategy(process.env.SIGMA_CLOUD_BEARER_TOKEN as string));

  while (true) {
    const dwellerMapList = (await httpClientInstance.get<{ content: IDwellerMap.IDwellerMap[]; lastPage: boolean; }>(`https://api.segware.com.br/v5/accounts/${ accountId }/dwellers?page=${ page }&pageSize=${ DWELLER_PAGE_SIZE }`)).data;
    
    const isDweller = dwellerMapList.content.some(
      (dwellerMap: IDwellerMap.IDwellerMap): boolean => {
        return dwellerMap.phones.some(
          (phoneMap: IPhoneMap.IPhoneMap): boolean => {
            const cleanPhoneWithoutCountryCode = phoneMap.phone.replace(/\D/g, '').slice(2)

            switch (cleanJidCountryCode) {
              case '55':
                return cleanJidWithoutContryCode === normalizeBrazilianPhone(cleanPhoneWithoutCountryCode);

              default:
                return cleanJidWithoutContryCode === phoneMap.phone;
            }
          }
        )
      }
    );

    if (isDweller) {
      return await createAccess(
        accountId,
        readerId,
        commandId,
        jid,
        receiverId,
        DWELLER_ACCESS_TYPE_EVENT_CODE, 
        `Nome: ${ name }, Telefone: ${ jid.split('@')[0] }`,
        DWELLER_ACCESS_TYPE_EVENT_ID
      );
    }

    if (dwellerMapList.lastPage) {
      break;
    }

    page += 1;
  }

  await whatsAppServiceInstance.sendMessage(jid, TEXT_MAP.ACCESS_DENIED);

  loggerUtil.info(`Access denied for dweller validation — phone = "${ jid.split('@')[0] }", accountId = "${ accountId }", commandId = "${ commandId }", readerId = "${ readerId }", receiverId = "${ receiverId }"`);

  return {
    status: 403,
    data: {
      message: 'Access denied.',
      suggestion: `This feature requires prior authorization to be accessed. Contact us: ${ CONTACT }`
    }
  };
};

const decryptMap = (encryptedMap: string): IDecryptedMap.IDecryptedMap | null => {
  try {
    return JSON.parse(
      cryptographyUtil.decryptFromAes256Cbc(
        process.env.WHATSAPP_DATA_ENCRYPTION_KEY as string,
        process.env.WHATSAPP_DATA_IV_STRING as string,
        encryptedMap
      )
    );
  } catch (error: unknown) {
    loggerUtil.error(error instanceof Error ? error.message : String(error));

    return null;
  }
};

const processWhatsAppMessage = async (body: IReqBody.ICreateAccessThroughWhatsAppReqBody['Body']): Promise<IResponse.IResponse<IResponseData.ICreateAccessThroughWhatsAppResponseData | IResponseData.IResponseData>> => {
  const template = body?.Text?.match(TEXT_REGEX)?.[0];

  if (!template) {
    loggerUtil.debug(`Invalid or unexpected template — template = "${ template }"`);
    
    return {
      status: 422,
      data: {
        message: 'Invalid message format received.',
        suggestion: 'Expected message format: "AC:ACCESS_TYPE(-ARGUMENT_A?)"'
      }
    };
  }

  try {
    const [accessType, argumentA] = template.split(':')[1].split('-');

    let decryptedMap: IDecryptedMap.IDecryptedMap | null;

    switch (accessType) {
      case ACCESS_TYPE_MAP.DWELLER:
        if (!argumentA) {
          await whatsAppServiceInstance.sendMessage(body.Info.SenderJid, TEXT_MAP.SERVICE_UNAVAILABLE);
          
          loggerUtil.warn(`Invalid or unexpected argumentA — argumentA = "${ argumentA }"`);
      
          return {
            status: 422,
            data: {
              message: 'Service Unavailable.',
              suggestion: `Please try again in a few moments or contact: ${ CONTACT }`
            }
          };
        }

        decryptedMap = decryptMap(argumentA);
  
        if (!decryptedMap) {
          await whatsAppServiceInstance.sendMessage(body.Info.SenderJid, TEXT_MAP.SERVICE_UNAVAILABLE);
      
          return {
            status: 422,
            data: {
              message: 'Service Unavailable.',
              suggestion: `Please try again in a few moments or contact: ${ CONTACT }`
            }
          };
        }

        return await validateAccessThroughDweller(
          body.Info.SenderJid,
          body.Info.PushName,
          decryptedMap.accountId,
          decryptedMap.commandId,
          decryptedMap.readerId,
          decryptedMap.receiverId
        );

      case ACCESS_TYPE_MAP.WHITELIST:
        if (!argumentA) {
          await whatsAppServiceInstance.sendMessage(body.Info.SenderJid, TEXT_MAP.SERVICE_UNAVAILABLE);
          
          loggerUtil.warn(`Invalid or unexpected argumentA — argumentA = "${ argumentA }"`);
      
          return {
            status: 422,
            data: {
              message: 'Service Unavailable.',
              suggestion: `Please try again in a few moments or contact: ${ CONTACT }`
            }
          };
        }

        decryptedMap = decryptMap(argumentA);
  
        if (!decryptedMap) {
          await whatsAppServiceInstance.sendMessage(body.Info.SenderJid, TEXT_MAP.SERVICE_UNAVAILABLE);
      
          return {
            status: 422,
            data: {
              message: 'Service Unavailable.',
              suggestion: `Please try again in a few moments or contact: ${ CONTACT }`
            }
          };
        }
  
        return await validateAccessThroughWhitelist(
          body.Info.SenderJid,
          body.Info.PushName,
          decryptedMap.accountId,
          decryptedMap.commandId,
          decryptedMap.readerId,
          decryptedMap.receiverId
        );
  
      default:
        await whatsAppServiceInstance.sendMessage(body.Info.SenderJid, TEXT_MAP.SERVICE_UNAVAILABLE);
        
        loggerUtil.debug(`Invalid or unexpected accessType — accessType = "${ argumentA }"`);

        return {
          status: 422,
          data: {
            message: 'Service Unavailable.',
            suggestion: `Please try again in a few moments or contact: ${ CONTACT }`
          }
        };
    }
  } catch (error: unknown) {
    await whatsAppServiceInstance.sendMessage(body.Info.SenderJid, TEXT_MAP.SERVICE_UNAVAILABLE);
    
    loggerUtil.error(error instanceof Error ? error.message : String(error));

    return {
      status: 500,
      data: {
        message: 'The access creation process through WhatsApp encountered a technical issue.',
        suggestion: 'Please try again later or contact support if the issue persists.'
      }
    };
  }
};

export const createAccessThroughWhatsApp = async (req: Request): Promise<IResponse.IResponse<IResponseData.ICreateAccessThroughWhatsAppResponseData | IResponseData.IResponseData>> => {
  const { Body, Type } = req.body as IReqBody.ICreateAccessThroughWhatsAppReqBody;

  if (Type !== SUPPORTED_MESSAGE_TYPE) {
    loggerUtil.debug(`Invalid or unexpected Type — Type = "${ Type }"`);

    return {
      status: 415,
      data: {
        message: 'Unsupported message type received.',
        suggestion: `Expected message type: "${ SUPPORTED_MESSAGE_TYPE }", received: "${ Type }"`
      }
    };
  }
  
  return await processWhatsAppMessage(Body);
};
