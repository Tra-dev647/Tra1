declare module "bakong-khqr" {
  export const khqrData: any;
  export class IndividualInfo {
    constructor(...args: any[]);
  }
  export class MerchantInfo {
    constructor(...args: any[]);
  }
  export class BakongKHQR {
    constructor(...args: any[]);
    generateIndividual(info: IndividualInfo): any;
    generateMerchant(info: MerchantInfo): any;
    [key: string]: any;
  }
}
