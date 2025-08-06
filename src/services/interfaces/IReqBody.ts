export interface ICreateAccessThroughWhatsAppReqBody {
  Body: {
    Info: {
      PushName: string;
      SenderJid: string;
    };
    Text: string;
  };
  Type: string;
}
