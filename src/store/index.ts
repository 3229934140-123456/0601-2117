import { v4 as uuidv4 } from 'uuid';
import {
  DataProduct,
  Application,
  Contract,
  AuthorizationToken,
  UsageRecord,
  BillSummary,
  CirculationRecord,
  OfflineNotification,
} from '../types';

export class DataStore {
  private static instance: DataStore;

  products: Map<string, DataProduct> = new Map();
  applications: Map<string, Application> = new Map();
  contracts: Map<string, Contract> = new Map();
  tokens: Map<string, AuthorizationToken> = new Map();
  usageRecords: UsageRecord[] = [];
  bills: Map<string, BillSummary> = new Map();
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
    metadata: Record<string, any> = {}
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
    };
    this.circulationRecords.unshift(record);
  }
}

export const store = DataStore.getInstance();
