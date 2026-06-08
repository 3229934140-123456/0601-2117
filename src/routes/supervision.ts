import { Router, Request, Response } from 'express';
import { store } from '../store';
import { success, fail, paginate } from '../utils';
import { CirculationQueryParams, CirculationRecord } from '../types';

const router = Router();

router.get('/records', (req: Request, res: Response) => {
  const query = req.query as unknown as CirculationQueryParams;
  let records = [...store.circulationRecords];

  if (query.recordType) {
    records = records.filter((r) => r.recordType === query.recordType);
  }
  if (query.productId) {
    records = records.filter((r) => r.productId === query.productId);
  }
  if (query.partyId) {
    records = records.filter((r) => r.partyId === query.partyId);
  }
  if (query.startTime) {
    const start = new Date(query.startTime);
    records = records.filter((r) => new Date(r.timestamp) >= start);
  }
  if (query.endTime) {
    const end = new Date(query.endTime);
    records = records.filter((r) => new Date(r.timestamp) <= end);
  }

  const result = paginate(records, query.page, query.pageSize);
  return success(res, result);
});

router.get('/statistics', (req: Request, res: Response) => {
  const { startTime, endTime } = req.query;
  let records = [...store.circulationRecords];

  if (startTime) {
    const start = new Date(startTime as string);
    records = records.filter((r) => new Date(r.timestamp) >= start);
  }
  if (endTime) {
    const end = new Date(endTime as string);
    records = records.filter((r) => new Date(r.timestamp) <= end);
  }

  const byType: Record<string, number> = {};
  const byRole: Record<string, number> = {};
  const byDate: Record<string, number> = {};
  const productRanking: Record<string, { name: string; count: number }> = {};

  records.forEach((r) => {
    byType[r.recordType] = (byType[r.recordType] || 0) + 1;
    byRole[r.partyRole] = (byRole[r.partyRole] || 0) + 1;

    const date = r.timestamp.split('T')[0];
    byDate[date] = (byDate[date] || 0) + 1;

    if (!productRanking[r.productId]) {
      productRanking[r.productId] = { name: r.productName, count: 0 };
    }
    productRanking[r.productId].count += 1;
  });

  const topProducts = Object.entries(productRanking)
    .map(([id, v]) => ({ productId: id, productName: v.name, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const activeProducts = Array.from(store.products.values()).filter(
    (p) => p.status === 'active'
  ).length;
  const activeContracts = Array.from(store.contracts.values()).filter(
    (c) => c.status === 'active'
  ).length;
  const totalUsage = store.usageRecords.length;
  const totalBillAmount = Array.from(store.bills.values()).reduce(
    (sum, b) => sum + b.totalAmount,
    0
  );
  const totalPaidAmount = Array.from(store.bills.values())
    .filter((b) => b.status === 'paid')
    .reduce((sum, b) => sum + b.totalAmount, 0);

  return success(res, {
    totalRecords: records.length,
    byType,
    byRole,
    byDate,
    topProducts,
    summary: {
      activeProducts,
      activeContracts,
      totalUsage,
      totalBillAmount: Number(totalBillAmount.toFixed(2)),
      totalPaidAmount: Number(totalPaidAmount.toFixed(2)),
      totalUnpaidAmount: Number((totalBillAmount - totalPaidAmount).toFixed(2)),
    },
  });
});

function buildTimeline(records: CirculationRecord[]) {
  return records
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((r) => {
      const related: any = {
        applicationId: r.applicationId,
        contractId: r.contractId,
        billId: r.billId,
        tokenId: r.tokenId,
      };

      if (r.applicationId) {
        const app = store.applications.get(r.applicationId);
        if (app) {
          related.application = {
            id: app.id,
            status: app.status,
            type: app.type,
            applicantName: app.applicantName,
          };
        }
      }
      if (r.contractId) {
        const c = store.contracts.get(r.contractId);
        if (c) {
          related.contract = {
            id: c.id,
            status: c.status,
            pricingModel: c.pricingModel,
            unitPrice: c.unitPrice,
            callsUsed: c.callsUsed,
            amountPaid: c.amountPaid,
          };
        }
      }
      if (r.billId) {
        const b = store.bills.get(r.billId);
        if (b) {
          related.bill = {
            id: b.id,
            billingPeriod: b.billingPeriod,
            totalAmount: b.totalAmount,
            status: b.status,
          };
        }
      }

      return {
        ...r,
        related,
      };
    });
}

router.get('/product/:productId/timeline', (req: Request, res: Response) => {
  const { productId } = req.params;
  const product = store.products.get(productId);

  if (!product) {
    return fail(res, '产品不存在', 404);
  }

  const records = store.circulationRecords.filter((r) => r.productId === productId);

  const applications = Array.from(store.applications.values()).filter(
    (a) => a.productId === productId
  );
  const contracts = Array.from(store.contracts.values()).filter((c) => c.productId === productId);
  const bills = Array.from(store.bills.values()).filter((b) => b.productId === productId);
  const notifications = store.offlineNotifications.filter((n) => n.productId === productId);

  const totalCalls = store.usageRecords.filter((r) => r.productId === productId).length;
  const totalUsageAmount = contracts.reduce((sum, c) => sum + c.accumulatedUsageAmount, 0);
  const totalBillAmount = bills.reduce((sum, b) => sum + b.totalAmount, 0);
  const totalPaidAmount = bills
    .filter((b) => b.status === 'paid')
    .reduce((sum, b) => sum + b.totalAmount, 0);

  const involvedParties = new Map<string, { id: string; name: string; role: string }>();
  records.forEach((r) => {
    if (!involvedParties.has(r.partyId)) {
      involvedParties.set(r.partyId, {
        id: r.partyId,
        name: r.partyName,
        role: r.partyRole,
      });
    }
  });

  return success(res, {
    product: {
      id: product.id,
      name: product.name,
      status: product.status,
      ownerId: product.ownerId,
      ownerName: product.ownerName,
      pricingModel: product.pricingModel,
      price: product.price,
      createdAt: product.createdAt,
      offlineAt: product.offlineAt,
      offlineReason: product.offlineReason,
    },
    timeline: buildTimeline(records),
    summary: {
      totalRecords: records.length,
      applicationCount: applications.length,
      approvedApplicationCount: applications.filter((a) => a.status === 'approved').length,
      contractCount: contracts.length,
      activeContractCount: contracts.filter((c) => c.status === 'active').length,
      billCount: bills.length,
      paidBillCount: bills.filter((b) => b.status === 'paid').length,
      totalCalls,
      totalUsageAmount: Number(totalUsageAmount.toFixed(4)),
      totalBillAmount: Number(totalBillAmount.toFixed(2)),
      totalPaidAmount: Number(totalPaidAmount.toFixed(2)),
      notificationCount: notifications.length,
    },
    relatedData: {
      applications: applications.map((a) => ({
        id: a.id,
        status: a.status,
        type: a.type,
        applicantName: a.applicantName,
        contractId: a.contractId,
        submittedAt: a.submittedAt,
      })),
      contracts: contracts.map((c) => ({
        id: c.id,
        status: c.status,
        licenseeId: c.licenseeId,
        licenseeName: c.licenseeName,
        pricingModel: c.pricingModel,
        callsUsed: c.callsUsed,
        accumulatedUsageAmount: c.accumulatedUsageAmount,
        amountPaid: c.amountPaid,
        signedAt: c.signedAt,
        expiresAt: c.expiresAt,
      })),
      bills: bills.map((b) => ({
        id: b.id,
        billingPeriod: b.billingPeriod,
        totalAmount: b.totalAmount,
        status: b.status,
        paidAt: b.paidAt,
      })),
    },
    involvedParties: Array.from(involvedParties.values()),
  });
});

router.get('/caller/:callerId/timeline', (req: Request, res: Response) => {
  const { callerId } = req.params;

  const records = store.circulationRecords.filter(
    (r) => r.partyId === callerId
  );

  if (records.length === 0) {
    const hasContract = Array.from(store.contracts.values()).some(
      (c) => c.licenseeId === callerId
    );
    if (!hasContract) {
      return fail(res, '调用方不存在或无流通记录', 404);
    }
  }

  const callerName =
    records.find((r) => r.partyName)?.partyName ||
    Array.from(store.contracts.values()).find((c) => c.licenseeId === callerId)?.licenseeName ||
    callerId;

  const involvedProductIds = new Set<string>();
  records.forEach((r) => involvedProductIds.add(r.productId));

  const callerContracts = Array.from(store.contracts.values()).filter(
    (c) => c.licenseeId === callerId
  );
  callerContracts.forEach((c) => involvedProductIds.add(c.productId));

  const callerApplications = Array.from(store.applications.values()).filter(
    (a) => a.applicantId === callerId
  );
  const callerBills = Array.from(store.bills.values()).filter(
    (b) => b.licenseeId === callerId
  );
  const callerUsage = store.usageRecords.filter((r) => r.callerId === callerId);
  const callerNotifications = store.offlineNotifications.filter((n) =>
    n.notifiedLicenseeIds.includes(callerId)
  );

  const totalUsageAmount = callerContracts.reduce(
    (sum, c) => sum + c.accumulatedUsageAmount,
    0
  );
  const totalBillAmount = callerBills.reduce((sum, b) => sum + b.totalAmount, 0);
  const totalPaidAmount = callerBills
    .filter((b) => b.status === 'paid')
    .reduce((sum, b) => sum + b.totalAmount, 0);

  const perProductStats: Record<
    string,
    {
      productId: string;
      productName: string;
      calls: number;
      usageAmount: number;
      billAmount: number;
      paidAmount: number;
    }
  > = {};

  involvedProductIds.forEach((pid) => {
    const p = store.products.get(pid);
    const productContracts = callerContracts.filter((c) => c.productId === pid);
    const productBills = callerBills.filter((b) => b.productId === pid);
    perProductStats[pid] = {
      productId: pid,
      productName: p?.name || pid,
      calls: callerUsage.filter((u) => u.productId === pid).length,
      usageAmount: Number(
        productContracts.reduce((s, c) => s + c.accumulatedUsageAmount, 0).toFixed(4)
      ),
      billAmount: Number(productBills.reduce((s, b) => s + b.totalAmount, 0).toFixed(2)),
      paidAmount: Number(
        productBills.filter((b) => b.status === 'paid').reduce((s, b) => s + b.totalAmount, 0).toFixed(2)
      ),
    };
  });

  return success(res, {
    caller: {
      id: callerId,
      name: callerName,
    },
    timeline: buildTimeline(records),
    summary: {
      totalRecords: records.length,
      involvedProducts: involvedProductIds.size,
      applicationCount: callerApplications.length,
      approvedApplicationCount: callerApplications.filter((a) => a.status === 'approved')
        .length,
      contractCount: callerContracts.length,
      activeContractCount: callerContracts.filter((c) => c.status === 'active').length,
      billCount: callerBills.length,
      paidBillCount: callerBills.filter((b) => b.status === 'paid').length,
      unpaidBillCount: callerBills.filter((b) => b.status === 'unpaid').length,
      totalCalls: callerUsage.length,
      totalUsageAmount: Number(totalUsageAmount.toFixed(4)),
      totalBillAmount: Number(totalBillAmount.toFixed(2)),
      totalPaidAmount: Number(totalPaidAmount.toFixed(2)),
      totalUnpaidAmount: Number((totalBillAmount - totalPaidAmount).toFixed(2)),
      unreadNotifications: callerNotifications.filter(
        (n) => !n.readByLicenseeIds.includes(callerId)
      ).length,
    },
    perProductStats: Object.values(perProductStats),
    relatedData: {
      applications: callerApplications.map((a) => ({
        id: a.id,
        productId: a.productId,
        productName: a.productName,
        status: a.status,
        type: a.type,
        submittedAt: a.submittedAt,
        contractId: a.contractId,
      })),
      contracts: callerContracts.map((c) => ({
        id: c.id,
        productId: c.productId,
        productName: c.productName,
        status: c.status,
        pricingModel: c.pricingModel,
        unitPrice: c.unitPrice,
        callsUsed: c.callsUsed,
        totalDataVolumeBytes: c.totalDataVolumeBytes,
        accumulatedUsageAmount: Number(c.accumulatedUsageAmount.toFixed(4)),
        amountPaid: Number(c.amountPaid.toFixed(4)),
        signedAt: c.signedAt,
        expiresAt: c.expiresAt,
      })),
      bills: callerBills.map((b) => ({
        id: b.id,
        productId: b.productId,
        productName: b.productName,
        contractId: b.contractId,
        billingPeriod: b.billingPeriod,
        totalAmount: b.totalAmount,
        status: b.status,
        dueDate: b.dueDate,
        paidAt: b.paidAt,
      })),
    },
  });
});

router.get('/trace/:recordType/:recordId', (req: Request, res: Response) => {
  const { recordType, recordId } = req.params;

  let relatedRecords: CirculationRecord[] = [];
  let targetInfo: any = null;

  switch (recordType) {
    case 'application': {
      const app = store.applications.get(recordId);
      if (!app) return fail(res, '申请不存在', 404);
      targetInfo = app;
      relatedRecords = store.circulationRecords.filter(
        (r) => r.applicationId === recordId || r.productId === app.productId
      );
      if (app.contractId) {
        const contractRecords = store.circulationRecords.filter(
          (r) => r.contractId === app.contractId
        );
        contractRecords.forEach((cr) => {
          if (!relatedRecords.find((x) => x.id === cr.id)) relatedRecords.push(cr);
        });
      }
      break;
    }
    case 'contract': {
      const c = store.contracts.get(recordId);
      if (!c) return fail(res, '合约不存在', 404);
      targetInfo = c;
      relatedRecords = store.circulationRecords.filter(
        (r) =>
          r.contractId === recordId ||
          r.applicationId === c.applicationId ||
          r.productId === c.productId
      );
      const contractBills = Array.from(store.bills.values()).filter(
        (b) => b.contractId === recordId
      );
      contractBills.forEach((b) => {
        const billRecords = store.circulationRecords.filter((r) => r.billId === b.id);
        billRecords.forEach((br) => {
          if (!relatedRecords.find((x) => x.id === br.id)) relatedRecords.push(br);
        });
      });
      break;
    }
    case 'bill': {
      const b = store.bills.get(recordId);
      if (!b) return fail(res, '账单不存在', 404);
      targetInfo = b;
      relatedRecords = store.circulationRecords.filter(
        (r) =>
          r.billId === recordId ||
          r.contractId === b.contractId ||
          r.productId === b.productId
      );
      break;
    }
    default:
      return fail(res, '不支持的追溯类型，可选: application/contract/bill');
  }

  return success(res, {
    recordType,
    recordId,
    targetInfo,
    timeline: buildTimeline(relatedRecords),
    relatedCount: relatedRecords.length,
  });
});

export default router;
