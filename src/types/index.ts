export type ProductStatus = 'active' | 'inactive' | 'offline' | 'pending_review';

export type UpdateFrequency = 'realtime' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export type PricingModel = 'per_call' | 'per_month' | 'per_year' | 'per_volume' | 'one_time';

export type ApplicationStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type ApplicationType = 'trial' | 'formal';

export type ContractStatus = 'active' | 'expired' | 'terminated' | 'suspended';

export interface DataProduct {
  id: string;
  name: string;
  description: string;
  source: string;
  industry: string;
  region: string;
  tags: string[];
  updateFrequency: UpdateFrequency;
  availableScope: string[];
  pricingModel: PricingModel;
  price: number;
  ownerId: string;
  ownerName: string;
  status: ProductStatus;
  sampleDataAvailable: boolean;
  createdAt: string;
  updatedAt: string;
  offlineAt?: string;
  offlineReason?: string;
}

export interface ProductRegistrationRequest {
  name: string;
  description: string;
  source: string;
  industry: string;
  region: string;
  tags: string[];
  updateFrequency: UpdateFrequency;
  availableScope: string[];
  pricingModel: PricingModel;
  price: number;
  ownerId: string;
  ownerName: string;
  sampleDataAvailable?: boolean;
}

export interface ProductQueryParams {
  keyword?: string;
  industry?: string;
  region?: string;
  tags?: string[];
  status?: ProductStatus;
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Application {
  id: string;
  productId: string;
  productName: string;
  applicantId: string;
  applicantName: string;
  type: ApplicationType;
  purpose: string;
  status: ApplicationStatus;
  submittedAt: string;
  reviewedAt?: string;
  reviewerId?: string;
  reviewerName?: string;
  reviewComment?: string;
  contractId?: string;
}

export interface ApplicationRequest {
  productId: string;
  applicantId: string;
  applicantName: string;
  type: ApplicationType;
  purpose: string;
}

export interface ApprovalRequest {
  applicationId: string;
  reviewerId: string;
  reviewerName: string;
  approved: boolean;
  comment?: string;
  validDays?: number;
}

export interface AuthorizationToken {
  id: string;
  contractId: string;
  productId: string;
  licenseeId: string;
  token: string;
  issuedAt: string;
  expiresAt: string;
  isRevoked: boolean;
}

export interface Contract {
  id: string;
  applicationId: string;
  productId: string;
  productName: string;
  licensorId: string;
  licensorName: string;
  licenseeId: string;
  licenseeName: string;
  status: ContractStatus;
  signedAt: string;
  expiresAt: string;
  pricingModel: PricingModel;
  unitPrice: number;
  totalCallsAllowed?: number;
  callsUsed: number;
  totalDataVolumeBytes: number;
  accumulatedUsageAmount: number;
  amountPaid: number;
}

export interface UsageRecord {
  id: string;
  contractId: string;
  productId: string;
  callerId: string;
  tokenId: string;
  callTime: string;
  responseTimeMs: number;
  success: boolean;
  dataVolumeBytes?: number;
}

export interface UsageReportRequest {
  contractId: string;
  tokenId: string;
  productId: string;
  callerId: string;
  callCount: number;
  successCount: number;
  totalResponseTimeMs: number;
  totalDataVolumeBytes?: number;
  periodStart: string;
  periodEnd: string;
}

export type BillDetailType =
  | 'per_call_fee'
  | 'per_volume_fee'
  | 'monthly_subscription'
  | 'yearly_subscription'
  | 'one_time_fee';

export interface BillDetailItem {
  id: string;
  billId: string;
  type: BillDetailType;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  subtotal: number;
  metadata?: Record<string, any>;
}

export interface BillSummary {
  id: string;
  contractId: string;
  productId: string;
  productName: string;
  licenseeId: string;
  licenseeName: string;
  billingPeriod: string;
  pricingModel: PricingModel;
  totalCalls: number;
  totalDataVolumeBytes: number;
  unitPrice: number;
  detailTotal: number;
  totalAmount: number;
  status: 'unpaid' | 'paid' | 'overdue';
  generatedAt: string;
  dueDate: string;
  paidAt?: string;
}

export interface CirculationRecord {
  id: string;
  recordType: 'registration' | 'application' | 'approval' | 'contract_sign' | 'usage' | 'offline' | 'bill_pay';
  productId: string;
  productName: string;
  partyId: string;
  partyName: string;
  partyRole: 'provider' | 'consumer' | 'reviewer' | 'system';
  description: string;
  timestamp: string;
  metadata: Record<string, any>;
  applicationId?: string;
  contractId?: string;
  billId?: string;
  tokenId?: string;
}

export interface CirculationQueryParams {
  recordType?: string;
  productId?: string;
  partyId?: string;
  startTime?: string;
  endTime?: string;
  page?: number;
  pageSize?: number;
}

export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data?: T;
}

export interface OfflineNotification {
  id: string;
  productId: string;
  productName: string;
  reason: string;
  ownerId: string;
  ownerName: string;
  affectedContractIds: string[];
  notifiedLicenseeIds: string[];
  readByLicenseeIds: string[];
  createdAt: string;
}
