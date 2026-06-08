import { v4 as uuidv4 } from 'uuid';
import {
  DataProduct,
  Application,
  Contract,
  AuthorizationToken,
  UsageRecord,
  BillSummary,
  BillDetailItem,
  CirculationRecord,
  OfflineNotification,
  PricingModel,
} from '../types';

export class DataStore {
  private static instance: DataStore;

  products: Map<string, DataProduct> = new Map();
  applications: Map<string, Application> = new Map();
  contracts: Map<string, Contract> = new Map();
  tokens: Map<string, AuthorizationToken> = new Map();
  usageRecords: UsageRecord[] = [];
  bills: Map<string, BillSummary> = new Map();
  billDetails: Map<string, BillDetailItem[]> = new Map();
  circulationRecords: CirculationRecord[] = [];
  offlineNotifications: OfflineNotification[] = [];

  private constructor() {}

  static getInstance(): DataStore {
    if (!DataStore.instance) {
      DataStore.instance = new DataStore();
    }
    return DataStore.instance;
  }

  generateId(): string {
    return uuidv4();
  }

  now(): string {
    return new Date().toISOString();
  }

  addCirculationRecord(
    recordType: CirculationRecord['recordType'],
    productId: string,
    productName: string,
    partyId: string,
    partyName: string,
    partyRole: CirculationRecord['partyRole'],
    description: string,
    metadata: Record<string, any> = {},
    refs: {
      applicationId?: string;
      contractId?: string;
      billId?: string;
      tokenId?: string;
    } = {}
  ): void {
    const record: CirculationRecord = {
      id: this.generateId(),
      recordType,
      productId,
      productName,
      partyId,
      partyName,
      partyRole,
      description,
      timestamp: this.now(),
      metadata,
      applicationId: refs.applicationId,
      contractId: refs.contractId,
      billId: refs.billId,
      tokenId: refs.tokenId,
    };
    this.circulationRecords.unshift(record);
  }

  calculateUsageAmount(
    pricingModel: PricingModel,
    unitPrice: number,
    callsDelta: number,
    volumeDeltaBytes: number
  ): number {
    switch (pricingModel) {
      case 'per_call':
        return callsDelta * unitPrice;
      case 'per_volume':
        return (volumeDeltaBytes / (1024 * 1024 * 1024)) * unitPrice;
      case 'per_month':
      case 'per_year':
      case 'one_time':
        return 0;
      default:
        return 0;
    }
  }
}

export const store = DataStore.getInstance();
